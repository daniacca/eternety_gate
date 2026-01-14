import type { SpellDefinition, EffectDefinition } from "../magic/types";
import type { TargetingDefinition } from "./types";

/**
 * Converts RangeMode to a range multiplier (for backward compatibility)
 */
function rangeModeToMultiplier(rangeMode: string): number {
  switch (rangeMode) {
    case "self":
      return 0;
    case "touch":
      return 1;
    case "short":
      return 2;
    case "medium":
      return 3;
    case "long":
      return 4;
    default:
      return 2; // Default to medium
  }
}

/**
 * Builds a TargetingDefinition from a spell definition and effect definition
 */
export function buildTargetingDefinition(
  spell: SpellDefinition,
  effect: EffectDefinition,
  cnBase: number,
  overcast?: number
): TargetingDefinition {
  const shape = spell.targetShape;

  if (shape === "self") {
    return { shape: "self" };
  }

  if (shape === "touch") {
    return { shape: "single", rangeSquares: 1 };
  }

  // Calculate rangeSquares
  let rangeSquares: number;
  if (spell.rangeSquares !== undefined) {
    // For spells with explicit rangeSquares, add overcast if effect has specialOp requiring it
    // (e.g., kinesis_disarm: rangeSquares = 4 + overcast)
    if (effect.specialOp === "combatDisarmAtRange" && overcast !== undefined) {
      rangeSquares = spell.rangeSquares + overcast;
    } else {
      rangeSquares = spell.rangeSquares;
    }
  } else if (spell.rangeMultiplier !== undefined) {
    rangeSquares = cnBase * spell.rangeMultiplier;
  } else {
    // Fallback: use rangeMode multiplier
    const multiplier = rangeModeToMultiplier(spell.rangeMode);
    rangeSquares = cnBase * multiplier;
  }

  if (shape === "single") {
    return { shape: "single", rangeSquares };
  }

  if (shape === "line") {
    return { shape: "line", rangeSquares };
  }

  if (shape === "cone") {
    return { shape: "cone", rangeSquares };
  }

  if (shape === "radius") {
    const radiusSquares = spell.radiusSquares ?? 2; // Default radius 2
    return { shape: "radius", rangeSquares, radiusSquares };
  }

  // Fallback to single target
  return { shape: "single", rangeSquares: rangeSquares || 1 };
}
