import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "./modifiers";
import { getCharacteristicBonus } from "../actors/bonuses";

/**
 * Gets ranged damage bonus from Mighty Shot talent
 * - rank 0: +0
 * - rank 1: +ceil(BS_bonus/2)
 * - rank 2: +BS_bonus
 */
export function getRangedDamageBonusFromMightyShot(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId
): number {
  const rank = getModifierTotal(save, catalogs, actorId, "combat.rangedDamageFlatFromBSBonusRank" as any);
  
  if (rank === 0) {
    return 0;
  }

  const bsBonus = getCharacteristicBonus(save, actorId, "BS", catalogs);

  if (rank === 1) {
    return Math.ceil(bsBonus / 2);
  } else if (rank >= 2) {
    return bsBonus;
  }

  return 0;
}

