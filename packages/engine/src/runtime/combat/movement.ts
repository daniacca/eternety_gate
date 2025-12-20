import type { Grid, Position } from "../types";

/**
 * Distance helpers
 */
export function distanceChebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function clampToGrid(pos: Position, grid: Grid): Position {
  return {
    x: Math.max(0, Math.min(grid.width - 1, pos.x)),
    y: Math.max(0, Math.min(grid.height - 1, pos.y)),
  };
}

