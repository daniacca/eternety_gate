import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs, Grant } from "../../content/catalogs";
import { getTraitById } from "../../content/loadCatalogs";

/**
 * Applies grants to an actor
 */
export function applyGrants(
  save: GameSave,
  _catalogs: CharacterCatalogs,
  _actorId: ActorId,
  _grants: Grant[]
): GameSave {
  // Grants are applied via modifiers system, not directly modifying actor
  // The modifier resolver will read from actor.talents and actor.traits
  // For now, this is a placeholder that returns save unchanged
  // Actual grant effects are resolved via getModifierTotal
  return save;
}

/**
 * Resolves a grant value reference (e.g., "armor", "bonusX", "size.toHitMod")
 */
export function resolveGrantValueRef(
  catalogs: CharacterCatalogs,
  actorId: ActorId,
  save: GameSave,
  traitId: string,
  valueRef: string
): number {
  const actor = save.actorsById[actorId];
  if (!actor) return 0;

  const trait = getTraitById(catalogs, traitId);
  if (!trait) return 0;

  const traitParams = actor.traits[traitId];
  if (!traitParams || typeof traitParams !== "object") return 0;

  // Handle nested references like "size.toHitMod"
  const parts = valueRef.split(".");
  let value: any = traitParams;
  for (const part of parts) {
    if (value && typeof value === "object" && part in value) {
      value = value[part];
    } else {
      return 0;
    }
  }

  if (typeof value === "number") {
    return value;
  }

  return 0;
}

