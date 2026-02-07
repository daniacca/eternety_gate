import type { Effect, GameSave } from "../../../types";

export function consumeAimStanceIfNeeded(
  currentSave: GameSave,
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  aimConsumed: boolean,
): { save: GameSave; aimConsumed: boolean } {
  if (aimConsumed || effect.mode !== "RANGED") return { save: currentSave, aimConsumed };
  let updatedStancesByActorId = currentSave.runtime.combat?.stancesByActorId;
  if (updatedStancesByActorId?.[effect.attackerId] === "aim") {
    updatedStancesByActorId = {
      ...updatedStancesByActorId,
    };
    delete updatedStancesByActorId[effect.attackerId];
    return {
      save: {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          combat: {
            ...currentSave.runtime.combat!,
            stancesByActorId: updatedStancesByActorId,
          },
        },
      },
      aimConsumed: true,
    };
  }
  return { save: currentSave, aimConsumed: true };
}
