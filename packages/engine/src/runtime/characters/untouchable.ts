import type { Actor, ActorId, GameSave } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "./bonuses";
import { getTalentById } from "../../content/loadCatalogs";

export const TALENT_ARCANE_ABJURATION_1 = "talent:arcane_abjuration_1";
export const TALENT_ARCANE_ABJURATION_2 = "talent:arcane_abjuration_2";
export const TALENT_ARCANE_ABJURATION_3 = "talent:arcane_abjuration_3";
export const TALENT_SOULLESS_AURA_1 = "talent:soulless_aura_1";
export const TALENT_SOULLESS_AURA_2 = "talent:soulless_aura_2";

export function isUntouchable(actor: Actor | undefined): boolean {
  return !!actor?.traits?.["trait:untouchable"];
}

export function getUntouchableEffectiveWilBonus(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): number {
  const actor = save.actorsById[actorId];
  if (!actor || !isUntouchable(actor)) return 0;

  const baseBonus = getCharacteristicBonus(save, actorId, "WIL", catalogs);
  const arcaneBonus =
    (actor.talents[TALENT_ARCANE_ABJURATION_1] ?? 0) +
    (actor.talents[TALENT_ARCANE_ABJURATION_2] ?? 0) +
    (actor.talents[TALENT_ARCANE_ABJURATION_3] ?? 0);

  return baseBonus + arcaneBonus;
}

function hasCatalogTalent(actor: Actor, catalogs: CharacterCatalogs | undefined, talentId: string): boolean {
  if (!catalogs) return false;
  if (!getTalentById(catalogs, talentId)) return false;
  return (actor.talents[talentId] ?? 0) > 0;
}

export function getUntouchableAuraRadius(
  save: GameSave,
  catalogs: CharacterCatalogs | undefined,
  actorId: ActorId
): number {
  const actor = save.actorsById[actorId];
  if (!actor || !isUntouchable(actor)) return 0;

  const wilBonus = getUntouchableEffectiveWilBonus(save, actorId, catalogs);
  if (hasCatalogTalent(actor, catalogs, TALENT_SOULLESS_AURA_2)) {
    return wilBonus;
  }
  if (hasCatalogTalent(actor, catalogs, TALENT_SOULLESS_AURA_1)) {
    return Math.ceil(wilBonus / 2);
  }

  return 1;
}

export function getUntouchableDenyBonus(
  save: GameSave,
  catalogs: CharacterCatalogs | undefined,
  actorId: ActorId
): number {
  const actor = save.actorsById[actorId];
  if (!actor || !isUntouchable(actor)) return 0;

  const wilBonus = getUntouchableEffectiveWilBonus(save, actorId, catalogs);
  return wilBonus * 5;
}

export function getUntouchableMagicResistance(
  save: GameSave,
  catalogs: CharacterCatalogs | undefined,
  actorId: ActorId
): number {
  const actor = save.actorsById[actorId];
  if (!actor || !isUntouchable(actor)) return 0;

  return getUntouchableEffectiveWilBonus(save, actorId, catalogs);
}
