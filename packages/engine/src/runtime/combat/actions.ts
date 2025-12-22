import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG, RNG } from "../rng";
import { getCurrentTurnActorId, startCombat, advanceCombatTurn } from "./combat";
import { appendCombatLog } from "./narration";
import { runNpcTurn } from "./npcAi";

/**
 * Starts combat with given participant IDs, grid, and placements
 */
export function combatStart(
  effect: Extract<Effect, { op: "combatStart" }>,
  storyPack: StoryPack,
  save: GameSave
): GameSave {
  return startCombat(
    storyPack,
    save,
    effect.participantIds,
    save.runtime.currentSceneId,
    effect.grid,
    effect.placements
  );
}

/**
 * Moves actor in combat grid
 */
export function combatMove(effect: Extract<Effect, { op: "combatMove" }>, save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    // Not in combat - ignore
    const ignoredCheck = {
      checkId: "combat:move:ignored",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:move:ignored"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: ignoredCheck,
      },
    };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  if (combat.turn.moveRemaining <= 0) {
    // Movement exhausted
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=movementExhausted"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  // Calculate delta based on direction
  const dirDeltas: Record<string, { x: number; y: number }> = {
    N: { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E: { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S: { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W: { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
  };

  const delta = dirDeltas[effect.dir];
  if (!delta) {
    return save;
  }

  const currentPos = combat.positions[turnActorId] || { x: 0, y: 0 };
  const newPos = {
    x: Math.max(0, Math.min(combat.grid.width - 1, currentPos.x + delta.x)),
    y: Math.max(0, Math.min(combat.grid.height - 1, currentPos.y + delta.y)),
  };

  const updatedPositions = {
    ...combat.positions,
    [turnActorId]: newPos,
  };

  const updatedCombat = {
    ...combat,
    positions: updatedPositions,
    turn: {
      ...combat.turn,
      moveRemaining: Math.max(0, combat.turn.moveRemaining - 1),
    },
  };

  const moveCheck = {
    checkId: "combat:move",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: [`combat:move=${effect.dir}`, `combat:pos:${turnActorId}=${newPos.x},${newPos.y}`],
  };

  const actor = save.actorsById[turnActorId];
  const dirLabels: Record<string, string> = {
    N: "nord",
    NE: "nord-est",
    E: "est",
    SE: "sud-est",
    S: "sud",
    SW: "sud-ovest",
    W: "ovest",
    NW: "nord-ovest",
  };
  const dirLabel = dirLabels[effect.dir] || effect.dir;
  const logEntry =
    actor?.kind === "PC" ? `Ti muovi verso ${dirLabel}.` : `${actor?.name || turnActorId} avanza verso di te.`;

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: moveCheck,
    },
  };

  // Add narration to combat log
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return updatedSave;
}

/**
 * Defend action: consumes action and sets stance to "defend"
 */
export function combatDefend(effect: Extract<Effect, { op: "combatDefend" }>, save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return save;
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:defend:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:defend:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionSpent"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      stance: "defend" as const,
    },
  };

  const defendCheck = {
    checkId: "combat:defend",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: ["combat:defend=1", "combat:stance=defend"],
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: defendCheck,
    },
  };

  // Add narration
  const actor = save.actorsById[turnActorId];
  const logEntry =
    actor?.kind === "PC" ? `Ti prepari a difenderti.` : `${actor?.name || turnActorId} si prepara a difendersi.`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return updatedSave;
}

/**
 * Aim action: consumes action (stub for future +20 bonus)
 */
export function combatAim(effect: Extract<Effect, { op: "combatAim" }>, save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return save;
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:aim:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:aim:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionSpent"],
    };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
  }

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      // Future: add aimed flag here
    },
  };

  const aimCheck = {
    checkId: "combat:aim",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: ["combat:aim=1"],
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: aimCheck,
    },
  };

  // Add narration
  const actor = save.actorsById[turnActorId];
  const logEntry = actor?.kind === "PC" ? `Prendi la mira.` : `${actor?.name || turnActorId} prende la mira.`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return updatedSave;
}

/**
 * Ends the current turn and advances to next actor, running NPC turns until player's turn
 */
export function combatEndTurn(
  effect: Extract<Effect, { op: "combatEndTurn" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return save;
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn - ignore
    return save;
  }

  // Add narration before ending turn
  const actor = save.actorsById[turnActorId];
  const logEntry = actor?.kind === "PC" ? `Termini il turno.` : `${actor?.name || turnActorId} termina il turno.`;
  let currentSave: GameSave = appendCombatLog(save, logEntry);

  // Set combatTurnStartIndex at the start of player "turn chunk" (before advancing and running NPC loop)
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      rngCounter: rng.getCounter(),
      combatTurnStartIndex: currentSave.runtime.combatLog?.length ?? 0,
    },
  };
  currentSave = advanceCombatTurn(currentSave);

  // Loop: run NPC turns until it's player's turn again
  let safety = 0;
  while (currentSave.runtime.combat?.active && getCurrentTurnActorId(currentSave) !== currentSave.party.activeActorId) {
    const npcId = getCurrentTurnActorId(currentSave);
    if (!npcId) break;

    const npcRng = new RNG(currentSave.runtime.rngSeed, currentSave.runtime.rngCounter || 0);
    currentSave = runNpcTurn(storyPack, currentSave, npcId);
    currentSave = advanceCombatTurn(currentSave);

    safety++;
    if (safety > 10) break; // safety guard
  }

  return currentSave;
}
