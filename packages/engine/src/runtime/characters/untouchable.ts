import type { Actor, ActorId, GameSave } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "./bonuses";
import { getTalentById } from "../../content/loadCatalogs";

export const TALENT_ANTIMAGIC_FIELD_1 = "talent:antimagic_field_1";
export const TALENT_ANTIMAGIC_FIELD_2 = "talent:antimagic_field_2";

export function isUntouchable(actor: Actor | undefined): boolean {
  return !!actor?.traits?.["trait:untouchable"];
}

export function getUntouchableWilBonus(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): number {
  return getCharacteristicBonus(save, actorId, "WIL", catalogs);
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

  const wilBonus = getUntouchableWilBonus(save, actorId, catalogs);
  if (hasCatalogTalent(actor, catalogs, TALENT_ANTIMAGIC_FIELD_2)) {
    return wilBonus;
  }
  if (hasCatalogTalent(actor, catalogs, TALENT_ANTIMAGIC_FIELD_1)) {
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

  const wilBonus = getUntouchableWilBonus(save, actorId, catalogs);
  return wilBonus * 5;
}

export function getUntouchableMagicResistance(
  save: GameSave,
  catalogs: CharacterCatalogs | undefined,
  actorId: ActorId
): number {
  const actor = save.actorsById[actorId];
  if (!actor || !isUntouchable(actor)) return 0;

  return getUntouchableWilBonus(save, actorId, catalogs);
}
