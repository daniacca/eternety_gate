import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { getModifierTotal } from "./modifiers";
import { getStatTestTarget } from "../actors/bonuses";
import { performCheck } from "../checks";
import type { StoryPack, SingleCheck, StatKey } from "../types";
import type { IRNG } from "../rng";
import { appendRuntimeLog } from "../combat/narration";

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
    difficulty: "NORMAL",
  };

  const result = performCheck(toughnessCheck, storyPack, save, rng);
  if (!result || !result.success) {
    return save; // Regeneration failed
  }

  // Heal X HP
  const currentHp = actor.resources.hp;
  const maxHp = actor.derived?.hpMax ?? currentHp;
  const newHp = Math.min(maxHp, currentHp + regenAmount);

  if (newHp === currentHp) {
    return save; // Already at max HP
  }

  const updatedActor = {
    ...actor,
    resources: {
      ...actor.resources,
      hp: newHp,
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

