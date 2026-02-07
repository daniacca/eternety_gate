import type { Actor, CombatAttackCheck, Effect, GameSave } from "../../types";
import { appendCombatLog } from "../narration";

export function applyCalledShotEffects(params: {
  save: GameSave;
  check: CombatAttackCheck;
  attacker: Actor;
  defender: Actor;
  didApplyDamage: boolean;
  finalDamage: number;
}): { save: GameSave; effects: Effect[] } {
  const { save, check, attacker, defender, didApplyDamage, finalDamage } = params;
  let updatedSave = save;
  const calledShotEffects: Effect[] = [];

  const calledShotZone = check.modifiers?.calledShotZone;
  if (check.modifiers?.calledShot && didApplyDamage && calledShotZone) {
    if (calledShotZone === "arms") {
      calledShotEffects.push({
        op: "combatDisarm",
        attackerId: attacker.id,
        defenderId: defender.id,
      });
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo al braccio disarma ${defender.name || "il bersaglio"}!`
          : `${attacker.name} disarma ${defender.name || "il bersaglio"} con un colpo al braccio!`,
      );
    } else if (calledShotZone === "legs") {
      calledShotEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "prone",
        source: "calledShot:legs",
      });
      calledShotEffects.push({
        op: "addCondition",
        actorId: defender.id,
        condition: "halvedMovement",
        durationTurns: 2,
        source: "calledShot:legs",
      });
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo alla gamba fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`
          : `${attacker.name} fa cadere ${defender.name || "il bersaglio"} a terra con movimento dimezzato!`,
      );
    } else if (calledShotZone === "head" && finalDamage > 0) {
      updatedSave = appendCombatLog(
        updatedSave,
        attacker.kind === "PC"
          ? `Il colpo alla testa infligge danni raddoppiati!`
          : `${attacker.name} colpisce alla testa con danni raddoppiati!`,
      );
    }
  }

  return { save: updatedSave, effects: calledShotEffects };
}
