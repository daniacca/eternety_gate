import type { Effect, GameSave, StoryPack } from "../../types";
import { startCombat } from "../combat";

/**
 * Starts combat with given participant IDs, grid, and placements
 */
export function combatStart(
  effect: Extract<Effect, { op: "combatStart" }>,
  storyPack: StoryPack,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  return {
    save: startCombat(
      storyPack,
      save,
      effect.participantIds,
      save.runtime.currentSceneId,
      effect.grid,
      effect.placements
    ),
  };
}

