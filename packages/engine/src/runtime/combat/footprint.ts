import type { GameSave, ActorId, Position, Grid } from "../types";
import { posKey } from "../items/posKey";
import { getCellTerrain } from "./terrain";
import type { ContentPack } from "../../content/types";

/**
 * Gets the footprint radius for a given size
 * Size 1-5 => radius 0 (1x1)
 * Size 6-8 => radius 1 (3x3)
 * Size 9-10 => radius 2 (5x5)
 */
export function getFootprintRadius(size: number): 0 | 1 | 2 {
  if (size >= 1 && size <= 5) {
    return 0;
  } else if (size >= 6 && size <= 8) {
    return 1;
  } else if (size >= 9 && size <= 10) {
    return 2;
  }
  // Default to radius 0 for invalid sizes
  return 0;
}

/**
 * Gets all cells occupied by a footprint centered at the given position
 * Returns an array of positions
 */
export function getFootprintCells(center: Position, radius: 0 | 1 | 2): Position[] {
  const cells: Position[] = [];
  
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      cells.push({
        x: center.x + dx,
        y: center.y + dy,
      });
    }
  }
  
  return cells;
}

/**
 * Gets the size of an actor (defaults to 4 if no size trait)
 */
export function getActorSize(actor: { traits?: Record<string, any> } | undefined): number {
  if (!actor || !actor.traits) return 4;
  
  const sizeParams = actor.traits["trait:size"];
  if (sizeParams && typeof sizeParams === "object" && typeof sizeParams.size === "number") {
    return sizeParams.size;
  }
  
  return 4; // Default to average human size
}

/**
 * Gets the footprint cells for an actor based on their position and size
 */
export function getActorFootprint(save: GameSave, actorId: ActorId): Position[] {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return [];
  }
  
  const position = combat.positions[actorId];
  if (!position) {
    return [];
  }
  
  const actor = save.actorsById[actorId];
  const size = getActorSize(actor);
  const radius = getFootprintRadius(size);
  
  return getFootprintCells(position, radius);
}

/**
 * Gets the bounding box of a footprint
 * Returns {minX, maxX, minY, maxY}
 */
export function getFootprintBBox(center: Position, radius: 0 | 1 | 2): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  return {
    minX: center.x - radius,
    maxX: center.x + radius,
    minY: center.y - radius,
    maxY: center.y + radius,
  };
}

/**
 * Calculates Chebyshev distance between two bounding boxes
 * Returns the minimum distance between any two cells in the boxes
 */
export function chebyshevDistanceBetweenBBoxes(
  aBBox: { minX: number; maxX: number; minY: number; maxY: number },
  bBBox: { minX: number; maxX: number; minY: number; maxY: number }
): number {
  // Calculate distance between boxes
  // If boxes overlap, distance is 0
  // Otherwise, find the minimum Chebyshev distance between any two cells
  
  // Check if boxes overlap
  if (
    aBBox.maxX >= bBBox.minX &&
    aBBox.minX <= bBBox.maxX &&
    aBBox.maxY >= bBBox.minY &&
    aBBox.minY <= bBBox.maxY
  ) {
    return 0;
  }
  
  // Boxes don't overlap - find minimum distance
  let minDist = Infinity;
  
  // Check all corner-to-corner distances
  const cornersA = [
    { x: aBBox.minX, y: aBBox.minY },
    { x: aBBox.maxX, y: aBBox.minY },
    { x: aBBox.minX, y: aBBox.maxY },
    { x: aBBox.maxX, y: aBBox.maxY },
  ];
  
  const cornersB = [
    { x: bBBox.minX, y: bBBox.minY },
    { x: bBBox.maxX, y: bBBox.minY },
    { x: bBBox.minX, y: bBBox.maxY },
    { x: bBBox.maxX, y: bBBox.maxY },
  ];
  
  for (const cornerA of cornersA) {
    for (const cornerB of cornersB) {
      const dist = Math.max(
        Math.abs(cornerA.x - cornerB.x),
        Math.abs(cornerA.y - cornerB.y)
      );
      minDist = Math.min(minDist, dist);
    }
  }
  
  return minDist;
}

/**
 * Builds an occupancy map from all alive actors in combat
 * Returns a Map<posKey, actorId>
 */
export function buildOccupancyMap(save: GameSave): Map<string, ActorId> {
  const occupancyMap = new Map<string, ActorId>();
  const combat = save.runtime.combat;
  
  if (!combat?.active) {
    return occupancyMap;
  }
  
  for (const actorId of combat.participants) {
    const actor = save.actorsById[actorId];
    if (!actor || actor.resources.isDead === true) {
      continue; // Skip dead actors
    }
    
    const footprint = getActorFootprint(save, actorId);
    for (const cell of footprint) {
      const key = posKey(cell);
      // If multiple actors overlap (shouldn't happen, but handle gracefully)
      // Keep the first one found
      if (!occupancyMap.has(key)) {
        occupancyMap.set(key, actorId);
      }
    }
  }
  
  return occupancyMap;
}

/**
 * Checks if a position is within grid bounds
 */
function isPositionInBounds(pos: Position, grid: Grid): boolean {
  return pos.x >= 0 && pos.x < grid.width && pos.y >= 0 && pos.y < grid.height;
}

/**
 * Checks if an actor's footprint can be placed at the given center position
 * Returns false if ANY footprint cell is not walkable
 *
 * NOTE: This lives in `footprint.ts` (not `terrain.ts`) to avoid a require-cycle:
 * terrain -> footprint and footprint -> terrain.
 */
export function isFootprintWalkable(
  save: GameSave,
  actorId: ActorId,
  centerPos: Position,
  contentPack?: ContentPack,
  ignoreWalkable: boolean = false
): boolean {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return false;
  }

  const size = getActorSize(actor);
  const radius = getFootprintRadius(size);
  const footprint = getFootprintCells(centerPos, radius);

  // Check all cells in footprint are walkable
  for (const cell of footprint) {
    const terrain = getCellTerrain(save, cell, contentPack);
    if (!ignoreWalkable && !terrain.walkable) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if an actor can be placed at the given center position
 * Returns true if:
 * - All footprint cells are within grid bounds
 * - All footprint cells are walkable
 * - No overlap with other actors' footprints (excluding the actor itself)
 */
export function canPlaceActorAt(
  save: GameSave,
  actorId: ActorId,
  newCenterPos: Position,
  contentPack?: ContentPack,
  ignoreWalkable: boolean = false
): boolean {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return false;
  }
  
  const actor = save.actorsById[actorId];
  const size = getActorSize(actor);
  const radius = getFootprintRadius(size);
  const footprint = getFootprintCells(newCenterPos, radius);
  
  // Check all cells are within bounds
  for (const cell of footprint) {
    if (!isPositionInBounds(cell, combat.grid)) {
      return false;
    }
  }
  
  // Check all cells are walkable
  if (!isFootprintWalkable(save, actorId, newCenterPos, contentPack, ignoreWalkable)) {
    return false;
  }
  
  // Build occupancy map excluding this actor
  const occupancyMap = buildOccupancyMap(save);
  
  // Remove this actor's current footprint from the map
  const currentFootprint = getActorFootprint(save, actorId);
  for (const cell of currentFootprint) {
    const key = posKey(cell);
    if (occupancyMap.get(key) === actorId) {
      occupancyMap.delete(key);
    }
  }
  
  // Check for overlaps with new footprint
  for (const cell of footprint) {
    const key = posKey(cell);
    if (occupancyMap.has(key)) {
      return false; // Overlap detected
    }
  }
  
  return true;
}

/**
 * Calculates Chebyshev distance between two actors using their footprints
 * Returns the minimum distance between any two cells in their footprints
 */
export function footprintDistanceBetweenActors(
  save: GameSave,
  actorIdA: ActorId,
  actorIdB: ActorId
): number {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return Infinity;
  }
  
  const posA = combat.positions[actorIdA];
  const posB = combat.positions[actorIdB];
  
  if (!posA || !posB) {
    return Infinity;
  }
  
  const actorA = save.actorsById[actorIdA];
  const actorB = save.actorsById[actorIdB];
  
  const sizeA = getActorSize(actorA);
  const sizeB = getActorSize(actorB);
  
  const radiusA = getFootprintRadius(sizeA);
  const radiusB = getFootprintRadius(sizeB);
  
  const bboxA = getFootprintBBox(posA, radiusA);
  const bboxB = getFootprintBBox(posB, radiusB);
  
  return chebyshevDistanceBetweenBBoxes(bboxA, bboxB);
}

/**
 * Checks if two sets of positions intersect
 */
export function footprintIntersects(footprintCells: Position[], affectedCells: Position[]): boolean {
  const footprintSet = new Set<string>();
  for (const cell of footprintCells) {
    footprintSet.add(posKey(cell));
  }
  
  for (const cell of affectedCells) {
    if (footprintSet.has(posKey(cell))) {
      return true;
    }
  }
  
  return false;
}
