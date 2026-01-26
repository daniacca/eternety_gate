import type { Effect, GameSave } from "../types";
import { grantActorGold, spendActorGold } from "../characters/gold";

export function handleGrantGold(
  effect: Extract<Effect, { op: "grantGold" }>,
  save: GameSave
): { save: GameSave } {
  return { save: grantActorGold(save, effect.actorId, effect.amount) };
}

export function handleSpendGold(
  effect: Extract<Effect, { op: "spendGold" }>,
  save: GameSave
): { save: GameSave } {
  const result = spendActorGold(save, effect.actorId, effect.amount);
  if (result.error) {
    console.warn(`[spendGold] ${result.error}`);
  }
  return { save: result.save };
}
