import type { TargetSpec, Direction9 } from "./types";
import type { ActorId } from "../types";

/**
 * Converts old targetSpec format to new TargetSpec format
 * For backward compatibility with existing code
 */
export function convertLegacyTargetSpec(oldSpec: {
  type: "self" | "actor" | "position";
  actorId?: string;
  position?: { x: number; y: number };
  direction?: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
}): TargetSpec {
  if (oldSpec.type === "self") {
    return { kind: "self" };
  }

  if (oldSpec.type === "actor" && oldSpec.actorId) {
    return { kind: "actor", actorId: oldSpec.actorId as ActorId };
  }

  if (oldSpec.type === "position" && oldSpec.position) {
    return { kind: "point", x: oldSpec.position.x, y: oldSpec.position.y };
  }

  if (oldSpec.direction) {
    const dirMap: Record<string, Direction9> = {
      N: 8,
      NE: 9,
      E: 6,
      SE: 3,
      S: 2,
      SW: 1,
      W: 4,
      NW: 7,
    };
    const dir = dirMap[oldSpec.direction];
    if (dir) {
      return { kind: "direction", dir };
    }
  }

  // Fallback to self
  return { kind: "self" };
}
