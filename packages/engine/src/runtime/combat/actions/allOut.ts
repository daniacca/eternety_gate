import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { resolveActor } from "../../checks";
import { distanceChebyshev } from "../movement";
import { getEquippedWeaponId } from "../../characters/inventory";

/**
 * All-Out Attack effect: sets stance, disables parry for attacker, and triggers immediate attack
 */
export function combatAllOut(
  effect: Extract<Effect, { op: "combatAllOut" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat || !combat.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId) {
    return { save };
  }

  // Validate action available
  if (!combat.turn.actionAvailable) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
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

  // Validate target in melee range
  const attackerPos = combat.positions[turnActorId];
  const targetPos = combat.positions[effect.targetId];
  if (!attackerPos || !targetPos) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noPosition"],
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

  const dist = distanceChebyshev(attackerPos, targetPos);
  if (dist > 1) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
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

  // Set stance to "allOut"
  const updatedStancesByActorId = {
    ...(combat.stancesByActorId || {}),
    [turnActorId]: "allOut" as const,
  };

  // Set parry disabled until attacker's next turn
  const currentTurnCounter = combat.turnCounter ?? 0;
  const parryDisabledUntilTurnCounterByActorId = {
    ...(combat.parryDisabledUntilTurnCounterByActorId || {}),
    [turnActorId]: currentTurnCounter + 1,
  };

  // Reset channeling (non-magic action)
  const updatedCombat = {
    ...combat,
    stancesByActorId: updatedStancesByActorId,
    parryDisabledUntilTurnCounterByActorId,
    channeling: combat.channeling?.actorId === turnActorId ? undefined : combat.channeling,
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  // Add narration for all-out attack
  const actor = save.actorsById[turnActorId];
  const logEntry =
    actor?.kind === "PC"
      ? `Ti sbilanci in un attacco totale!`
      : `${actor?.name || turnActorId} si sbilancia in un attacco totale!`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  // Get attacker weapon
  const attacker = resolveActor({ mode: "byId", actorId: turnActorId }, updatedSave);
  if (!attacker) {
    return { save: updatedSave };
  }

  const weaponId = getEquippedWeaponId(attacker);

  // Emit combatRequestAttack effect with explicit +20 hitBonus modifier
  // The check will be performed by combatRequestAttack and will be recorded in lastCheck
  const attackEffect: Effect = {
    op: "combatRequestAttack",
    attackerId: turnActorId,
    defenderId: effect.targetId,
    mode: "MELEE",
    weaponId: weaponId === "unarmed" ? null : weaponId,
    modifiers: {
      hitBonus: 20,
    },
    defense: {
      allowParry: true,
      allowDodge: true,
      strategy: "autoBest",
    },
  };

  return { save: updatedSave, emittedEffects: [attackEffect] };
}

