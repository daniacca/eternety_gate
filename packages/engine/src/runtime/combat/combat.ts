import type { StoryPack, GameSave, Actor, ActorId, SceneId, Grid, Position, CombatState, CheckResult } from "../types";
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
import { getInitiativeBonus, getCharacteristicBonusBase } from "../characters/bonuses";
import { applyArmorAgiCap } from "../characters/effectiveStats";
import { loadCharacterCatalogs, loadTerrainCatalogs } from "../../content/loadCatalogs";
import type { CharacterCatalogs } from "../../content/catalogs";
import { calculateMaxHp } from "../characters/hp";
import { removeUnnaturalCharacteristicsBySource } from "../characters/traitHelpers";
import { applyDamageToActor } from "./criticalDamage";
import { isActorAlive, getSizeMovementModifier } from "../characters/actors";
import { performCheckWithSave } from "../checks";
import type { SingleCheck } from "../types";
import { getModifierTotal } from "../characters/modifiers";
import { hasTalentHook } from "../characters/talentModifiers";
import {
  getCombatDamageTracking,
  resetCombatDamageTrackingForActor,
  trackCombatSelfDamage,
} from "./damageTracking";
import { getUntouchableAuraImpact } from "./untouchableAura";
import { getActorSize, getFootprintCells, getFootprintRadius } from "./footprint";
import { posKey } from "../items/posKey";

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
 * Ensures combat end state is applied consistently.
 *
 * Why: different kill sources (spells, effects, conditions) may update isDead
 * without going through the attack action handlers that currently stamp
 * `combat:state=end` and `combatEndedSceneId`.
 *
 * This helper can be called after any batch of effects to make sure victory/defeat
 * UI triggers reliably.
 */
export function finalizeCombatIfEnded(save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  const aliveParticipants = combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });

  const end = shouldCombatEnd(save, aliveParticipants);
  if (!end.shouldEnd) return save;

  const outcome = end.outcome || "victory";
  const winnerId = end.winnerId;
  const endedSceneId = combat.startedBySceneId || save.runtime.currentSceneId;

  const last = save.runtime.lastCheck;
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

  const logEntry =
    outcome === "victory" ? "Tutti i nemici presenti nell'area sono stati sconfitti." : "Il party è stato annientato. Game over.";

  const clearedActorsById = clearCombatEndConditions(save, combat.participants);

  const updatedSave: GameSave = {
    ...save,
    actorsById: clearedActorsById,
    runtime: {
      ...save.runtime,
      combat: undefined,
      lastCheck: endCheck,
      combatEndedSceneId: endedSceneId,
    },
  };

  return appendCombatLog(updatedSave, logEntry);
}

export function clearCombatEndConditions(save: GameSave, participants: ActorId[]): GameSave["actorsById"] {
  const clearedActorsById = { ...save.actorsById };
  for (const actorId of participants) {
    const actor = clearedActorsById[actorId];
    if (!actor) continue;
    let updatedActor = actor;

    if (actor.conditions) {
      for (const [conditionId, instance] of Object.entries(actor.conditions)) {
        if (conditionId !== "shock" && instance.untilTurnCounter === undefined) {
          continue;
        }
        if (instance.source) {
          updatedActor = removeUnnaturalCharacteristicsBySource(updatedActor, instance.source);
        }
        updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
      }
    }

    if (updatedActor.status?.tempModifiers?.length) {
      const filteredMods = updatedActor.status.tempModifiers.filter((mod) => mod.expires === undefined);
      if (filteredMods.length !== updatedActor.status.tempModifiers.length) {
        updatedActor = {
          ...updatedActor,
          status: {
            ...updatedActor.status,
            tempModifiers: filteredMods,
          },
        };
      }
    }

    if (updatedActor !== actor) {
      clearedActorsById[actorId] = updatedActor;
    }
  }
  return clearedActorsById;
}

/**
 * Calculates initial movement for an actor based on AGI bonus, size, and conditions
 * This is used to determine the starting movement value for a turn
 *
 * @param actor - The actor
 * @param save - The game save
 * @param catalogs - Character catalogs (optional, required for catalog-based AGI bonuses)
 */
export function calculateInitialMovement(actor: Actor, save: GameSave, catalogs?: CharacterCatalogs): number {
  const modifiers = computeCombatModifiersFromConditions(actor);
  const moveDelta = modifiers.moveDelta ?? 0;

  const fallbackFlySpeed =
    typeof actor.traits?.["trait:flyer"] === "object" && typeof actor.traits["trait:flyer"].x === "number"
      ? actor.traits["trait:flyer"].x
      : 0;
  const flySpeed = catalogs ? getModifierTotal(save, catalogs, actor.id, "movement.flySpeed") : fallbackFlySpeed;
  const canFly = catalogs
    ? getModifierTotal(save, catalogs, actor.id, "movement.canFly") > 0
    : fallbackFlySpeed > 0;

  if (canFly && flySpeed > 0) {
    let baseMove = Math.max(1, flySpeed + moveDelta);
    if (hasCondition(actor, "halvedMovement")) {
      baseMove = Math.max(1, Math.floor(baseMove / 2));
    }
    return Math.max(1, baseMove);
  }

  const bonusAdd = catalogs ? getModifierTotal(save, catalogs, actor.id, "stat.AGI.bonusAdd") : 0;
  const cappedAgi = applyArmorAgiCap(save, actor.id, actor.stats.AGI);
  let agiBonus = getCharacteristicBonusBase(cappedAgi) + bonusAdd;
  if (catalogs && hasTalentHook(actor, catalogs, "sprint")) {
    agiBonus = Math.floor(agiBonus * 1.5);
  }
  const sizeModifier = getSizeMovementModifier(actor);
  let baseMove = Math.max(1, agiBonus + sizeModifier + moveDelta);
  
  // Called Shot to legs: halve movement
  if (hasCondition(actor, "halvedMovement")) {
    baseMove = Math.max(1, Math.floor(baseMove / 2));
  }
  
  return Math.max(1, baseMove); // Minimum 1 movement
}

/**
 * Initializes turn state for an actor based on their AGI, size, and conditions
 *
 * @param actor - The actor
 * @param save - The game save
 * @param catalogs - Character catalogs (optional, required for catalog-based AGI bonuses)
 */
function initializeTurnState(
  actor: Actor,
  save: GameSave,
  catalogs?: CharacterCatalogs
): {
  moveRemaining: number;
  actionAvailable: boolean;
} {
  const initialMove = calculateInitialMovement(actor, save, catalogs);
  return {
    moveRemaining: initialMove,
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
  placements?: Array<{ actorId: ActorId; x: number; y: number }>,
  partyPlacement?: { kind: "point"; x: number; y: number } | { kind: "area"; x: number; y: number; width: number; height: number },
  gridId?: string
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

  // Load catalogs from storyPack for initiative bonus calculation
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Calculate initiative for each participant
  type InitiativeEntry = {
    id: ActorId;
    iniBonus: number;
    iniRoll: number;
    iniScore: number;
  };

  const initiatives: InitiativeEntry[] = validParticipants.map((id) => {
    const iniBonus = getInitiativeBonus(save, id, catalogs);
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

  // Initialize grid: load from catalog if gridId provided, use explicit grid, or default to 10x10
  let combatGrid: Grid;
  if (gridId && storyPack) {
    // Try to load grid from catalog
    const terrainCatalogs = loadTerrainCatalogs(storyPack);
    const gridDef = terrainCatalogs.gridsById[gridId];
    if (gridDef) {
      combatGrid = { width: gridDef.width, height: gridDef.height };
    } else {
      // Fallback if gridId not found
      combatGrid = grid || { width: 10, height: 10 };
    }
  } else {
    // Use explicit grid or default
    combatGrid = grid || { width: 10, height: 10 };
  }

  // Initialize positions from placements
  const positions: Record<ActorId, Position> = {};
  if (placements) {
    for (const placement of placements) {
      if (orderedIds.includes(placement.actorId)) {
        positions[placement.actorId] = clampToGrid({ x: placement.x, y: placement.y }, combatGrid);
      }
    }
  }

  const terrainCatalogs = loadTerrainCatalogs(storyPack);
  const terrainGridId = gridId || "arena_01";
  const gridDef = terrainCatalogs.gridsById[terrainGridId];

  const isCellWalkable = (pos: Position): boolean => {
    if (!gridDef) return true;
    const override = gridDef.cells?.[posKey(pos)];
    return override?.walkable ?? gridDef.defaults?.walkable ?? true;
  };

  const occupiedCells = new Set<string>();
  const markOccupied = (actorId: ActorId, center: Position) => {
    const actor = save.actorsById[actorId];
    const radius = getFootprintRadius(getActorSize(actor));
    for (const cell of getFootprintCells(center, radius)) {
      occupiedCells.add(posKey(cell));
    }
  };

  for (const [actorId, pos] of Object.entries(positions)) {
    markOccupied(actorId as ActorId, pos);
  }

  const canPlaceAt = (actorId: ActorId, center: Position): boolean => {
    const actor = save.actorsById[actorId];
    const radius = getFootprintRadius(getActorSize(actor));
    for (const cell of getFootprintCells(center, radius)) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= combatGrid.width || cell.y >= combatGrid.height) {
        return false;
      }
      if (!isCellWalkable(cell)) return false;
      if (occupiedCells.has(posKey(cell))) return false;
    }
    return true;
  };

  const candidateCellsFromPlacement = (): Position[] => {
    if (!partyPlacement) return [];
    const cells: Position[] = [];
    if (partyPlacement.kind === "area") {
      const width = Math.max(1, partyPlacement.width);
      const height = Math.max(1, partyPlacement.height);
      for (let y = partyPlacement.y; y < partyPlacement.y + height; y++) {
        for (let x = partyPlacement.x; x < partyPlacement.x + width; x++) {
          if (x >= 0 && y >= 0 && x < combatGrid.width && y < combatGrid.height) {
            cells.push({ x, y });
          }
        }
      }
      return cells;
    }

    const origin = { x: partyPlacement.x, y: partyPlacement.y };
    if (origin.x >= 0 && origin.y >= 0 && origin.x < combatGrid.width && origin.y < combatGrid.height) {
      cells.push(origin);
    }
    const maxRadius = Math.max(combatGrid.width, combatGrid.height);
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = origin.x + dx;
          const y = origin.y + dy;
          if (x >= 0 && y >= 0 && x < combatGrid.width && y < combatGrid.height) {
            cells.push({ x, y });
          }
        }
      }
      if (cells.length >= combatGrid.width * combatGrid.height) break;
    }
    return cells;
  };

  const allGridCells: Position[] = [];
  for (let y = 0; y < combatGrid.height; y++) {
    for (let x = 0; x < combatGrid.width; x++) {
      allGridCells.push({ x, y });
    }
  }

  const candidateCells = candidateCellsFromPlacement();
  const partyMemberIds = save.party?.actors ?? [];
  for (const partyId of partyMemberIds) {
    if (!orderedIds.includes(partyId)) continue;
    if (positions[partyId]) continue;
    let placed = false;
    const preferred = candidateCells.length > 0 ? candidateCells : allGridCells;
    for (const cell of preferred) {
      if (canPlaceAt(partyId, cell)) {
        positions[partyId] = cell;
        markOccupied(partyId, cell);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const fallback = { x: 0, y: 0 };
      positions[partyId] = clampToGrid(fallback, combatGrid);
      markOccupied(partyId, positions[partyId]);
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
    ? initializeTurnState(firstActor, save, catalogs)
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
    gridId: gridId || "arena_01",
    positions,
    turn: initialTurnState,
    stancesByActorId: {},
    turnCounter: 0,
    parryDisabledUntilTurnCounterByActorId: {},
    weaponRechargeUntilTurnCounterByActorId: {},
    equippedThisRoundByActorId: {},
    initialHpByActorId,
    damageTakenSinceLastTurnByActorId: {},
    damageDealtSinceLastTurnByActorId: {},
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

  // Fear: apply willpower test at combat start
  const fearCatalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          items: storyPack.items || [],
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;
  const fearSources = orderedIds
    .map((id) => {
      const actor = save.actorsById[id];
      const fearParams = actor?.traits?.["trait:fear"];
      const fearRank =
        typeof fearParams === "object" && typeof fearParams.x === "number" ? fearParams.x : 0;
      return { id, fearRank };
    })
    .filter((entry) => entry.fearRank > 0);

  if (fearSources.length > 0) {
    for (const targetId of orderedIds) {
      const targetActor = updatedSave.actorsById[targetId];
      if (!targetActor) continue;
      if (targetActor.traits?.["trait:from_beyond"] !== undefined) {
        continue;
      }
      if (fearCatalogs && hasTalentHook(targetActor, fearCatalogs, "jaded")) {
        continue;
      }
      if (targetActor.conditions?.frenzy !== undefined) {
        continue;
      }
      const maxFear = Math.max(
        0,
        ...fearSources.filter((source) => source.id !== targetId).map((source) => source.fearRank)
      );
      if (maxFear <= 0) continue;
      const fearPenalty = -10 * Math.max(0, maxFear - 1);
      const fearCheck: SingleCheck = {
        id: `combat:fear:${targetId}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: targetId },
        key: "WIL",
        difficulty: "Challenging",
        modifier: fearPenalty,
      };
      const { result: fearResult, save: saveAfterFearCheck } = performCheckWithSave(
        fearCheck,
        storyPack,
        updatedSave,
        rng,
        `res:fear:${targetId}`
      );
      updatedSave = {
        ...saveAfterFearCheck,
        runtime: {
          ...saveAfterFearCheck.runtime,
          rngCounter: rng.getCounter(),
        },
      };
      if (!fearResult?.success) {
        const shockedActor = addConditionToActor(
          updatedSave.actorsById[targetId],
          "shock",
          1,
          undefined,
          "trait:fear"
        );
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [targetId]: shockedActor,
          },
        };
        const fearLog =
          targetActor.kind === "PC"
            ? "Sei terrorizzato dall'orrore innaturale e resti sotto shock."
            : `${targetActor.name || targetId} è terrorizzato dall'orrore innaturale e resta sotto shock.`;
        updatedSave = appendCombatLog(updatedSave, fearLog);
      }
    }
  }

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
export function advanceCombatTurn(save: GameSave, storyPack?: StoryPack): GameSave {
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

    const clearedActorsById = clearCombatEndConditions(save, combat.participants);

    let updatedSave = {
      ...save,
      actorsById: clearedActorsById,
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

  // Load catalogs from storyPack (if available) for movement calculation with trait bonuses
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Initialize turn state for new actor and apply condition effects
  let currentActor = updatedSave.actorsById[currentTurnActorId];
  let newTurnState = currentActor
    ? initializeTurnState(currentActor, updatedSave, catalogs)
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
      if (!damageResult.dieHardUsed && damage > 0) {
        updatedSave = trackCombatSelfDamage(updatedSave, currentTurnActorId, damage);
      }

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

          const clearedActorsById = { ...updatedSave.actorsById };
          for (const actorId of updatedSave.runtime.combat?.participants ?? []) {
            const actor = clearedActorsById[actorId];
            if (actor?.conditions?.shock) {
              clearedActorsById[actorId] = removeConditionFromActor(actor, "shock");
            }
          }

          return {
            ...updatedSave,
            actorsById: clearedActorsById,
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
          return advanceCombatTurn(updatedSave, storyPack);
        }
      }
    }

    // Check for bound condition - escape attempt
    if (hasCondition(currentActor, "bound")) {
      const boundCondition = currentActor.conditions?.bound;
      if (boundCondition?.untilTurnCounter !== undefined && boundCondition.untilTurnCounter >= newTurnCounter) {
        // Bound: set move to 0 and attempt escape
        newTurnState = {
          ...newTurnState,
          moveRemaining: 0,
        };

        // Create RNG for escape check
        const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);

        // Escape check: STR test -20
        const escapeCheck: SingleCheck = {
          id: `combat:bound:escape:${currentTurnActorId}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: currentTurnActorId },
          key: "STR",
          difficulty: "-20",
        };

        const { result, save: saveAfterCheck } = performCheckWithSave(
          escapeCheck,
          storyPack, // Optional storyPack for difficulty bands and criticals
          updatedSave,
          rng,
          `res:bound:escape:${currentTurnActorId}`
        );

        updatedSave = {
          ...saveAfterCheck,
          runtime: {
            ...saveAfterCheck.runtime,
            rngCounter: rng.getCounter(),
          },
        };

        if (result && result.success) {
          // Escape successful - remove bound condition
          currentActor = removeConditionFromActor(currentActor, "bound");
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [currentTurnActorId]: currentActor,
            },
          };
          const escapeLog = isPlayerActor
            ? "Riesci a liberarti dai legami!"
            : `${actorName} riesce a liberarsi dai legami!`;
          updatedSave = appendCombatLog(updatedSave, escapeLog);
        } else {
          // Still bound
          const boundLog = isPlayerActor
            ? "Sei legato e non puoi muoverti."
            : `${actorName} è legato e non può muoversi.`;
          updatedSave = appendCombatLog(updatedSave, boundLog);
        }
      }
    }

    // Spiritual Instability check (after condition ticks)
    if (currentActor.traits?.["trait:spiritual_instability"] !== undefined) {
      const tracking = getCombatDamageTracking(updatedSave, currentTurnActorId);
      const shouldCheckInstability = tracking.taken > 0 && tracking.dealt <= 0;

      if (shouldCheckInstability) {
        const rng = new RNG(updatedSave.runtime.rngSeed, updatedSave.runtime.rngCounter ?? 0);
        const auraImpact = catalogs ? getUntouchableAuraImpact(updatedSave, catalogs, currentTurnActorId) : null;
        const auraPenalty = auraImpact?.penalty ?? 0;

        const instabilityCheck: SingleCheck = {
          id: `combat:spiritualInstability:${currentTurnActorId}:${newTurnCounter}`,
          kind: "single",
          actorRef: { mode: "byId", actorId: currentTurnActorId },
          key: "WIL",
          difficulty: "Challenging",
          modifier: auraPenalty !== 0 ? auraPenalty : undefined,
        };

        const { result, save: saveAfterCheck } = performCheckWithSave(
          instabilityCheck,
          storyPack,
          updatedSave,
          rng,
          `res:spiritualInstability:${currentTurnActorId}:${newTurnCounter}`
        );

        updatedSave = {
          ...saveAfterCheck,
          runtime: {
            ...saveAfterCheck.runtime,
            rngCounter: rng.getCounter(),
          },
        };

        // Reset tracking for the new turn before applying any backlash damage
        updatedSave = resetCombatDamageTrackingForActor(updatedSave, currentTurnActorId);
        currentActor = updatedSave.actorsById[currentTurnActorId] || currentActor;

        if (result && !result.success) {
          const backlashDamage = 1 + result.dof;
          const damageResult = applyDamageToActor(currentActor, backlashDamage, updatedSave, rng, storyPack, catalogs);
          currentActor = damageResult.updatedActor;

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

          if (!damageResult.dieHardUsed && backlashDamage > 0) {
            updatedSave = trackCombatSelfDamage(updatedSave, currentTurnActorId, backlashDamage);
          }

          // Apply emitted effects (conditions from critical damage tiers)
          for (const effect of damageResult.effects) {
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

          const instabilityLog = isPlayerActor
            ? `La tua instabilita spirituale ti infligge ${backlashDamage} ferite.`
            : `${actorName} subisce ${backlashDamage} ferite per instabilita spirituale.`;
          updatedSave = appendCombatLog(updatedSave, instabilityLog);

          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: `Spiritual Instability: ${currentTurnActorId} suffers ${backlashDamage} damage`,
            turnCounter: newTurnCounter,
            tags: [
              "spirit:instability",
              `damage=${backlashDamage}`,
              ...(auraImpact ? [`aura:untouchable=${auraImpact.sourceId}`] : []),
            ],
          });

          const updatedActor = updatedSave.actorsById[currentTurnActorId];
          if (updatedActor && updatedActor.resources.isDead === true) {
            const deathLog = isPlayerActor ? "Sei morto!" : `${actorName} è morto!`;
            updatedSave = appendCombatLog(updatedSave, deathLog);

            const updatedAliveParticipants =
              updatedSave.runtime.combat?.participants.filter((id) => {
                const actor = updatedSave.actorsById[id];
                return isActorAlive(actor);
              }) || [];

            const endCheckResult = shouldCombatEnd(updatedSave, updatedAliveParticipants);
            if (endCheckResult.shouldEnd) {
              const outcome = endCheckResult.outcome || "victory";
              const winnerId = endCheckResult.winnerId;
              const combatState = updatedSave.runtime.combat;
              const endedSceneId = combatState?.startedBySceneId || updatedSave.runtime.currentSceneId;

              const endLog =
                outcome === "victory"
                  ? "Tutti i nemici presenti nell'area sono stati sconfitti."
                  : "Il party è stato annientato. Game over.";

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

              const clearedActorsById = { ...updatedSave.actorsById };
              for (const actorId of updatedSave.runtime.combat?.participants ?? []) {
                const actor = clearedActorsById[actorId];
                if (actor?.conditions?.shock) {
                  clearedActorsById[actorId] = removeConditionFromActor(actor, "shock");
                }
              }

              return {
                ...updatedSave,
                actorsById: clearedActorsById,
                runtime: {
                  ...updatedSave.runtime,
                  combat: undefined,
                  lastCheck: endCheck,
                  combatEndedSceneId: endedSceneId,
                },
              };
            }

            const combatAfterDeath = updatedSave.runtime.combat;
            if (combatAfterDeath) {
              const prevAliveIndex = updatedAliveParticipants.indexOf(prevActorId);
              const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : 0;

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

              return advanceCombatTurn(updatedSave, storyPack);
            }
          }
        }
      } else {
        updatedSave = resetCombatDamageTrackingForActor(updatedSave, currentTurnActorId);
      }
    } else {
      updatedSave = resetCombatDamageTrackingForActor(updatedSave, currentTurnActorId);
    }

    // Remove expired conditions (untilTurnCounter < current turnCounter)
    const conditionsToRemove: Array<{ conditionId: string; source?: string }> = [];

    if (currentActor.conditions) {
      for (const [conditionId, instance] of Object.entries(currentActor.conditions)) {
        if (instance.untilTurnCounter !== undefined && instance.untilTurnCounter < newTurnCounter) {
          conditionsToRemove.push({
            conditionId,
            source: instance.source,
          });
        }
      }

      for (const { conditionId, source } of conditionsToRemove) {
        // For steel_body and warp_speed, remove characteristics from trait before removing condition
        if ((conditionId === "steel_body" || conditionId === "warp_speed") && source) {
          currentActor = removeUnnaturalCharacteristicsBySource(currentActor, source);
        }
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

  // NOTE FOR Channeling persistence: Only reset if actor's make an action other than channeling,
  // OR Casting a spell. In all other cases, we persist the channeling state and we don't reset it
  // only by passing time.

  // Reset freeSpellUsedThisTurn ONLY for the actor whose turn is STARTING (nextTurnActorId)
  // Note: currentTurnActorId is the actor who will act NEXT (their turn is starting)
  const updatedFreeSpellUsed = {
    ...(combat.freeSpellUsedThisTurn || {}),
  };
  // Clear free spell flag for currentTurnActorId (the actor whose turn is starting)
  delete updatedFreeSpellUsed[currentTurnActorId];

  const newCombatState: CombatState = {
    ...combat,
    participants: finalAliveParticipants,
    currentIndex: newCurrentIndex,
    round: newRound,
    turn: newTurnState,
    stancesByActorId: updatedStancesByActorId,
    turnCounter: newTurnCounter,
    parryDisabledUntilTurnCounterByActorId: combat.parryDisabledUntilTurnCounterByActorId || {},
    weaponRechargeUntilTurnCounterByActorId: combat.weaponRechargeUntilTurnCounterByActorId || {},
    freeSpellUsedThisTurn: updatedFreeSpellUsed,
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
