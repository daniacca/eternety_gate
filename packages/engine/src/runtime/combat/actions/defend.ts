import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";

/**
 * Defend action: consumes action and sets stance to "defend"
 */
export function combatDefend(
  effect: Extract<Effect, { op: "combatDefend" }>,
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
      checkId: "combat:defend:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
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

  // Update stance in stancesByActorId
  const updatedStancesByActorId = {
    ...(combat.stancesByActorId || {}),
    [turnActorId]: "defend" as const,
  };

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false, // Consume action
    },
    stancesByActorId: updatedStancesByActorId,
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
    tags: ["combat:defend=1", "combat:stance=defend", "combat:kind=action"],
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
    actor?.kind === "PC"
      ? `Assumi una posizione difensiva.`
      : `${actor?.name || turnActorId} assume una posizione difensiva.`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return { save: updatedSave };
}

