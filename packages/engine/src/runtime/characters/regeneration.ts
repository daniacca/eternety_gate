import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { performCheck } from "../checks";
import type { StoryPack, SingleCheck } from "../types";
import type { IRNG } from "../rng";
import { appendRuntimeLog } from "../combat/narration";
import { calculateMaxHp, getCurrentHp } from "./hp";

/**
 * Processes regeneration trait for an actor at turn start/end
 * Returns updated save if regeneration occurred
 */
export function processRegeneration(
  save: GameSave,
  catalogs: CharacterCatalogs,
  storyPack: StoryPack,
  actorId: ActorId,
  rng: IRNG
): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;

  // Check if actor has regeneration trait
  const regenParams = actor.traits["trait:regeneration"];
  if (!regenParams || typeof regenParams !== "object" || typeof regenParams.x !== "number") {
    return save;
  }

  const regenAmount = regenParams.x;

  // Auto test Toughness (stat test)
  const toughnessCheck: SingleCheck = {
    id: `trait:regeneration:${actorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId },
    key: "TOU",
    difficulty: "Challenging",
  };

  const result = performCheck(toughnessCheck, storyPack, save, rng);
  if (!result || !result.success) {
    return save; // Regeneration failed
  }

  // Heal X HP by reducing wounds
  const maxHp = calculateMaxHp(save, actor, catalogs);
  const woundsBefore = actor.resources.wounds ?? 0;
  const currentHp = maxHp - woundsBefore;
  const woundsAfter = Math.max(0, woundsBefore - regenAmount);
  const newHp = maxHp - woundsAfter;

  if (woundsAfter === woundsBefore) {
    return save; // Already at max HP (no wounds)
  }

  const updatedActor = {
    ...actor,
    resources: {
      ...actor.resources,
      wounds: woundsAfter,
    },
  };

  let updatedSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };

  // Log system entry
  updatedSave = appendRuntimeLog(updatedSave, {
    kind: "system",
    message: `${actor.name} rigenera ${regenAmount} PF (da ${currentHp} a ${newHp}).`,
  });

  return updatedSave;
}
