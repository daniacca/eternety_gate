import type { GameSave } from "../../../types";

export function getEquippedWeaponIds(
  actor: GameSave["actorsById"][string],
): { main?: string | null; off?: string | null } {
  if (!actor) return {};
  const main = actor.equipment?.mainHand?.kind === "weapon" ? actor.equipment.mainHand.id : null;
  const off = actor.equipment?.offHand?.kind === "weapon" ? actor.equipment.offHand.id : null;
  return { main, off };
}
