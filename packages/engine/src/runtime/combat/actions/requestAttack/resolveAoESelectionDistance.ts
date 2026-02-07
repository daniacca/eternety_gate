import type { TargetSelection } from "../../targeting/types";
import { distanceChebyshev } from "../../movement";

export function resolveAoESelectionDistance(
  attackerPos: { x: number; y: number },
  selection?: TargetSelection,
): number | null {
  if (!selection) return null;
  if (selection.kind === "single") {
    return distanceChebyshev(attackerPos, selection.targetPos);
  }
  if (selection.kind === "radius") {
    return distanceChebyshev(attackerPos, selection.centerPos);
  }
  if (selection.kind === "line" && selection.startPos) {
    return distanceChebyshev(attackerPos, selection.startPos);
  }
  return null;
}
