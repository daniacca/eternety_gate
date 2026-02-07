import type { Actor, CombatAttackCheck, Effect, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import type { IRNG } from "../../rng";
import type { StoryPack } from "../../types";
import { appendCombatLog } from "../narration";
import { applyDamageToActor } from "../criticalDamage";

export function applyFireShieldBacklash(params: {
  save: GameSave;
  check: CombatAttackCheck;
  attacker: Actor;
  defender: Actor;
  rng: IRNG;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
  effects: Effect[];
}): { save: GameSave; effects: Effect[] } {
  const { save, check, attacker, defender, rng, storyPack, catalogs, effects } = params;
  let updatedSave = save;
  const emittedEffects: Effect[] = [...effects];

  const fireShield = defender.conditions?.fire_shield;
  if (fireShield && check.attacker.mode === "RANGED") {
    const wilBonus = typeof fireShield.params?.wilBonus === "number" ? fireShield.params.wilBonus : 0;
    const overcast = typeof fireShield.params?.overcast === "number" ? fireShield.params.overcast : 0;
    const backlashDamage = Math.max(0, wilBonus + overcast);
    if (backlashDamage > 0) {
      const backlashResult = applyDamageToActor(attacker, backlashDamage, updatedSave, rng, storyPack, catalogs);
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [attacker.id]: backlashResult.updatedActor,
        },
      };
      if (backlashResult.effects?.length) {
        emittedEffects.push(...backlashResult.effects);
      }
      const attackerName = attacker.name || attacker.id;
      updatedSave = appendCombatLog(
        updatedSave,
        `${attackerName} viene colpito dal contraccolpo dello Scudo di Fuoco (${backlashDamage}).`,
      );
    }
  }

  return { save: updatedSave, effects: emittedEffects };
}
