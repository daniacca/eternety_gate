import type { CombatAttackCheck, Effect, GameSave } from "../../../types";
import type { TargetPreview, TargetSpec } from "../../targeting/types";
import { computeTargetPreview } from "../../targeting/computeTargeting";
import { distanceChebyshev } from "../../movement";
import { footprintDistanceBetweenActors } from "../../footprint";
import { validateAndApplyRangedModifiers } from "../../validation";
import { isActorAlive } from "../../../characters/actors";
import { applyBlockedCheck } from "./applyBlockedCheck";
import { resolveAoERangeSquares } from "./resolveAoERangeSquares";
import { resolveAoESelectionDistance } from "./resolveAoESelectionDistance";

export function resolveAoETargeting(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  currentSave: GameSave,
  combat: NonNullable<GameSave["runtime"]["combat"]>,
  attackCheck: CombatAttackCheck,
  weaponDef: GameSave["weaponsById"][string] | null,
  hasBlast: boolean,
  blastRank: number | null,
  attacker: GameSave["actorsById"][string],
  index: number,
): {
  targetPreview: TargetPreview | null;
  aoeTargets: string[];
  blocked?: GameSave;
  shouldSkip?: boolean;
} {
  let targetPreview: TargetPreview | null = null;
  let aoeTargets: string[] = [];
  let aoeAttackDist = footprintDistanceBetweenActors(currentSave, effect.attackerId, effect.defenderId);
  const aoeTargetSelection = effect.targetSelection;
  if (!aoeTargetSelection) {
    return {
      targetPreview,
      aoeTargets,
      blocked: applyBlockedCheck(currentSave, effect.attackerId, ["combat:blocked=missingTargetSelection"]),
    };
  }

  const rangeSquares = resolveAoERangeSquares(currentSave, weaponDef?.range);
  const aoeTargetSpec: TargetSpec = hasBlast
    ? { shape: { kind: "radius", range: rangeSquares, radius: blastRank as number }, requiresPoint: true }
    : { shape: { kind: "cone", range: rangeSquares, depth: 4 }, requiresDirection: true };

  targetPreview = computeTargetPreview(currentSave, effect.attackerId, aoeTargetSpec, aoeTargetSelection);
  if (!targetPreview.valid) {
    return {
      targetPreview,
      aoeTargets,
      blocked: applyBlockedCheck(currentSave, effect.attackerId, [
        "combat:blocked=invalidTargeting",
        `combat:targeting=${targetPreview.reason ?? "invalid"}`,
      ]),
    };
  }

  const attackerPos = combat.positions[effect.attackerId];
  if (attackerPos && targetPreview.affectedCells.length > 0) {
    aoeAttackDist = Math.max(...targetPreview.affectedCells.map((cell) => distanceChebyshev(attackerPos, cell)));
  } else if (attackerPos) {
    const selectionDist = resolveAoESelectionDistance(attackerPos, aoeTargetSelection);
    if (selectionDist !== null) {
      aoeAttackDist = selectionDist;
    }
  }

  const blockedCheck = validateAndApplyRangedModifiers(
    attackCheck,
    currentSave,
    aoeAttackDist,
    attackCheck.id,
    effect.attackerId,
  );
  if (blockedCheck) {
    if (index === 0) {
      return {
        targetPreview,
        aoeTargets,
        blocked: {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
    return { targetPreview, aoeTargets, shouldSkip: true };
  }

  const partyIds = new Set(currentSave.party?.actors ?? []);
  const attackerIsParty = partyIds.has(effect.attackerId) || attacker.kind === "PC";
  aoeTargets = (targetPreview?.affectedActorIds ?? []).filter((actorId) => {
    const targetActor = currentSave.actorsById[actorId];
    if (!targetActor || !isActorAlive(targetActor)) return false;
    const targetIsParty = partyIds.has(actorId) || targetActor.kind === "PC";
    return attackerIsParty ? !targetIsParty : targetIsParty;
  });

  return { targetPreview, aoeTargets };
}
