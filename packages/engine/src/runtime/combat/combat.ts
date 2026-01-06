import type { StoryPack, GameSave, Actor, ActorId, SceneId, Grid, Position, CombatState, CheckResult } from "../types";
import { RNG } from "../rng";
import { clampToGrid } from "./movement";
import { appendCombatLog } from "./narration";
import { hasCondition, getStacks, computeCombatModifiersFromConditions, removeConditionFromActor } from "../conditions";

/**
 * Calculates AGI bonus for movement: Math.floor(AGI / 10)
 */
function calculateAgiBonus(agi: number | undefined): number {
  return Math.floor((agi ?? 0) / 10);
}

/**
 * Initializes turn state for an actor based on their AGI and conditions
 */
function initializeTurnState(actor: Actor): {
  moveRemaining: number;
  actionAvailable: boolean;
} {
  const agiBonus = calculateAgiBonus(actor.stats.AGI);
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

  // Filter participants: must exist and be alive (hp > 0)
  const validParticipants = participantIds.filter((id) => {
    const actor = save.actorsById[id];
    return actor && actor.resources.hp > 0;
  });

  if (validParticipants.length === 0) {
    return save;
  }

  // Calculate initiative for each participant
  type InitiativeEntry = {
    id: ActorId;
    iniBase: number;
    iniRoll: number;
    iniScore: number;
  };

  const initiatives: InitiativeEntry[] = validParticipants.map((id) => {
    const actor = save.actorsById[id];
    const iniBase = actor.stats.INI ?? 0;
    const iniRoll = rng.nextInt(1, 10); // d10
    const iniScore = iniBase + iniRoll;

    return {
      id,
      iniBase,
      iniRoll,
      iniScore,
    };
  });

  // Sort by iniScore desc, then iniBase desc, then actorId asc (deterministic)
  initiatives.sort((a, b) => {
    if (b.iniScore !== a.iniScore) {
      return b.iniScore - a.iniScore;
    }
    if (b.iniBase !== a.iniBase) {
      return b.iniBase - a.iniBase;
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
  const initialTurnState = firstActor ? initializeTurnState(firstActor) : { moveRemaining: 0, actionAvailable: true };

  // Save initial HP for each participant (for UI display of max HP)
  const initialHpByActorId: Record<ActorId, number> = {};
  for (const id of orderedIds) {
    const actor = save.actorsById[id];
    if (actor) {
      initialHpByActorId[id] = actor.resources.hp;
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
    initialHpByActorId,
  };

  // Create debug lastCheck with position tags
  const positionTags: string[] = [];
  for (const id of orderedIds) {
    const pos = positions[id];
    positionTags.push(`combat:pos:${id}=${pos.x},${pos.y}`);
  }

  const debugCheck: CheckResult = {
    checkId: "combat:start",
    actorId: currentTurnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none",
    tags: [
      "combat:state=start",
      `combat:order=${orderedIds.join(",")}`,
      "combat:round=1",
      `combat:turn=${currentTurnActorId}`,
      ...positionTags,
    ],
  };

  // Reset combat log and initialize with start message
  const initialCombatLog = ["Il combattimento è iniziato."];

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatState,
      rngCounter: rng.getCounter(),
      lastCheck: debugCheck,
      combatLog: initialCombatLog,
      combatLogSceneId: sceneIdForCombat,
      // Set combatTurnStartIndex to point after the start message (index 1, after we add header)
      combatTurnStartIndex: 1,
    },
  };

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
    return actor && actor.resources.hp > 0;
  });

  const last = save.runtime.lastCheck && save.runtime.lastCheck !== null ? save.runtime.lastCheck : null;

  if (aliveParticipants.length <= 1) {
    const winnerId = aliveParticipants.length === 1 ? aliveParticipants[0] : null;

    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [...last.tags, "combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        }
      : {
          checkId: "combat:end",
          actorId: save.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none", // o null, coerente col tuo tipo
          tags: ["combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        };

    const winner = winnerId ? save.actorsById[winnerId] : null;
    const logEntry = `Il combattimento termina. Vincitore: ${winner?.name || "Nessuno"}.`;

    let updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: save.runtime.currentSceneId,
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
  let newTurnState = currentActor ? initializeTurnState(currentActor) : { moveRemaining: 0, actionAvailable: true };

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

    // Check for bleeding condition
    if (hasCondition(currentActor, "bleeding")) {
      const bleedingStacks = getStacks(currentActor, "bleeding");
      const damage = Math.max(1, bleedingStacks);
      const hpBefore = currentActor.resources.hp;
      const hpAfter = Math.max(0, hpBefore - damage);

      // Update actor HP immutably
      currentActor = {
        ...currentActor,
        resources: {
          ...currentActor.resources,
          hp: hpAfter,
        },
      };

      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [currentTurnActorId]: currentActor,
        },
      };

      const bleedingLog = isPlayerActor
        ? `Sanguini e perdi ${damage} HP.`
        : `${actorName} sanguina e perde ${damage} HP.`;
      updatedSave = appendCombatLog(updatedSave, bleedingLog);

      // Check if bleeding killed the actor
      if (hpAfter === 0) {
        const koLog = isPlayerActor ? "Sei stato sconfitto!" : `${actorName} è stato sconfitto!`;
        updatedSave = appendCombatLog(updatedSave, koLog);

        // Recompute alive participants based on updated HP
        const updatedAliveParticipants =
          updatedSave.runtime.combat?.participants.filter((id) => {
            const actor = updatedSave.actorsById[id];
            return actor && actor.resources.hp > 0;
          }) || [];

        // Check if combat should end
        if (updatedAliveParticipants.length <= 1) {
          const winnerId = updatedAliveParticipants.length === 1 ? updatedAliveParticipants[0] : null;
          const winner = winnerId ? updatedSave.actorsById[winnerId] : null;
          const endLog = `Il combattimento termina. Vincitore: ${winner?.name || "Nessuno"}.`;

          const endCheck: CheckResult = last
            ? {
                ...last,
                tags: [...last.tags, "combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
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
                tags: ["combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
              };

          updatedSave = appendCombatLog(updatedSave, endLog);

          return {
            ...updatedSave,
            runtime: {
              ...updatedSave.runtime,
              combat: undefined,
              lastCheck: endCheck,
              combatEndedSceneId: updatedSave.runtime.currentSceneId,
            },
          };
        }

        // Combat continues - immediately advance to next living actor
        // Update combat state with updated participants before recursive call
        const combatAfterKo = updatedSave.runtime.combat;
        if (combatAfterKo) {
          // The actor that just died was at newCurrentIndex in the old participants list
          // We need to advance from the previous actor (combat.currentIndex) in the updated alive list
          // Use the prevActorId already declared above (line 251)
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
                ...combatAfterKo,
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

  // Recompute alive participants based on current HP (after condition effects)
  // This ensures participants list reflects any HP changes from bleeding
  const finalAliveParticipants =
    updatedSave.runtime.combat?.participants.filter((id) => {
      const actor = updatedSave.actorsById[id];
      return actor && actor.resources.hp > 0;
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
