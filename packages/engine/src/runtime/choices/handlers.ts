import type { Choice, StoryPack, GameSave, ChoiceId } from "../types";
import type { IRNG } from "../rng";
import type { ChoiceKind, ChoiceHandler } from "./types";
import { handleGenericChoice } from "./generic";
import { handleCheckChoice } from "./check";
import { handleCombatChoice } from "./combat";

/**
 * Determines the kind of a choice based on its content
 */
function getChoiceKind(choice: Choice): ChoiceKind {
  // Check if choice has any combatAttack checks
  const hasCombatAttack = choice.checks?.some((check) => check.kind === "combatAttack");
  if (hasCombatAttack) {
    return "combat";
  }

  // Check if choice has any checks
  const hasChecks = choice.checks && choice.checks.length > 0;
  if (hasChecks) {
    return "check";
  }

  // Default to generic (just effects)
  return "generic";
}

/**
 * Registry of choice handlers by kind
 */
export const choiceHandlers: Record<ChoiceKind, ChoiceHandler> = {
  generic: handleGenericChoice,
  check: handleCheckChoice,
  combat: handleCombatChoice,
};

/**
 * Routes a choice to the appropriate handler based on its kind
 */
export function handleChoice(
  choice: Choice,
  choiceId: ChoiceId,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave {
  const kind = getChoiceKind(choice);
  const handler = choiceHandlers[kind];
  if (handler) {
    return handler(choice, choiceId, storyPack, save, rng);
  }
  // Fallback to generic if handler not found
  return handleGenericChoice(choice, choiceId, storyPack, save, rng);
}

