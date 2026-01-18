import type { ActorId, GameSave } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "../characters/modifiers";
import { getUntouchableAuraRadius, getUntouchableEffectiveWilBonus, isUntouchable } from "../characters/untouchable";
import { footprintDistanceBetweenActors } from "../combat/footprint";

/**
 * Computes magic resistance for spell resolution, including untouchable aura when applicable.
 */
export function getMagicResistanceAgainstSpell(
  save: GameSave,
  targetActorId: ActorId,
  _casterActorId: ActorId | null,
  catalogs: CharacterCatalogs
): number {
  const baseMR = getModifierTotal(save, catalogs, targetActorId, "magic.resistance");

  let auraMR = 0;
  const combat = save.runtime.combat;
  if (combat?.active) {
    for (const otherId of combat.participants) {
      const otherActor = save.actorsById[otherId];
      if (!otherActor || !isUntouchable(otherActor)) continue;

      const radius = getUntouchableAuraRadius(save, catalogs, otherId);
      if (radius <= 1) continue;

      const dist = footprintDistanceBetweenActors(save, targetActorId, otherId);
      if (dist > radius) continue;

      const fieldBonus = getUntouchableEffectiveWilBonus(save, otherId, catalogs);
      if (fieldBonus > auraMR) {
        auraMR = fieldBonus;
      }
    }
  }

  return Math.max(baseMR, auraMR);
}
