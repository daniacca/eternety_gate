import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";

/**
 * Aim action: consumes action (stub for future +20 bonus)
 */
export function combatAim(
  effect: Extract<Effect, { op: "combatAim" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
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
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
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
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Set aim stance and consume action + all movement
  const updatedStancesByActorId = {
    ...(combat.stancesByActorId || {}),
    [turnActorId]: "aim" as const,
  };

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      moveRemaining: 0, // Consume all movement
    },
    stancesByActorId: updatedStancesByActorId,
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
    tags: ["combat:aim=1", "combat:kind=action", "combat:stance=aim"],
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

  return { save: updatedSave };
}

