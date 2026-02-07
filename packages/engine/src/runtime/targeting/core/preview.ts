import type { ActorId, GameSave, Position } from "../../types";
import type { TargetPreview, TargetSelection, TargetSpec } from "./types";
import {
  clampCellsToGrid,
  cellsWithinRange,
  getActorAnchorPos,
  getActorsIntersectingCells,
  getCellsInConeSimple,
  getCellsInLine,
  getCellsInRadius,
  getCellsInTouch,
  isWithinRange,
} from "./geometry";
import type { Direction8 } from "./types";
import { getActorFootprint } from "../../combat/footprint";

export function computeTargetingPreview(
  save: GameSave,
  casterId: ActorId,
  targetSpec: TargetSpec,
  selectionPartial?: Partial<TargetSelection>,
): TargetPreview {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { valid: false, reason: "combat_not_active", selectableCells: [], affectedCells: [], affectedActorIds: [] };
  }

  const grid = combat.grid;
  const casterPos = getActorAnchorPos(save, casterId);
  if (!casterPos) {
    return {
      valid: false,
      reason: "caster_not_positioned",
      selectableCells: [],
      affectedCells: [],
      affectedActorIds: [],
    };
  }

  const selectableCells: Position[] = [];
  let affectedCells: Position[] = [];
  let valid = true;
  let reason: string | undefined;

  const shape = targetSpec.shape;
  const allowSelfHit = shape.kind === "self" || shape.kind === "touch";

  if (shape.kind === "self") {
    affectedCells = getActorFootprint(save, casterId);
    affectedCells = clampCellsToGrid(affectedCells, grid.width, grid.height);
  } else if (shape.kind === "touch") {
    const direction = selectionPartial && "direction" in selectionPartial ? selectionPartial.direction : undefined;
    if (!direction) {
      valid = false;
      reason = "direction_required";
    } else {
      affectedCells = getCellsInTouch(casterPos, direction as Direction8);
      affectedCells = clampCellsToGrid(affectedCells, grid.width, grid.height);
      if (affectedCells.length === 0) {
        valid = false;
        reason = "out_of_bounds";
      }
    }
  } else if (shape.kind === "single") {
    selectableCells.push(...clampCellsToGrid(cellsWithinRange(casterPos, shape.range), grid.width, grid.height));
    const targetPos = selectionPartial && "targetPos" in selectionPartial ? selectionPartial.targetPos : undefined;
    if (!targetPos) {
      valid = false;
      reason = "target_required";
    } else if (!isWithinRange(casterPos, targetPos, shape.range)) {
      valid = false;
      reason = "out_of_range";
    } else if (!isInBounds(targetPos, grid.width, grid.height)) {
      valid = false;
      reason = "out_of_bounds";
    } else {
      affectedCells = [targetPos];
    }
  } else if (shape.kind === "radius") {
    selectableCells.push(...clampCellsToGrid(cellsWithinRange(casterPos, shape.range), grid.width, grid.height));
    const centerPos = selectionPartial && "centerPos" in selectionPartial ? selectionPartial.centerPos : undefined;
    if (!centerPos) {
      valid = false;
      reason = "center_required";
    } else if (!isWithinRange(casterPos, centerPos, shape.range)) {
      valid = false;
      reason = "out_of_range";
    } else if (!isInBounds(centerPos, grid.width, grid.height)) {
      valid = false;
      reason = "out_of_bounds";
    } else {
      affectedCells = getCellsInRadius(centerPos, shape.radius);
      affectedCells = clampCellsToGrid(affectedCells, grid.width, grid.height);
    }
  } else if (shape.kind === "line") {
    const direction = selectionPartial && "direction" in selectionPartial ? selectionPartial.direction : undefined;
    const startPos =
      selectionPartial && "startPos" in selectionPartial && selectionPartial.startPos
        ? selectionPartial.startPos
        : casterPos;
    if (!direction) {
      valid = false;
      reason = "direction_required";
    } else if (!isInBounds(startPos, grid.width, grid.height)) {
      valid = false;
      reason = "start_out_of_bounds";
    } else {
      affectedCells = getCellsInLine(startPos, direction as Direction8, shape.range);
      affectedCells = clampCellsToGrid(affectedCells, grid.width, grid.height);
      if (affectedCells.length === 0) {
        valid = false;
        reason = "out_of_bounds";
      }
    }
  } else if (shape.kind === "cone") {
    const direction = selectionPartial && "direction" in selectionPartial ? selectionPartial.direction : undefined;
    if (!direction) {
      valid = false;
      reason = "direction_required";
    } else {
      affectedCells = getCellsInConeSimple(casterPos, direction as Direction8, shape.depth);
      affectedCells = clampCellsToGrid(affectedCells, grid.width, grid.height);
      if (affectedCells.length === 0) {
        valid = false;
        reason = "out_of_bounds";
      }
    }
  }

  const affectedActorIds = valid
    ? getActorsIntersectingCells(save, affectedCells).filter((id) => allowSelfHit || id !== casterId)
    : [];

  if (valid && targetSpec.requiresActor && affectedActorIds.length === 0) {
    valid = false;
    reason = "no_targets";
  }

  return {
    valid,
    reason,
    selectableCells,
    affectedCells,
    affectedActorIds,
  };
}

function isInBounds(pos: Position, width: number, height: number): boolean {
  return pos.x >= 0 && pos.x < width && pos.y >= 0 && pos.y < height;
}
