import type { GameSave, ActorId } from "../types";
import { getMcMax, setMcCurrent } from "../magic/od";
import type { CharacterCatalogs } from "../../content/catalogs";

/**
 * Restores MC_CURRENT to MC_MAX for all party actors.
 * Call from rest/camp scene choice or end-of-day effect.
 */
export function applyLongRest(
  save: GameSave,
  catalogs?: CharacterCatalogs
): GameSave {
  const partyActors = save.party?.actors ?? [];
  let out = save;
  for (const actorId of partyActors) {
    const actor = out.actorsById[actorId as ActorId];
    if (!actor) continue;
    const computedMax = getMcMax(out, actorId as ActorId, catalogs);
    out = setMcCurrent(out, actorId as ActorId, computedMax, computedMax);
  }
  return out;
}
