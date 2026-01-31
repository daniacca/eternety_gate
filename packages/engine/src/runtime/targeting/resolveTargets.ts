import type { GameSave, ActorId } from "../types";
import type { TargetSpec, TargetingDefinition, TargetResolution, Point, Direction9 } from "./types";
import { distanceChebyshev } from "../combat/movement";
import { getActorFootprint, footprintIntersects } from "../combat/footprint";

/**
 * Converts Direction9 to a normalized direction vector (dx, dy)
 * Direction9 uses numpad layout:
 * 7 8 9
 * 4   6
 * 1 2 3
 */
function direction9ToVector(dir: Direction9): { dx: number; dy: number } {
  const map: Record<Direction9, { dx: number; dy: number }> = {
    7: { dx: -1, dy: -1 }, // NW
    8: { dx: 0, dy: -1 },  // N
    9: { dx: 1, dy: -1 },  // NE
    4: { dx: -1, dy: 0 },  // W
    6: { dx: 1, dy: 0 },   // E
    1: { dx: -1, dy: 1 },  // SW
    2: { dx: 0, dy: 1 },   // S
    3: { dx: 1, dy: 1 },   // SE
  };
  return map[dir];
}

/**
 * Gets perpendicular vectors for a direction (for cone width calculation)
 * Returns both left and right perpendicular vectors
 */
function getPerpendicularVectors(dx: number, dy: number): Array<{ px: number; py: number }> {
  // For axis-aligned directions (N/S/E/W), perpendiculars are straightforward
  if (dx === 0) {
    // North/South: perpendiculars are East/West
    return [{ px: 1, py: 0 }, { px: -1, py: 0 }];
  }
  if (dy === 0) {
    // East/West: perpendiculars are North/South
    return [{ px: 0, py: 1 }, { px: 0, py: -1 }];
  }
  // For diagonal directions, we need to rotate 90 degrees
  // Rotate (dx, dy) by 90 degrees: (-dy, dx) and (dy, -dx)
  return [{ px: -dy, py: dx }, { px: dy, py: -dx }];
}

/**
 * Normalizes a direction vector to step size (-1, 0, or 1)
 */
function normalizeDirection(dx: number, dy: number): { dx: number; dy: number } {
  return {
    dx: dx === 0 ? 0 : dx > 0 ? 1 : -1,
    dy: dy === 0 ? 0 : dy > 0 ? 1 : -1,
  };
}

/**
 * Gets all actors at a specific position (checks anchor position for backward compatibility)
 */
function getActorsAtPosition(save: GameSave, pos: Point, combat: NonNullable<GameSave["runtime"]["combat"]>): ActorId[] {
  const actors: ActorId[] = [];
  for (const actorId of combat.participants) {
    const actorPos = combat.positions[actorId];
    if (actorPos && actorPos.x === pos.x && actorPos.y === pos.y) {
      actors.push(actorId);
    }
  }
  return actors;
}

/**
 * Gets all actors whose footprint intersects with any of the given positions
 */
function getActorsIntersectingPositions(save: GameSave, positions: Point[], combat: NonNullable<GameSave["runtime"]["combat"]>): ActorId[] {
  const actors: ActorId[] = [];
  const seenActors = new Set<ActorId>();
  
  for (const actorId of combat.participants) {
    if (seenActors.has(actorId)) continue;
    
    const footprint = getActorFootprint(save, actorId);
    if (footprintIntersects(footprint, positions)) {
      actors.push(actorId);
      seenActors.add(actorId);
    }
  }
  
  return actors;
}

/**
 * Resolves targets based on TargetSpec and TargetingDefinition
 */
export function resolveTargets(
  save: GameSave,
  casterId: ActorId,
  targetSpec: TargetSpec,
  targeting: TargetingDefinition,
  options?: { allowFriendlyFire?: boolean; includeCaster?: boolean }
): TargetResolution {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { targetActorIds: [], targetPoints: [], invalidReason: "combat_not_active" };
  }

  // Get caster position
  const casterPos = combat.positions[casterId];
  if (!casterPos) {
    return { targetActorIds: [], targetPoints: [], invalidReason: "caster_not_positioned" };
  }

  const allowFriendlyFire = options?.allowFriendlyFire ?? true;
  const includeCaster = options?.includeCaster ?? false;

  // Handle self targeting
  if (targeting.shape === "self") {
    if (targetSpec.kind !== "self") {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_spec_mismatch" };
    }
    return { targetActorIds: [casterId], targetPoints: [casterPos] };
  }

  // Handle single target
  if (targeting.shape === "single") {
    let targetPos: Point | null = null;
    let targetActorId: ActorId | null = null;

    if (targetSpec.kind === "actor" && targetSpec.actorId) {
      targetActorId = targetSpec.actorId;
      const pos = combat.positions[targetSpec.actorId];
      if (!pos) {
        return { targetActorIds: [], targetPoints: [], invalidReason: "target_actor_not_positioned" };
      }
      targetPos = pos;
    } else if (targetSpec.kind === "point") {
      targetPos = { x: targetSpec.x, y: targetSpec.y };
      // Find actor at this position
      const actorsAtPos = getActorsAtPosition(save, targetPos, combat);
      if (actorsAtPos.length > 0) {
        targetActorId = actorsAtPos[0]; // Take first actor found
      }
    } else {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_spec_invalid_for_single" };
    }

    if (!targetPos) {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_position_invalid" };
    }

    // Check range
    const distance = distanceChebyshev(casterPos, targetPos);
    if (distance > targeting.rangeSquares) {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_out_of_range" };
    }

    // Check friendly fire
    if (!allowFriendlyFire && targetActorId) {
      const partyIds = new Set(save.party?.actors ?? []);
      const casterIsParty = partyIds.has(casterId);
      const targetIsParty = partyIds.has(targetActorId);
      if (casterIsParty === targetIsParty && casterId !== targetActorId) {
        return { targetActorIds: [], targetPoints: [], invalidReason: "friendly_fire_disallowed" };
      }
    }

    if (targetActorId) {
      return { targetActorIds: [targetActorId], targetPoints: [targetPos] };
    } else {
      return { targetActorIds: [], targetPoints: [targetPos] };
    }
  }

  // Handle line targeting
  if (targeting.shape === "line") {
    let dx: number, dy: number;

    if (targetSpec.kind === "direction") {
      const vec = direction9ToVector(targetSpec.dir);
      dx = vec.dx;
      dy = vec.dy;
    } else if (targetSpec.kind === "point") {
      const vec = normalizeDirection(targetSpec.x - casterPos.x, targetSpec.y - casterPos.y);
      dx = vec.dx;
      dy = vec.dy;
    } else {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_spec_invalid_for_line" };
    }

    const targetPoints: Point[] = [];
    const targetActorIds: ActorId[] = [];
    const seenActors = new Set<ActorId>();

    // Walk along the line
    for (let step = 1; step <= targeting.rangeSquares; step++) {
      const point: Point = {
        x: casterPos.x + step * dx,
        y: casterPos.y + step * dy,
      };
      targetPoints.push(point);
    }

    // Dev assertion: ensure targetPoints has correct count (exactly rangeSquares, or <= rangeSquares if out of bounds)
    if (process.env.NODE_ENV !== "production") {
      const expectedMax = targeting.rangeSquares;
      if (targetPoints.length > expectedMax) {
        console.warn(
          `[resolveTargets LINE] Expected at most ${expectedMax} points, got ${targetPoints.length}. This may indicate a bug.`
        );
      }
      // Note: We allow <= expectedMax because points may be filtered out if out of bounds
      // But we should have exactly expectedMax if all points are in bounds
    }

    // Find actors whose footprints intersect with any affected point
    const intersectingActors = getActorsIntersectingPositions(save, targetPoints, combat);
    for (const actorId of intersectingActors) {
      if (!seenActors.has(actorId)) {
        seenActors.add(actorId);
        if (includeCaster || actorId !== casterId) {
          targetActorIds.push(actorId);
        }
      }
    }

    // Sort by distance from caster, then by actorId
    targetActorIds.sort((a, b) => {
      const posA = combat.positions[a];
      const posB = combat.positions[b];
      if (!posA || !posB) return 0;
      const distA = distanceChebyshev(casterPos, posA);
      const distB = distanceChebyshev(casterPos, posB);
      if (distA !== distB) return distA - distB;
      return a.localeCompare(b);
    });

    return { targetActorIds, targetPoints };
  }

  // Handle cone targeting
  if (targeting.shape === "cone") {
    if (targetSpec.kind !== "direction") {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_spec_invalid_for_cone" };
    }

    const forward = direction9ToVector(targetSpec.dir);
    const perps = getPerpendicularVectors(forward.dx, forward.dy);
    const targetPoints: Point[] = [];
    const targetActorIds: ActorId[] = [];
    const seenActors = new Set<ActorId>();

    // For each distance step
    for (let d = 1; d <= targeting.rangeSquares; d++) {
      const center: Point = {
        x: casterPos.x + d * forward.dx,
        y: casterPos.y + d * forward.dy,
      };

      // Width grows: step 1 = 1 tile, step 2 = 2 tiles, etc.
      const width = d - 1;

      // Collect points at this distance
      const pointsAtDistance: Point[] = [center];

      if (width > 0) {
        // Add perpendicular offsets
        for (const perp of perps) {
          for (let o = 1; o <= width; o++) {
            const offset: Point = {
              x: center.x + o * perp.px,
              y: center.y + o * perp.py,
            };
            pointsAtDistance.push(offset);
          }
        }
      }

      // Add unique points
      for (const point of pointsAtDistance) {
        // Check if point already added (avoid duplicates)
        const alreadyAdded = targetPoints.some((p) => p.x === point.x && p.y === point.y);
        if (!alreadyAdded) {
          targetPoints.push(point);
        }
      }
    }

    // Find actors whose footprints intersect with any affected point
    const intersectingActors = getActorsIntersectingPositions(save, targetPoints, combat);
    for (const actorId of intersectingActors) {
      if (!seenActors.has(actorId)) {
        seenActors.add(actorId);
        if (includeCaster || actorId !== casterId) {
          targetActorIds.push(actorId);
        }
      }
    }

    // Sort by distance from caster, then by actorId
    targetActorIds.sort((a, b) => {
      const posA = combat.positions[a];
      const posB = combat.positions[b];
      if (!posA || !posB) return 0;
      const distA = distanceChebyshev(casterPos, posA);
      const distB = distanceChebyshev(casterPos, posB);
      if (distA !== distB) return distA - distB;
      return a.localeCompare(b);
    });

    return { targetActorIds, targetPoints };
  }

  // Handle radius targeting
  if (targeting.shape === "radius") {
    let centerPos: Point | null = null;

    if (targetSpec.kind === "point") {
      centerPos = { x: targetSpec.x, y: targetSpec.y };
    } else if (targetSpec.kind === "actor" && targetSpec.actorId) {
      const pos = combat.positions[targetSpec.actorId];
      if (!pos) {
        return { targetActorIds: [], targetPoints: [], invalidReason: "target_actor_not_positioned" };
      }
      centerPos = pos;
    } else {
      return { targetActorIds: [], targetPoints: [], invalidReason: "target_spec_invalid_for_radius" };
    }

    if (!centerPos) {
      return { targetActorIds: [], targetPoints: [], invalidReason: "center_position_invalid" };
    }

    // Check center is within range
    const centerDistance = distanceChebyshev(casterPos, centerPos);
    if (centerDistance > targeting.rangeSquares) {
      return { targetActorIds: [], targetPoints: [], invalidReason: "center_out_of_range" };
    }

    // Generate all points within radius
    const targetPoints: Point[] = [centerPos];
    for (let dx = -targeting.radiusSquares; dx <= targeting.radiusSquares; dx++) {
      for (let dy = -targeting.radiusSquares; dy <= targeting.radiusSquares; dy++) {
        if (dx === 0 && dy === 0) continue; // Already added centerPos
        const distance = Math.max(Math.abs(dx), Math.abs(dy)); // Chebyshev distance
        if (distance <= targeting.radiusSquares) {
          const point: Point = {
            x: centerPos.x + dx,
            y: centerPos.y + dy,
          };
          // Only add if within grid bounds (optional, but safer)
          if (point.x >= 0 && point.x < combat.grid.width && point.y >= 0 && point.y < combat.grid.height) {
            if (!targetPoints.some((p) => p.x === point.x && p.y === point.y)) {
              targetPoints.push(point);
            }
          }
        }
      }
    }

    // Find actors whose footprints intersect with any affected point
    const targetActorIds: ActorId[] = [];
    const intersectingActors = getActorsIntersectingPositions(save, targetPoints, combat);
    for (const actorId of intersectingActors) {
      if (includeCaster || actorId !== casterId) {
        targetActorIds.push(actorId);
      }
    }

    // Sort by distance from caster, then by actorId
    targetActorIds.sort((a, b) => {
      const posA = combat.positions[a];
      const posB = combat.positions[b];
      if (!posA || !posB) return 0;
      const distA = distanceChebyshev(casterPos, posA);
      const distB = distanceChebyshev(casterPos, posB);
      if (distA !== distB) return distA - distB;
      return a.localeCompare(b);
    });

    return { targetActorIds, targetPoints };
  }

  return { targetActorIds: [], targetPoints: [], invalidReason: "unknown_targeting_shape" };
}
