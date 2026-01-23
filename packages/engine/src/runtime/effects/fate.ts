import type { Effect, GameSave } from "../types";
import { setFateProtectionActive } from "../characters/fate";

export function handleSetFateProtection(
  effect: Extract<Effect, { op: "setFateProtection" }>,
  save: GameSave
): { save: GameSave } {
  return { save: setFateProtectionActive(save, effect.actorId, effect.active) };
}

 