import type { Effect, GameSave } from "../types";

export function applyClearChoiceCheckResults(
  effect: Extract<Effect, { op: "clearChoiceCheckResults" }>,
  save: GameSave
): GameSave {
  const current = save.runtime.choiceCheckResults;
  if (!current || Object.keys(current).length === 0) {
    return save;
  }

  const { onlyFailed, choiceIds } = effect;
  const restrictTo = choiceIds && choiceIds.length > 0 ? new Set(choiceIds) : null;

  const updated = Object.fromEntries(
    Object.entries(current).filter(([choiceId, check]) => {
      if (restrictTo && !restrictTo.has(choiceId)) return true;
      if (onlyFailed) {
        return check?.success === true;
      }
      return false;
    })
  );

  return {
    ...save,
    runtime: {
      ...save.runtime,
      choiceCheckResults: updated,
    },
  };
}
