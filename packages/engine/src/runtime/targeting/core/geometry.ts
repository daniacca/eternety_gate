import type { ActorId, GameSave, Position } from "../../types";
import { distanceChebyshev } from "../../combat/movement";
import { getActorFootprint, footprintIntersects } from "../../combat/footprint";
import { posKey } from "../../items/posKey";
import type { Direction8 } from "./types";

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

function isInBounds(pos: Position, width: number, height: number): boolean {
  return pos.x >= 0 && pos.x < width && pos.y >= 0 && pos.y < height;
}

export function clampCellsToGrid(cells: Position[], width: number, height: number): Position[] {
  return cells.filter((cell) => isInBounds(cell, width, height));
}

export function cellsWithinRange(origin: Position, range: number): Position[] {
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
  if (forward.dx === 0) {
    return { px: 1, py: 0 };
  }
  if (forward.dy === 0) {
    return { px: 0, py: 1 };
  }
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
    const lateralCount = 2 * s - 1;
    const centerShift = Math.floor((lateralCount - 1) / 2);

    if (isDiagonal) {
      const radius = s - 1;
      const forwardLimit = depth + (s - 1) / 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.abs(dx) + Math.abs(dy) <= radius) {
            const cell = { x: rowCenter.x + dx, y: rowCenter.y + dy };
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
