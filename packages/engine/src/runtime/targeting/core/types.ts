import type { ActorId, Position } from "../../types";

export type Direction8 = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export type TargetShape =
  | { kind: "self" }
  | { kind: "touch" }
  | { kind: "single"; range: number }
  | { kind: "radius"; range: number; radius: number }
  | { kind: "line"; range: number }
  | { kind: "cone"; range: number; depth: 4 };

export type TargetSpec = {
  shape: TargetShape;
  requiresDirection?: boolean;
  requiresPoint?: boolean;
  requiresActor?: boolean;
};

export type TargetSelection =
  | { kind: "self" }
  | { kind: "touch"; direction: Direction8 }
  | { kind: "single"; targetPos: Position }
  | { kind: "radius"; centerPos: Position }
  | { kind: "line"; direction: Direction8; startPos?: Position }
  | { kind: "cone"; direction: Direction8 };

export type TargetPreview = {
  valid: boolean;
  reason?: string;
  selectableCells: Position[];
  affectedCells: Position[];
  affectedActorIds: ActorId[];
};

export type TargetResolution = {
  targetActorIds: ActorId[];
  targetPoints: Position[];
  invalidReason?: string;
};
