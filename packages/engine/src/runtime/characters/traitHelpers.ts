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

export function addTraitsWithSource(
  actor: Actor,
  traitsToAdd: Record<string, any>,
  source: string
): Actor {
  const updatedTraits = { ...(actor.traits ?? {}) };

  for (const [traitId, params] of Object.entries(traitsToAdd)) {
    if (traitId === "trait:natural_ability") {
      const existing = updatedTraits[traitId];
      const existingProfiles: Array<Record<string, any>> = [];
      if (existing && typeof existing === "object") {
        if (Array.isArray(existing.profiles)) {
          existingProfiles.push(...existing.profiles);
        } else if (Array.isArray(existing.abilities)) {
          existingProfiles.push(...existing.abilities);
        } else if (existing.profile) {
          existingProfiles.push(existing.profile);
        }
      }
      const incomingProfiles = Array.isArray(params?.profiles)
        ? params.profiles
        : Array.isArray(params?.abilities)
          ? params.abilities
          : Array.isArray(params)
            ? params
            : [];
      const sourcedProfiles = incomingProfiles.map((profile) => ({ ...profile, _source: source }));
      updatedTraits[traitId] = {
        profiles: [...existingProfiles, ...sourcedProfiles],
      };
      continue;
    }

    if (updatedTraits[traitId] !== undefined && (updatedTraits[traitId] as any)?._source !== source) {
      continue;
    }
    if (params && typeof params === "object") {
      updatedTraits[traitId] = { ...params, _source: source };
    } else {
      updatedTraits[traitId] = { _source: source };
    }
  }

  return {
    ...actor,
    traits: updatedTraits,
  };
}

export function removeTraitsBySource(actor: Actor, source: string): Actor {
  const updatedTraits = { ...(actor.traits ?? {}) };
  let changed = false;

  for (const [traitId, params] of Object.entries(updatedTraits)) {
    if (traitId === "trait:natural_ability" && params && typeof params === "object") {
      const profiles = Array.isArray((params as any).profiles) ? (params as any).profiles : [];
      const remaining = profiles.filter((profile: any) => profile?._source !== source);
      if (remaining.length !== profiles.length) {
        changed = true;
        if (remaining.length > 0) {
          updatedTraits[traitId] = { profiles: remaining };
        } else {
          delete updatedTraits[traitId];
        }
      }
      continue;
    }

    if (params && typeof params === "object" && (params as any)._source === source) {
      delete updatedTraits[traitId];
      changed = true;
    }
  }

  if (!changed) return actor;
  return {
    ...actor,
    traits: updatedTraits,
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
