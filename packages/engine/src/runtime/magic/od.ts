import type { GameSave, ActorId, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getCharacteristicBonus } from "../characters/bonuses";
import { getModifierTotal } from "../characters/modifiers";

/**
 * Base formula for Od (MC Max) for living creatures:
 * MC_MAX = (INT_BONUS + WIL_BONUS + CHA_BONUS) * MagicCoreMultiplier + modifiers
 * Magic Core(X) trait multiplies the base by X; otherwise multiplier is 1.
 * Extended by traits/items/talents via modifier key "magic.mcMax".
 */
export function getMcMax(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): number {
  const intBonus = getCharacteristicBonus(save, actorId, "INT", catalogs);
  const wilBonus = getCharacteristicBonus(save, actorId, "WIL", catalogs);
  const chaBonus = getCharacteristicBonus(save, actorId, "CHA", catalogs);
  let base = intBonus + wilBonus + chaBonus;

  const actor = save.actorsById[actorId];
  const magicCoreParams = actor?.traits?.["trait:magic_core"];
  const magicCoreX =
    typeof magicCoreParams === "object" && magicCoreParams !== null && typeof (magicCoreParams as { x?: number }).x === "number"
      ? (magicCoreParams as { x: number }).x
      : 1;
  base = base * Math.max(0, magicCoreX);

  const mod = catalogs ? getModifierTotal(save, catalogs, actorId, "magic.mcMax") : 0;
  return Math.max(0, base + mod);
}

/**
 * Returns current MC (Od reserve) for the actor.
 * If mcCurrent is undefined, returns mcMax (full reserve) for backward compatibility.
 */
export function getMcCurrent(actor: Actor, mcMax: number): number {
  if (actor.resources.mcCurrent !== undefined) {
    return Math.max(0, Math.min(actor.resources.mcCurrent, mcMax));
  }
  if (actor.resources.mcMax !== undefined) {
    const stored = actor.resources.mcCurrent ?? actor.resources.mcMax;
    return Math.max(0, Math.min(stored, mcMax));
  }
  return mcMax;
}

/**
 * Sets mcCurrent for an actor, clamped to [0, mcMax].
 * Does not modify mcMax.
 */
export function setMcCurrent(
  save: GameSave,
  actorId: ActorId,
  value: number,
  mcMax: number
): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;
  const clamped = Math.max(0, Math.min(value, mcMax));
  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: {
        ...actor,
        resources: {
          ...actor.resources,
          mcCurrent: clamped,
          mcMax: actor.resources.mcMax ?? mcMax,
        },
      },
    },
  };
}

/**
 * Ensures actor has mcMax and mcCurrent set (for migration).
 * If missing, sets mcMax from getMcMax and mcCurrent = mcMax.
 */
export function ensureMcReserve(
  save: GameSave,
  actorId: ActorId,
  catalogs?: CharacterCatalogs
): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;
  const mcMax = getMcMax(save, actorId, catalogs);
  const hasMc = actor.resources.mcMax !== undefined || actor.resources.mcCurrent !== undefined;
  if (hasMc) return save;
  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: {
        ...actor,
        resources: {
          ...actor.resources,
          mcMax,
          mcCurrent: mcMax,
        },
      },
    },
  };
}

/**
 * Migration: ensures all party actors (and optionally all actors in save) have MC reserve.
 * Call after loading a save from disk to support older saves without mcMax/mcCurrent.
 */
export function migrateSaveMcReserve(
  save: GameSave,
  catalogs?: CharacterCatalogs,
  partyOnly: boolean = true
): GameSave {
  const actorIds = partyOnly ? (save.party?.actors ?? []) : Object.keys(save.actorsById);
  let out = save;
  for (const id of actorIds) {
    if (save.actorsById[id]) {
      out = ensureMcReserve(out, id as ActorId, catalogs);
    }
  }
  return out;
}
