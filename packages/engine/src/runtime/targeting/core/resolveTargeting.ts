import type { ActorId, GameSave } from "../../types";
import type { TargetResolution, TargetSelection, TargetSpec } from "./types";
import { computeTargetingPreview } from "./preview";
import { getActorsIntersectingCells } from "./geometry";

type ResolveOptions = {
  includeCaster?: boolean;
};

export function resolveTargeting(
  save: GameSave,
  casterId: ActorId,
  targetSpec: TargetSpec,
  selectionPartial?: Partial<TargetSelection>,
  options?: ResolveOptions,
): TargetResolution {
  const preview = computeTargetingPreview(save, casterId, targetSpec, selectionPartial);
  if (!preview.valid) {
    return { targetActorIds: [], targetPoints: [], invalidReason: preview.reason };
  }

  const allowSelfHit = targetSpec.shape.kind === "self" || targetSpec.shape.kind === "touch";
  const includeCaster = allowSelfHit || options?.includeCaster;

  const actorIds = getActorsIntersectingCells(save, preview.affectedCells);
  const targetActorIds = includeCaster ? actorIds : actorIds.filter((id) => id !== casterId);

  return {
    targetActorIds,
    targetPoints: preview.affectedCells,
  };
}
