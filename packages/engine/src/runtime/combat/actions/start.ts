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
  const partyIds = save.party?.actors ?? [];
  const participantIds = Array.from(new Set([...partyIds, ...effect.participantIds]));
  let combatSave = startCombat(
    storyPack,
    save,
    participantIds,
    save.runtime.currentSceneId,
    effect.grid,
    effect.placements,
    effect.partyPlacement,
    effect.gridId
  );

  // If combat started with an NPC turn, process NPC turns until it's a player turn
  combatSave = processNpcTurnsUntilPlayerTurn(storyPack, combatSave);

  return {
    save: combatSave,
  };
}

