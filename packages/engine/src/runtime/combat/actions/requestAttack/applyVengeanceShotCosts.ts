import type { Effect, GameSave } from "../../../types";
import type { loadCharacterCatalogs } from "../../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../../characters/actions";
import { applyBlockedCheck } from "./applyBlockedCheck";

export function applyVengeanceShotCosts(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  attacker: GameSave["actorsById"][string],
  currentSave: GameSave,
  catalogs: ReturnType<typeof loadCharacterCatalogs> | undefined,
): { save: GameSave; blocked?: GameSave } {
  if (!effect.vengeanceShot) return { save: currentSave };
  if (effect.mode !== "RANGED") {
    return {
      save: currentSave,
      blocked: applyBlockedCheck(currentSave, effect.attackerId, ["combat:blocked=vengeanceMeleeOnly"]),
    };
  }
  if (catalogs && !hasUnlockedAction(currentSave, catalogs, effect.attackerId, "combat:vengeanceShot")) {
    return {
      save: currentSave,
      blocked: applyBlockedCheck(currentSave, effect.attackerId, [
        "combat:blocked=actionNotUnlocked",
        "combat:vengeanceShot=1",
      ]),
    };
  }
  const fatePoints = attacker.resources.fatePoints ?? 0;
  if (fatePoints <= 0) {
    return {
      save: currentSave,
      blocked: applyBlockedCheck(currentSave, effect.attackerId, [
        "combat:blocked=noFatePoint",
        "combat:vengeanceShot=1",
      ]),
    };
  }
  return {
    save: {
      ...currentSave,
      actorsById: {
        ...currentSave.actorsById,
        [effect.attackerId]: {
          ...attacker,
          resources: {
            ...attacker.resources,
            fatePoints: fatePoints - 1,
          },
        },
      },
    },
  };
}
