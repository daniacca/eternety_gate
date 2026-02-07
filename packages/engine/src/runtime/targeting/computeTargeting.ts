import type { ActorId, GameSave } from "../types";
import type { SpellDefinition, EffectDefinition } from "../magic/types";
import type { TargetPreview, TargetSelection, TargetSpec, TargetShape } from "./core/types";
import { computeTargetingPreview } from "./core/preview";
export {
  getActorAnchorPos,
  getActorsIntersectingCells,
  getCellsInRadius,
  getCellsInLine,
  getCellsInTouch,
  getCellsInConeSimple,
  isWithinRange,
} from "./core/geometry";

function rangeModeToMultiplier(rangeMode: SpellDefinition["rangeMode"]): number {
  switch (rangeMode) {
    case "self":
      return 0;
    case "touch":
      return 1;
    case "short":
      return 3;
    case "medium":
      return 5;
    case "long":
      return 8;
    default:
      return 3;
  }
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
  overcast = 0,
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
  _contentPack?: unknown,
): TargetPreview {
  return computeTargetingPreview(save, casterId, targetSpec, selectionPartial);
}
