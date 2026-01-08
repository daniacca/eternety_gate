import type {
  StoryPack,
  GameSave,
  Actor,
  ActorId,
  SceneId,
  Grid,
  Position,
  CombatState,
  CheckResult,
  SingleCheck,
  StatKey,
  Effect,
} from "../types";
import { RNG } from "../rng";
import { clampToGrid } from "./movement";
import { appendCombatLog, appendRuntimeLog } from "./narration";
import {
  hasCondition,
  getStacks,
  computeCombatModifiersFromConditions,
  removeConditionFromActor,
  addConditionToActor,
} from "../conditions";
import { getInitiativeBonus, getCharacteristicBonus } from "../characters/bonuses";
import { calculateMaxHp } from "../characters/hp";
import { applyDamageToActor } from "./criticalDamage";

/**
 * Checks if an actor is alive (not dead)
 * Actor is alive if they exist and isDead !== true
 */
function isActorAlive(actor: Actor | undefined): boolean {
  return actor !== undefined && actor.resources.isDead !== true;
}

/**
 * Checks if combat should end based on faction deaths
 * Combat ends when:
 * - All enemies (NPCs) are dead, OR
 * - All party members (PCs) are dead
 */
function shouldCombatEnd(
  save: GameSave,
  participants: ActorId[]
): { shouldEnd: boolean; outcome?: "victory" | "defeat"; winnerId?: ActorId } {
  const partyIds = new Set(save.party?.actors ?? []);
  const enemyIds = participants.filter((id) => !partyIds.has(id));

  const partyAlive = participants.filter((id) => {
    const actor = save.actorsById[id];
    return partyIds.has(id) && isActorAlive(actor);
  });

  const enemiesAlive = participants.filter((id) => {
    const actor = save.actorsById[id];
    return enemyIds.includes(id) && isActorAlive(actor);
  });

  if (enemiesAlive.length === 0 && partyAlive.length > 0) {
    // All enemies dead - party victory
    return { shouldEnd: true, outcome: "victory", winnerId: partyAlive[0] };
  }

  if (partyAlive.length === 0 && enemiesAlive.length > 0) {
    // All party dead - defeat
    return { shouldEnd: true, outcome: "defeat", winnerId: enemiesAlive[0] };
  }

  if (partyAlive.length === 0 && enemiesAlive.length === 0) {
    // Everyone dead - mutual defeat
    return { shouldEnd: true, outcome: "defeat" };
  }

  return { shouldEnd: false };
}

/**
 * Initializes turn state for an actor based on their AGI and conditions
 */
function initializeTurnState(
  actor: Actor,
  save: GameSave
): {
  moveRemaining: number;
  actionAvailable: boolean;
} {
  const agiBonus = getCharacteristicBonus(save, actor.id, "AGI");
  const modifiers = computeCombatModifiersFromConditions(actor);

  // Apply fatigue and prone to movement (minimum 1)
  const moveDelta = modifiers.moveDelta ?? 0;
  const baseMove = Math.max(1, agiBonus + moveDelta);

  return {
    moveRemaining: Math.max(1, baseMove), // Minimum 1 movement
    actionAvailable: true,
  };
}

/**
 * Starts combat with given participants, grid, and placements
 */
export function startCombat(
  storyPack: StoryPack,
  save: GameSave,
  participantIds: ActorId[],
  startedBySceneId?: SceneId,
  grid?: Grid,
  placements?: Array<{ actorId: ActorId; x: number; y: number }>
): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  // Filter participants: must exist and be alive (isDead !== true)
  const validParticipants = participantIds.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });

  if (validParticipants.length === 0) {
    return save;
  }

  // Calculate initiative for each participant
  type InitiativeEntry = {
    id: ActorId;
    iniBonus: number;
    iniRoll: number;
    iniScore: number;
  };

  const initiatives: InitiativeEntry[] = validParticipants.map((id) => {
    const iniBonus = getInitiativeBonus(save, id);
    const iniRoll = rng.nextInt(1, 10); // d10
    const iniScore = iniBonus + iniRoll;

    return {
      id,
      iniBonus,
      iniRoll,
      iniScore,
    };
  });

  // Sort by iniScore desc, then iniBonus desc, then actorId asc (deterministic)
  initiatives.sort((a, b) => {
    if (b.iniScore !== a.iniScore) {
      return b.iniScore - a.iniScore;
    }
    if (b.iniBonus !== a.iniBonus) {
      return b.iniBonus - a.iniBonus;
    }
    return a.id.localeCompare(b.id);
  });

  const orderedIds = initiatives.map((entry) => entry.id);
  const currentTurnActorId = orderedIds[0];

  // Initialize grid (default 10x10 if not provided)
  const combatGrid: Grid = grid || { width: 10, height: 10 };

  // Initialize positions from placements
  const positions: Record<ActorId, Position> = {};
  if (placements) {
    for (const placement of placements) {
      if (orderedIds.includes(placement.actorId)) {
        positions[placement.actorId] = clampToGrid({ x: placement.x, y: placement.y }, combatGrid);
      }
    }
  }

  // Set default positions for missing actors (0,0)
  for (const id of orderedIds) {
    if (!positions[id]) {
      positions[id] = { x: 0, y: 0 };
    }
  }

  // Determine the scene ID that started combat (use provided startedBySceneId or current scene)
  const sceneIdForCombat = startedBySceneId || save.runtime.currentSceneId;

  // Initialize turn state for first actor
  const firstActor = save.actorsById[currentTurnActorId];
  const initialTurnState = firstActor
    ? initializeTurnState(firstActor, save)
    : { moveRemaining: 0, actionAvailable: true };

  // Save initial HP for each participant (for UI display of max HP)
  const initialHpByActorId: Record<ActorId, number> = {};
  for (const id of orderedIds) {
    const actor = save.actorsById[id];
    if (actor) {
      // Store initial HP (maxHp - wounds) for UI display
      // We'll calculate maxHp when needed, but for now store current HP
      const wounds = actor.resources.wounds ?? 0;
      // We'll need to calculate maxHp properly, but for backward compatibility store current HP
      // This will be recalculated in UI components using calculateMaxHp
      initialHpByActorId[id] = actor.derived?.hpMax ?? 100 - wounds;
    }
  }

  const combatState: CombatState = {
    active: true,
    participants: orderedIds,
    currentIndex: 0,
    round: 1,
    startedBySceneId: sceneIdForCombat,
    grid: combatGrid,
    positions,
    turn: initialTurnState,
    stancesByActorId: {},
    turnCounter: 0,
    parryDisabledUntilTurnCounterByActorId: {},
    equippedThisRoundByActorId: {},
    initialHpByActorId,
  };

  // Reset combat log and initialize with start message
  const initialCombatLog = ["Il combattimento è iniziato."];

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatState,
      rngCounter: rng.getCounter(),
      combatLog: initialCombatLog,
      combatLogSceneId: sceneIdForCombat,
      runtimeLog: [],
      // Set combatTurnStartIndex to point after the start message (index 1, after we add header)
      combatTurnStartIndex: 1,
    },
  };

  // Log initiative rolls - only for player-controlled actors by default
  // TODO: Add debug flag support for revealing NPC rolls
  const REVEAL_NPC_ROLLS = false;
  const partyIds = new Set(save.party?.actors ?? []);

  for (const entry of initiatives) {
    const actor = save.actorsById[entry.id];
    const isPlayerControlled = actor?.kind === "PC" || partyIds.has(entry.id);

    // Only log if player-controlled or if debug flag is enabled
    if (isPlayerControlled || REVEAL_NPC_ROLLS) {
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "initiative",
        actorId: entry.id,
        iniBonus: entry.iniBonus,
        iniRoll: entry.iniRoll,
        iniScore: entry.iniScore,
        turnCounter: 0,
      });
    }
  }

  // Add turn header for first turn
  const isPlayerTurn = firstActor?.kind === "PC";
  const actorName = firstActor?.name || currentTurnActorId;
  const turnHeader = isPlayerTurn ? `— Tocca a te —` : `— Turno 1: ${actorName} —`;
  updatedSave = appendCombatLog(updatedSave, turnHeader);

  return updatedSave;
}

/**
 * Gets the current turn actor ID, or null if combat is not active
 */
export function getCurrentTurnActorId(save: GameSave): ActorId | null {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return null;
  }

  if (combat.participants.length === 0) {
    return null;
  }

  return combat.participants[combat.currentIndex] || null;
}

/**
 * Advances combat turn, removes KO participants, and ends combat if needed
 */
export function advanceCombatTurn(save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  const aliveParticipants = combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });

  const last = save.runtime.lastCheck && save.runtime.lastCheck !== null ? save.runtime.lastCheck : null;

  // Check if combat should end based on faction deaths
  const endCheckResult = shouldCombatEnd(save, aliveParticipants);

  if (endCheckResult.shouldEnd) {
    const outcome = endCheckResult.outcome || "victory";
    const winnerId = endCheckResult.winnerId;
    const winner = winnerId ? save.actorsById[winnerId] : null;

    // Determine scene ID where combat ended (use startedBySceneId if available)
    const endedSceneId = combat.startedBySceneId || save.runtime.currentSceneId;

    let logEntry: string;
    if (outcome === "victory") {
      logEntry = "Tutti i nemici presenti nell'area sono stati sconfitti.";
    } else {
      logEntry = "Il party è stato annientato. Game over.";
    }

    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [
            ...last.tags,
            "combat:state=end",
            `combat:outcome=${outcome}`,
            ...(winnerId ? [`combat:winner=${winnerId}`] : []),
          ],
        }
      : {
          checkId: "combat:end",
          actorId: save.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: ["combat:state=end", `combat:outcome=${outcome}`, ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        };

    let updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: endedSceneId,
      },
    };

    return appendCombatLog(updatedSave, logEntry);
  }

  const prevActorId = combat.participants[combat.currentIndex];
  const prevAliveIndex = aliveParticipants.indexOf(prevActorId);
  const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : Math.min(combat.currentIndex, aliveParticipants.length - 1);

  let newCurrentIndex = (pivotIndex + 1) % aliveParticipants.length;
  let newRound = combat.round;
  if (newCurrentIndex === 0) newRound = combat.round + 1;

  const currentTurnActorId = aliveParticipants[newCurrentIndex];

  // Set combatTurnStartIndex at the start of this new turn (before any actions)
  const currentLogLength = save.runtime.combatLog?.length ?? 0;
  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combatTurnStartIndex: currentLogLength,
    },
  };

  // Increment turn counter (monotonic) - needed for condition expiration checks
  const newTurnCounter = (combat.turnCounter ?? 0) + 1;

  // Initialize turn state for new actor and apply condition effects
  let currentActor = updatedSave.actorsById[currentTurnActorId];
  let newTurnState = currentActor
    ? initializeTurnState(currentActor, updatedSave)
    : { moveRemaining: 0, actionAvailable: true };

  // Apply condition effects at turn start
  if (currentActor) {
    const isPlayerActor = currentActor.kind === "PC";
    const actorName = currentActor.name || currentTurnActorId;

    // Check for stunned condition
    if (hasCondition(currentActor, "stunned")) {
      const stunnedCondition = currentActor.conditions?.stunned;
      if (stunnedCondition?.untilTurnCounter !== undefined && stunnedCondition.untilTurnCounter >= newTurnCounter) {
        // Stunned: disable action and set move to 0
        newTurnState = {
          moveRemaining: 0,
          actionAvailable: false,
        };
        const stunnedLog = isPlayerActor
          ? "Sei stordito e perdi il turno."
          : `${actorName} è stordito e perde il turno.`;
        updatedSave = appendCombatLog(updatedSave, stunnedLog);
      }
    }

    // Check for bleeding condition - use centralized damage application
    if (hasCondition(currentActor, "bleeding")) {
      const bleedingStacks = getStacks(currentActor, "bleeding");
      const damage = Math.max(1, bleedingStacks);

      // Create RNG from save state for deterministic bleeding damage
      const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);

      // Calculate HP before damage for logging
      const maxHp = calculateMaxHp(updatedSave, currentActor);
      const woundsBefore = currentActor.resources.wounds ?? 0;
      const hpBefore = maxHp - woundsBefore;

      // Apply bleeding damage using centralized function
      const damageResult = applyDamageToActor(currentActor, damage, updatedSave, rng);
      currentActor = damageResult.updatedActor;
      const emittedEffects = damageResult.effects;
      const actorDied = damageResult.actorDied;

      // Update save with new actor state
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [currentTurnActorId]: currentActor,
        },
        runtime: {
          ...updatedSave.runtime,
          rngCounter: rng.getCounter(),
        },
      };

      // Apply emitted effects (conditions from critical damage tiers)
      for (const effect of emittedEffects) {
        if (effect.op === "addCondition") {
          const actorToUpdate = updatedSave.actorsById[effect.actorId];
          if (actorToUpdate) {
            const updatedActorWithCondition = addConditionToActor(
              actorToUpdate,
              effect.condition,
              effect.stacks,
              effect.durationTurns,
              effect.source
            );
            updatedSave = {
              ...updatedSave,
              actorsById: {
                ...updatedSave.actorsById,
                [effect.actorId]: updatedActorWithCondition,
              },
            };
          }
        }
      }

      // Calculate HP after damage for logging
      const woundsAfter = currentActor.resources.wounds ?? 0;
      const hpAfter = maxHp - woundsAfter;

      const bleedingLog = isPlayerActor
        ? `Sanguini e perdi ${damage} HP.`
        : `${actorName} sanguina e perde ${damage} HP.`;
      updatedSave = appendCombatLog(updatedSave, bleedingLog);

      if (hpAfter === 0 && hpBefore > 0) {
        const criticalLog = isPlayerActor
          ? "Sei entrato nella traccia del danno critico!"
          : `${actorName} è entrato nella traccia del danno critico!`;
        updatedSave = appendCombatLog(updatedSave, criticalLog);
      }

      // Note: HP=0 does not mean KO anymore - actor can still act if isDead !== true
      // Only check combat end if actor actually died (isDead === true)
      // This check happens after damage application, so we check the updated actor state
      const updatedActor = updatedSave.actorsById[currentTurnActorId];
      if (updatedActor && updatedActor.resources.isDead === true) {
        const deathLog = isPlayerActor ? "Sei morto!" : `${actorName} è morto!`;
        updatedSave = appendCombatLog(updatedSave, deathLog);

        // Recompute alive participants based on isDead
        const updatedAliveParticipants =
          updatedSave.runtime.combat?.participants.filter((id) => {
            const actor = updatedSave.actorsById[id];
            return isActorAlive(actor);
          }) || [];

        // Check if combat should end based on factions
        const endCheckResult = shouldCombatEnd(updatedSave, updatedAliveParticipants);

        if (endCheckResult.shouldEnd) {
          const outcome = endCheckResult.outcome || "victory";
          const winnerId = endCheckResult.winnerId;
          const combatState = updatedSave.runtime.combat;
          const endedSceneId = combatState?.startedBySceneId || updatedSave.runtime.currentSceneId;

          let endLog: string;
          if (outcome === "victory") {
            endLog = "Tutti i nemici presenti nell'area sono stati sconfitti.";
          } else {
            endLog = "Il party è stato annientato. Game over.";
          }

          const endCheck: CheckResult = last
            ? {
                ...last,
                tags: [
                  ...last.tags,
                  "combat:state=end",
                  `combat:outcome=${outcome}`,
                  ...(winnerId ? [`combat:winner=${winnerId}`] : []),
                ],
              }
            : {
                checkId: "combat:end",
                actorId: updatedSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: true,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: [
                  "combat:state=end",
                  `combat:outcome=${outcome}`,
                  ...(winnerId ? [`combat:winner=${winnerId}`] : []),
                ],
              };

          updatedSave = appendCombatLog(updatedSave, endLog);

          return {
            ...updatedSave,
            runtime: {
              ...updatedSave.runtime,
              combat: undefined,
              lastCheck: endCheck,
              combatEndedSceneId: endedSceneId,
            },
          };
        }

        // Combat continues - immediately advance to next living actor
        // Update combat state with updated participants before recursive call
        const combatAfterDeath = updatedSave.runtime.combat;
        if (combatAfterDeath) {
          // The actor that just died was at newCurrentIndex in the old participants list
          // We need to advance from the previous actor (combat.currentIndex) in the updated alive list
          // Use the prevActorId already declared above
          const prevAliveIndex = updatedAliveParticipants.indexOf(prevActorId);

          // If previous actor is still alive, use their index; otherwise use 0 as fallback
          const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : 0;

          // Update combat state with alive participants and adjusted index
          // We'll advance from pivotIndex in the recursive call
          updatedSave = {
            ...updatedSave,
            runtime: {
              ...updatedSave.runtime,
              combat: {
                ...combatAfterDeath,
                participants: updatedAliveParticipants,
                currentIndex: pivotIndex,
              },
            },
          };

          // Recursively advance to next turn
          // The recursion depth is bounded by number of participants (each call removes at least one), so it's safe
          return advanceCombatTurn(updatedSave);
        }
      }
    }

    // Remove expired conditions (untilTurnCounter < current turnCounter)
    const conditionsToRemove: string[] = [];

    if (currentActor.conditions) {
      for (const [conditionId, instance] of Object.entries(currentActor.conditions)) {
        if (instance.untilTurnCounter !== undefined && instance.untilTurnCounter < newTurnCounter) {
          conditionsToRemove.push(conditionId);
        }
      }

      for (const conditionId of conditionsToRemove) {
        currentActor = removeConditionFromActor(currentActor, conditionId as any);
      }

      if (conditionsToRemove.length > 0) {
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [currentTurnActorId]: currentActor,
          },
        };
      }
    }
  }

  // Reset stance for actor whose turn starts (stances last "until your next turn")
  // For Aim: it persists until ranged attack is made OR until the actor's NEXT turn starts
  // So if actor had aim in previous turn, it's still available at start of current turn
  // and will be consumed when they fire, or removed when their NEXT turn starts
  const updatedStancesByActorId = { ...(combat.stancesByActorId || {}) };

  // Remove stance for actor whose turn starts
  // For Aim: only remove if this is the actor's NEXT turn (same actor, new turn)
  // Aim persists across other actors' turns until consumed by ranged attack or next turn starts
  if (prevActorId === currentTurnActorId) {
    // Same actor's next turn started - remove all stances including aim
    delete updatedStancesByActorId[currentTurnActorId];
  } else {
    // Different actor's turn started - remove their non-aim stances, keep aim if present
    // (aim from previous turn persists until consumed or next turn)
    if (updatedStancesByActorId[currentTurnActorId] !== "aim") {
      delete updatedStancesByActorId[currentTurnActorId];
    }
  }
  // Note: Aim stance persists until consumed by ranged attack OR until actor's next turn starts

  // Recompute alive participants based on isDead (after condition effects)
  // This ensures participants list reflects any deaths from bleeding or other effects
  const finalAliveParticipants =
    updatedSave.runtime.combat?.participants.filter((id) => {
      const actor = updatedSave.actorsById[id];
      return isActorAlive(actor);
    }) || [];

  const newCombatState: CombatState = {
    ...combat,
    participants: finalAliveParticipants,
    currentIndex: newCurrentIndex,
    round: newRound,
    turn: newTurnState,
    stancesByActorId: updatedStancesByActorId,
    turnCounter: newTurnCounter,
    parryDisabledUntilTurnCounterByActorId: combat.parryDisabledUntilTurnCounterByActorId || {},
  };

  const updatedLastCheck: CheckResult | null = last
    ? {
        ...last,
        tags: [
          ...last.tags.filter((tag) => !tag.startsWith("combat:round=") && !tag.startsWith("combat:turn=")),
          `combat:round=${newRound}`,
          `combat:turn=${currentTurnActorId}`,
        ],
      }
    : null;

  updatedSave = {
    ...updatedSave,
    runtime: { ...updatedSave.runtime, combat: newCombatState, lastCheck: updatedLastCheck },
  };

  // Add turn header log entry (after setting index so header is included in turn log)
  const actor = updatedSave.actorsById[currentTurnActorId];
  const isPlayerTurn = actor?.kind === "PC";
  const actorName = actor?.name || currentTurnActorId;
  const turnHeader = isPlayerTurn ? `— Tocca a te —` : `— Turno ${newTurnCounter}: ${actorName} —`;

  const lastLogEntry = updatedSave.runtime.combatLog?.[updatedSave.runtime.combatLog.length - 1];
  if (lastLogEntry !== turnHeader) {
    updatedSave = appendCombatLog(updatedSave, turnHeader);
  }

  return updatedSave;
}
