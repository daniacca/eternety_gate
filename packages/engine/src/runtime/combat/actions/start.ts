import type { Effect, GameSave, StoryPack } from "../../types";
import { startCombat } from "../combat";
import { processNpcTurnsUntilPlayerTurn } from "../npcTurnProcessor";

/**
 * Starts combat with given participant IDs, grid, and placements
 */
export function combatStart(
  effect: Extract<Effect, { op: "combatStart" }>,
  storyPack: StoryPack,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  let combatSave = startCombat(
    storyPack,
    save,
    effect.participantIds,
    save.runtime.currentSceneId,
    effect.grid,
    effect.placements,
    effect.gridId
  );

  // If combat started with an NPC turn, process NPC turns until it's a player turn
  combatSave = processNpcTurnsUntilPlayerTurn(storyPack, combatSave);

  return {
    save: combatSave,
  };
}

