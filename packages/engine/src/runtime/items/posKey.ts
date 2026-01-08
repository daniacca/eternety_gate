import type { Position } from "../types";

/**
 * Helper to convert position to key string for groundItemsByPos
 */
export function posKey(pos: Position): string {
  return `${pos.x},${pos.y}`;
}

