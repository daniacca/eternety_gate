import type { Actor } from "../types";

/**
 * Checks if an actor is alive (not dead)
 * Actor is alive if they exist and isDead !== true
 */
export function isActorAlive(actor: Actor | undefined): boolean {
  return actor !== undefined && actor.resources.isDead !== true;
}

/**
 * Gets size-based movement modifier according to the size table:
 * Size 1: -3, Size 2: -2, Size 3: -1, Size 4: 0, Size 5: +1,
 * Size 6: +2, Size 7: +3, Size 8: +4, Size 9: +5, Size 10: +6
 * Defaults to size 4 (average human) if no size trait is present
 */
export function getSizeMovementModifier(actor: Actor): number {
  const sizeParams = actor.traits["trait:size"];
  const size =
    sizeParams && typeof sizeParams === "object" && typeof sizeParams.size === "number" ? sizeParams.size : 4; // Default to Average (size 4) if no size trait

  const sizeMovementTable: Record<number, number> = {
    1: -3,
    2: -2,
    3: -1,
    4: 0,
    5: 1,
    6: 2,
    7: 3,
    8: 4,
    9: 5,
    10: 6,
  };

  return sizeMovementTable[size] ?? 0; // Default to 0 if size is out of range
}
