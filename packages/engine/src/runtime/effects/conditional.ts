import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG } from "../rng";
import { evaluateCondition } from "../conditions";

export function applyConditionalEffects(
  effect: Extract<Effect, { op: "conditionalEffects" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  for (const case_ of effect.cases) {
    if (evaluateCondition(case_.when, save)) {
      // Return effects to be processed by queue
      return { save, emittedEffects: case_.then };
    }
  }
  return { save };
}

