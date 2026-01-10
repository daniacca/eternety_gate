import type { ActorId } from "../types";

/**
 * Direction9: 8-directional movement (no center/5)
 * Values correspond to numpad directions:
 * 7 8 9
 * 4   6
 * 1 2 3
 */
export type Direction9 = 1 | 2 | 3 | 4 | 6 | 7 | 8 | 9;

/**
 * Point on the combat grid
 */
export type Point = { x: number; y: number };

/**
 * Target specification for spells and ranged attacks
 */
export type TargetSpec =
  | { kind: "self" }
  | { kind: "actor"; actorId: ActorId }
  | { kind: "point"; x: number; y: number }
  | { kind: "direction"; dir: Direction9 };

/**
 * Target shape for area effects
 */
export type TargetShape = "self" | "single" | "cone" | "line" | "radius";

/**
 * Targeting definition that describes how a spell/attack targets
 */
export type TargetingDefinition =
  | { shape: "self" }
  | { shape: "single"; rangeSquares: number }
  | { shape: "cone"; rangeSquares: number }
  | { shape: "line"; rangeSquares: number }
  | { shape: "radius"; rangeSquares: number; radiusSquares: number };

/**
 * Result of target resolution
 */
export type TargetResolution = {
  targetActorIds: ActorId[];
  targetPoints: Point[];
  invalidReason?: string;
};
