import { appendCombatLog } from "../../../narration";
import { distanceChebyshev } from "../../../movement";
import { canPlaceActorAt } from "../../../footprint";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatBlinkStep(params: SpecialOpParams): SpecialOpResult | null {
  const { save, turnActorId, effectDef, effectStatBonus, targetSelection, terrainContentPack } = params;
  if (effectDef.specialOp !== "combatBlinkStep") {
    return null;
  }

  let updatedSave = save;
  const casterPos = updatedSave.runtime.combat?.positions[turnActorId];
  const targetPos = targetSelection.kind === "single" ? targetSelection.targetPos : null;
  if (!casterPos || !targetPos) {
    return { handled: true, save: updatedSave };
  }
  const maxRange = Math.max(0, effectStatBonus * 2);
  const dist = distanceChebyshev(casterPos, targetPos);
  if (dist > maxRange) {
    updatedSave = appendCombatLog(updatedSave, "Il bersaglio e' fuori portata.");
    return { handled: true, save: updatedSave };
  }
  const canPlace = canPlaceActorAt(updatedSave, turnActorId, targetPos as any, terrainContentPack, false);
  if (!canPlace) {
    updatedSave = appendCombatLog(updatedSave, "Non puoi teletrasportarti in quella posizione.");
    return { handled: true, save: updatedSave };
  }
  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      combat: {
        ...updatedSave.runtime.combat!,
        positions: {
          ...updatedSave.runtime.combat!.positions,
          [turnActorId]: targetPos,
        },
      },
    },
  };
  const casterName = updatedSave.actorsById[turnActorId]?.name || turnActorId;
  updatedSave = appendCombatLog(updatedSave, `${casterName} si teletrasporta.`);
  return { handled: true, save: updatedSave };
}
