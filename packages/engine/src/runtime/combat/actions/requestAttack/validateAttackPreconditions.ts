import type { Effect, GameSave } from "../../../types";
import { resolveActor } from "../../../checks";
import { footprintDistanceBetweenActors } from "../../footprint";
import { applyBlockedCheck } from "./applyBlockedCheck";

export type AttackPreconditionsResult =
  | { ok: false; save: GameSave }
  | {
      ok: true;
      dist: number;
      attackerPos: { x: number; y: number };
      defenderPos: { x: number; y: number };
    };

export function validateAttackPreconditions(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  save: GameSave,
  combat: NonNullable<GameSave["runtime"]["combat"]>,
): AttackPreconditionsResult {
  const turnActorId = combat.participants[combat.currentIndex];
  if (!turnActorId || turnActorId !== effect.attackerId) {
    return {
      ok: false,
      save: applyBlockedCheck(save, effect.attackerId, [
        "combat:blocked=notYourTurn",
        `combat:turn=${turnActorId || "unknown"}`,
      ]),
    };
  }

  if (!combat.turn.actionAvailable) {
    return {
      ok: false,
      save: applyBlockedCheck(save, effect.attackerId, ["combat:blocked=noAction"]),
    };
  }

  const defenderActor = save.actorsById[effect.defenderId];
  if (!defenderActor || defenderActor.resources.isDead === true) {
    return {
      ok: false,
      save: applyBlockedCheck(save, effect.attackerId, [
        "combat:blocked=targetDead",
        `combat:defenderId=${effect.defenderId}`,
      ]),
    };
  }

  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    return {
      ok: false,
      save: applyBlockedCheck(save, effect.attackerId, ["combat:blocked=noPosition"]),
    };
  }

  const dist = footprintDistanceBetweenActors(save, effect.attackerId, effect.defenderId);
  if (effect.mode === "MELEE") {
    if (dist > 1) {
      return {
        ok: false,
        save: applyBlockedCheck(save, effect.attackerId, ["combat:blocked=notInMelee", `combat:dist=${dist}`]),
      };
    }
  } else if (effect.mode === "RANGED") {
    const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, save);
    if (!attacker) {
      return { ok: false, save };
    }
  }

  return {
    ok: true,
    dist,
    attackerPos,
    defenderPos,
  };
}
