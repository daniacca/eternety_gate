import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getTalentById, getTraitById } from "../../content/loadCatalogs";
import { resolveActor } from "../checks";

/**
 * Checks if an actor has unlocked a specific action via talents or traits
 * This is the single source of truth for action unlock checks
 */
export function hasUnlockedAction(
  save: GameSave,
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  actionId: string
): boolean {
  const actor = resolveActor({ mode: "byId", actorId }, save);
  if (!actor) return false;

  // Check talents
  for (const [talentId, rank] of Object.entries(actor.talents)) {
    if (rank < 1) continue;
    const talent = getTalentById(catalogs, talentId);
    if (!talent) continue;

    for (const grant of talent.grants) {
      if (grant.type === "unlockAction" && grant.actionId === actionId) {
        return true;
      }
    }
  }

  // Check traits
  for (const traitId of Object.keys(actor.traits)) {
    const trait = getTraitById(catalogs, traitId);
    if (!trait) continue;

    for (const grant of trait.grants) {
      if (grant.type === "unlockAction" && grant.actionId === actionId) {
        return true;
      }
    }
  }

  return false;
}
