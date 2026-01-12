import type { Actor } from "../types";

/**
 * Adds characteristics to the trait:unnatural_characteristic trait
 * Characteristics are added as separate entries, allowing multiple sources to contribute
 * When processing modifiers, all entries for the same stat are summed together
 * @param actor The actor to modify
 * @param characteristics Array of { stat, bonusX } to add
 * @param source Source identifier (e.g., spell ID) to track where this came from
 * @returns Updated actor with modified trait
 */
export function addUnnaturalCharacteristics(
  actor: Actor,
  characteristics: Array<{ stat: string; bonusX: number }>,
  source: string
): Actor {
  const currentTrait = actor.traits["trait:unnatural_characteristic"];
  let currentCharacteristics: Array<{ stat: string; bonusX: number; _source?: string }> = [];

  // Get existing characteristics
  if (currentTrait && typeof currentTrait === "object" && Array.isArray(currentTrait.characteristics)) {
    currentCharacteristics = [...currentTrait.characteristics];
  }

  // Add new characteristics as separate entries (they'll be summed when processing modifiers)
  for (const newChar of characteristics) {
    currentCharacteristics.push({
      ...newChar,
      _source: source,
    });
  }

  return {
    ...actor,
    traits: {
      ...actor.traits,
      "trait:unnatural_characteristic": {
        characteristics: currentCharacteristics,
      },
    },
  };
}

/**
 * Removes characteristics from trait:unnatural_characteristic that match the given source
 * @param actor The actor to modify
 * @param source Source identifier (e.g., spell ID) to identify which characteristics to remove
 * @returns Updated actor with modified trait
 */
export function removeUnnaturalCharacteristicsBySource(
  actor: Actor,
  source: string
): Actor {
  const currentTrait = actor.traits["trait:unnatural_characteristic"];
  if (!currentTrait || typeof currentTrait !== "object" || !Array.isArray(currentTrait.characteristics)) {
    return actor; // No trait to modify
  }

  // Filter out characteristics that match the source
  const remainingCharacteristics = currentTrait.characteristics.filter(
    (char) => char._source !== source
  );

  // If no characteristics remain, remove the trait entirely
  if (remainingCharacteristics.length === 0) {
    const newTraits = { ...actor.traits };
    delete newTraits["trait:unnatural_characteristic"];
    return {
      ...actor,
      traits: newTraits,
    };
  }

  return {
    ...actor,
    traits: {
      ...actor.traits,
      "trait:unnatural_characteristic": {
        characteristics: remainingCharacteristics,
      },
    },
  };
}

/**
 * Gets the characteristics that should be added for steel_body condition
 * @param stacks Number of stacks (1 + overcast)
 * @returns Array of characteristics to add
 */
export function getSteelBodyCharacteristics(stacks: number): Array<{ stat: string; bonusX: number }> {
  return [
    { stat: "STR", bonusX: stacks },
    { stat: "TOU", bonusX: stacks },
  ];
}

/**
 * Gets the characteristics that should be added for warp_speed condition
 * @param stacks Number of stacks (1 + overcast)
 * @returns Array of characteristics to add
 */
export function getWarpSpeedCharacteristics(stacks: number): Array<{ stat: string; bonusX: number }> {
  return [
    { stat: "WS", bonusX: stacks },
    { stat: "BS", bonusX: stacks },
    { stat: "AGI", bonusX: stacks },
  ];
}
