import type { ActorId, GameSave, Position } from "../types";
import type { Direction8, TargetSelection, TargetSpec as CoreTargetSpec } from "./core/types";
import type { TargetSpec, TargetingDefinition, TargetResolution } from "./types";
import { resolveTargeting } from "./core/resolveTargeting";

type ResolveOptions = { allowFriendlyFire?: boolean; includeCaster?: boolean };

const direction9To8: Record<number, Direction8> = {
  8: "N",
  9: "NE",
  6: "E",
  3: "SE",
  2: "S",
  1: "SW",
  4: "W",
  7: "NW",
};

function normalizeDeltaToDirection8(dx: number, dy: number): Direction8 | null {
  const stepX = Math.sign(dx);
  const stepY = Math.sign(dy);
  if (stepX === 0 && stepY === 0) return null;
  const key = `${stepX},${stepY}`;
  switch (key) {
    case "0,-1":
      return "N";
    case "1,-1":
      return "NE";
    case "1,0":
      return "E";
    case "1,1":
      return "SE";
    case "0,1":
      return "S";
    case "-1,1":
      return "SW";
    case "-1,0":
      return "W";
    case "-1,-1":
      return "NW";
    default:
      return null;
  }
}

function buildCoreTargetSpec(targeting: TargetingDefinition): CoreTargetSpec {
  switch (targeting.shape) {
    case "self":
      return { shape: { kind: "self" } };
    case "single":
      return { shape: { kind: "single", range: targeting.rangeSquares }, requiresPoint: true };
    case "line":
      return { shape: { kind: "line", range: targeting.rangeSquares }, requiresDirection: true };
    case "cone":
      return { shape: { kind: "cone", range: targeting.rangeSquares, depth: targeting.rangeSquares }, requiresDirection: true };
    case "radius":
      return {
        shape: { kind: "radius", range: targeting.rangeSquares, radius: targeting.radiusSquares },
        requiresPoint: true,
      };
    default:
      return { shape: { kind: "single", range: 1 }, requiresPoint: true };
  }
}

function getActorPosition(save: GameSave, actorId: ActorId): Position | null {
  const combat = save.runtime.combat;
  if (!combat?.active) return null;
  return combat.positions[actorId] ?? null;
}

function buildSelection(
  save: GameSave,
  casterPos: Position,
  targetSpec: TargetSpec,
  targeting: TargetingDefinition,
): { selection?: Partial<TargetSelection>; invalidReason?: string; targetActorId?: ActorId | null } {
  if (targeting.shape === "self") {
    if (targetSpec.kind !== "self") {
      return { invalidReason: "target_spec_mismatch" };
    }
    return { selection: { kind: "self" } };
  }

  if (targeting.shape === "single") {
    if (targetSpec.kind === "actor") {
      const pos = getActorPosition(save, targetSpec.actorId);
      if (!pos) {
        return { invalidReason: "target_actor_not_positioned" };
      }
      return { selection: { kind: "single", targetPos: pos }, targetActorId: targetSpec.actorId };
    }
    if (targetSpec.kind === "point") {
      return { selection: { kind: "single", targetPos: { x: targetSpec.x, y: targetSpec.y } } };
    }
    return { invalidReason: "target_spec_invalid_for_single" };
  }

  if (targeting.shape === "line") {
    if (targetSpec.kind === "direction") {
      const dir = direction9To8[targetSpec.dir];
      if (!dir) {
        return { invalidReason: "direction_invalid" };
      }
      return { selection: { kind: "line", direction: dir } };
    }
    if (targetSpec.kind === "point") {
      const dir = normalizeDeltaToDirection8(targetSpec.x - casterPos.x, targetSpec.y - casterPos.y);
      if (!dir) {
        return { invalidReason: "target_spec_invalid_for_line" };
      }
      return { selection: { kind: "line", direction: dir } };
    }
    return { invalidReason: "target_spec_invalid_for_line" };
  }

  if (targeting.shape === "cone") {
    if (targetSpec.kind !== "direction") {
      return { invalidReason: "target_spec_invalid_for_cone" };
    }
    const dir = direction9To8[targetSpec.dir];
    if (!dir) {
      return { invalidReason: "direction_invalid" };
    }
    return { selection: { kind: "cone", direction: dir } };
  }

  if (targeting.shape === "radius") {
    if (targetSpec.kind === "actor") {
      const pos = getActorPosition(save, targetSpec.actorId);
      if (!pos) {
        return { invalidReason: "target_actor_not_positioned" };
      }
      return { selection: { kind: "radius", centerPos: pos }, targetActorId: targetSpec.actorId };
    }
    if (targetSpec.kind === "point") {
      return { selection: { kind: "radius", centerPos: { x: targetSpec.x, y: targetSpec.y } } };
    }
    return { invalidReason: "target_spec_invalid_for_radius" };
  }

  return { invalidReason: "unknown_targeting_shape" };
}

function isFriendlyFireDisallowed(
  save: GameSave,
  casterId: ActorId,
  targetActorId: ActorId | null | undefined,
  allowFriendlyFire: boolean,
): boolean {
  if (allowFriendlyFire || !targetActorId) return false;
  const partyIds = new Set(save.party?.actors ?? []);
  const casterIsParty = partyIds.has(casterId);
  const targetIsParty = partyIds.has(targetActorId);
  return casterIsParty === targetIsParty && casterId !== targetActorId;
}

/**
 * Resolves targets based on TargetSpec and TargetingDefinition
 */
export function resolveTargets(
  save: GameSave,
  casterId: ActorId,
  targetSpec: TargetSpec,
  targeting: TargetingDefinition,
  options?: ResolveOptions,
): TargetResolution {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { targetActorIds: [], targetPoints: [], invalidReason: "combat_not_active" };
  }

  const casterPos = combat.positions[casterId];
  if (!casterPos) {
    return { targetActorIds: [], targetPoints: [], invalidReason: "caster_not_positioned" };
  }

  const allowFriendlyFire = options?.allowFriendlyFire ?? true;
  const includeCaster = options?.includeCaster ?? false;
  const selectionResult = buildSelection(save, casterPos, targetSpec, targeting);
  if (selectionResult.invalidReason) {
    return { targetActorIds: [], targetPoints: [], invalidReason: selectionResult.invalidReason };
  }

  if (isFriendlyFireDisallowed(save, casterId, selectionResult.targetActorId, allowFriendlyFire)) {
    return { targetActorIds: [], targetPoints: [], invalidReason: "friendly_fire_disallowed" };
  }

  const coreTargetSpec = buildCoreTargetSpec(targeting);
  const resolved = resolveTargeting(save, casterId, coreTargetSpec, selectionResult.selection, { includeCaster });

  if (targeting.shape === "single" && resolved.targetActorIds.length > 1) {
    return {
      targetActorIds: [resolved.targetActorIds[0]],
      targetPoints: resolved.targetPoints,
      invalidReason: resolved.invalidReason,
    };
  }

  return resolved;
}
