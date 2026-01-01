import type { StoryPack, GameSave, Actor, ActorId, SceneId, Grid, Position, CombatState, CheckResult } from "../types";
import { RNG } from "../rng";
import { clampToGrid } from "./movement";
import { appendCombatLog } from "./narration";

/**
 * Calculates AGI bonus for movement: Math.floor(AGI / 10)
 */
function calculateAgiBonus(agi: number | undefined): number {
  return Math.floor((agi ?? 0) / 10);
}

/**
 * Initializes turn state for an actor based on their AGI
 */
function initializeTurnState(actor: Actor): {
  moveRemaining: number;
  actionAvailable: boolean;
} {
  const agiBonus = calculateAgiBonus(actor.stats.AGI);
  return {
    moveRemaining: Math.max(1, agiBonus), // Minimum 1 movement
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

  // Initialize turn state for new actor
  const newActor = updatedSave.actorsById[currentTurnActorId];
  const newTurnState = newActor ? initializeTurnState(newActor) : { moveRemaining: 0, actionAvailable: true };

  // Reset stance for actor whose turn starts (stances last "until your next turn")
  // Remove the key instead of setting "none" (absence means "none")
  const updatedStancesByActorId = { ...(combat.stancesByActorId || {}) };
  delete updatedStancesByActorId[currentTurnActorId];

  // Increment turn counter (monotonic)
  const newTurnCounter = (combat.turnCounter ?? 0) + 1;

  const newCombatState: CombatState = {
    ...combat,
    participants: aliveParticipants,
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
  updatedSave = appendCombatLog(updatedSave, turnHeader);

  return updatedSave;
}
