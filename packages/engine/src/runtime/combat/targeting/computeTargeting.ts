import type { ActorId, GameSave, Position } from "../../types";
import type { SpellDefinition, EffectDefinition } from "../../magic/types";
import { distanceChebyshev } from "../movement";
import { getActorFootprint, footprintIntersects } from "../footprint";
import { posKey } from "../../items/posKey";
import type { Direction8, TargetPreview, TargetSelection, TargetSpec, TargetShape } from "./types";

const dirToVector: Record<Direction8, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  NE: { dx: 1, dy: -1 },
  E: { dx: 1, dy: 0 },
  SE: { dx: 1, dy: 1 },
  S: { dx: 0, dy: 1 },
  SW: { dx: -1, dy: 1 },
  W: { dx: -1, dy: 0 },
  NW: { dx: -1, dy: -1 },
};

function rangeModeToMultiplier(rangeMode: SpellDefinition["rangeMode"]): number {
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
      return 2;
  }
}

function isInBounds(pos: Position, width: number, height: number): boolean {
  return pos.x >= 0 && pos.x < width && pos.y >= 0 && pos.y < height;
}

function clampCellsToGrid(cells: Position[], width: number, height: number): Position[] {
  return cells.filter((cell) => isInBounds(cell, width, height));
}

function cellsWithinRange(origin: Position, range: number): Position[] {
  const cells: Position[] = [];
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const candidate = { x: origin.x + dx, y: origin.y + dy };
      if (distanceChebyshev(origin, candidate) <= range) {
        cells.push(candidate);
      }
    }
  }
  return cells;
}

function getPerpendicularVector(dir: Direction8): { px: number; py: number } {
  const forward = dirToVector[dir];
  if (!forward) {
    return { px: 0, py: 0 };
  }
  // Cardinals: rotate 90 degrees (prefer right-hand for determinism)
  if (forward.dx === 0) {
    return { px: 1, py: 0 };
  }
  if (forward.dy === 0) {
    return { px: 0, py: 1 };
  }
  // Diagonals: keep expansion symmetric on grid
  return { px: forward.dx, py: -forward.dy };
}

export function getActorAnchorPos(save: GameSave, actorId: ActorId): Position | null {
  const combat = save.runtime.combat;
  if (!combat?.active) return null;
  return combat.positions[actorId] ?? null;
}

export function getActorsIntersectingCells(save: GameSave, cells: Position[]): ActorId[] {
  const combat = save.runtime.combat;
  if (!combat?.active) return [];

  const seen = new Set<ActorId>();
  const hits: ActorId[] = [];
  for (const actorId of combat.participants) {
    if (seen.has(actorId)) continue;
    const actor = save.actorsById[actorId];
    if (!actor || actor.resources.isDead) continue;
    const footprint = getActorFootprint(save, actorId);
    if (footprintIntersects(footprint, cells)) {
      seen.add(actorId);
      hits.push(actorId);
    }
  }

  return hits;
}

export function getCellsInRadius(centerPos: Position, radius: number): Position[] {
  const cells: Position[] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const candidate = { x: centerPos.x + dx, y: centerPos.y + dy };
      if (Math.max(Math.abs(dx), Math.abs(dy)) <= radius) {
        cells.push(candidate);
      }
    }
  }
  return cells;
}

export function getCellsInLine(startPos: Position, dir: Direction8, length: number): Position[] {
  const vector = dirToVector[dir];
  const cells: Position[] = [];
  for (let step = 1; step <= length; step++) {
    cells.push({
      x: startPos.x + vector.dx * step,
      y: startPos.y + vector.dy * step,
    });
  }
  return cells;
}

export function getCellsInTouch(casterPos: Position, dir: Direction8): Position[] {
  return getCellsInLine(casterPos, dir, 1);
}

export function getCellsInConeSimple(casterPos: Position, dir: Direction8, depth = 4): Position[] {
  const forward = dirToVector[dir];
  const perp = getPerpendicularVector(dir);
  const seen = new Set<string>();
  const cells: Position[] = [];

  const isDiagonal = Math.abs(forward.dx) === Math.abs(forward.dy);
  const coneLength = isDiagonal ? depth + 1 : depth;

  for (let s = 1; s <= coneLength; s++) {
    const rowCenter = { x: casterPos.x + forward.dx * s, y: casterPos.y + forward.dy * s };
    // Centered progression: 1,3,5,7,...
    const lateralCount = 2 * s - 1;
    const centerShift = Math.floor((lateralCount - 1) / 2);

    if (isDiagonal) {
      // For diagonals, fill a diamond (Manhattan radius) around rowCenter to avoid holes without over-growing the cone
      const radius = s - 1;
      const forwardLimit = depth + (s - 1) / 2; // allow slight lateral reach without overextending depth
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= radius) {
            const cell = { x: rowCenter.x + dx, y: rowCenter.y + dy };
            // Keep forward reach bounded to depth to avoid over-long diagonals
            const forwardDist = (cell.x - casterPos.x) * forward.dx + (cell.y - casterPos.y) * forward.dy;
            if (forwardDist < 1 || forwardDist > forwardLimit) {
              continue;
            }
            const key = posKey(cell);
            if (!seen.has(key)) {
              seen.add(key);
              cells.push(cell);
            }
          }
        }
      }
    } else {
      // Cardinals: use perpendicular offsets
      for (let i = 0; i < lateralCount; i++) {
        const offsetIndex = i - centerShift;
        const cell = {
          x: rowCenter.x + perp.px * offsetIndex,
          y: rowCenter.y + perp.py * offsetIndex,
        };
        const key = posKey(cell);
        if (!seen.has(key)) {
          seen.add(key);
          cells.push(cell);
        }
      }
    }
  }

  return cells;
}

export function isWithinRange(casterPos: Position, targetPos: Position, range: number): boolean {
  return distanceChebyshev(casterPos, targetPos) <= range;
}

function deriveRange(spell: SpellDefinition, effect: EffectDefinition, cnBase: number, overcast = 0): number {
  if (spell.rangeSquares !== undefined) {
    if (effect.specialOp === "combatDisarmAtRange") {
      return spell.rangeSquares + overcast;
    }
    return spell.rangeSquares;
  }
  if (spell.rangeMultiplier !== undefined) {
    return cnBase * spell.rangeMultiplier;
  }
  return cnBase * rangeModeToMultiplier(spell.rangeMode);
}

export function buildSpellTargetSpec(
  spell: SpellDefinition,
  effect: EffectDefinition,
  cnBase: number,
  overcast = 0
): TargetSpec {
  const range = deriveRange(spell, effect, cnBase, overcast);
  const isOffensive = effect.kind === "damage" || effect.kind === "malediction";

  let shape: TargetShape;
  let requiresDirection = false;
  let requiresPoint = false;

  switch (spell.targetShape) {
    case "self":
      shape = { kind: "self" };
      break;
    case "single":
      shape = { kind: "single", range };
      requiresPoint = true;
      break;
    case "radius":
      shape = { kind: "radius", range, radius: spell.radiusSquares ?? 2 };
      requiresPoint = true;
      break;
    case "line":
      shape = { kind: "line", range };
      requiresDirection = true;
      break;
    case "cone":
      shape = { kind: "cone", range, depth: 4 };
      requiresDirection = true;
      break;
    case "touch":
      shape = { kind: "touch" };
      requiresDirection = true;
      break;
    default:
      shape = { kind: "single", range };
      requiresPoint = true;
      break;
  }

  return {
    shape,
    requiresDirection,
    requiresPoint,
    requiresActor: isOffensive || spell.targetShape === "single",
  };
}

export function computeTargetPreview(
  save: GameSave,
  casterId: ActorId,
  targetSpec: TargetSpec,
  selectionPartial?: Partial<TargetSelection>,
  _contentPack?: unknown
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
