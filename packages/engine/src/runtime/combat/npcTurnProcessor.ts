import type { StoryPack, GameSave, ActorId } from "../types";
import { RNG } from "../rng";
import { getCurrentTurnActorId, advanceCombatTurn } from "./combat";
import { runNpcTurn } from "./npcAi";
import type { ContentPack } from "../../content/types";

/**
 * Processes NPC turns automatically until it's a player's turn
 * This ensures NPCs act immediately when it's their turn
 */
export function processNpcTurnsUntilPlayerTurn(storyPack: StoryPack, save: GameSave, contentPack?: ContentPack): GameSave {
  let currentSave = save;
  let safety = 0;

  // Loop: run NPC turns until it's a player's turn
  while (currentSave.runtime.combat?.active) {
    const turnActorId = getCurrentTurnActorId(currentSave);
    if (!turnActorId) break;

    // Check if current turn actor is a party member (player-controlled)
    // Party membership can change mid-combat (e.g., mind control), so recompute each loop.
    const partyIds = new Set(currentSave.party?.actors ?? []);
    const isPlayerTurn = partyIds.has(turnActorId);
    if (isPlayerTurn) {
      // It's a player turn - stop processing
      break;
    }

    // It's an NPC turn - run it
    const npcRng = new RNG(currentSave.runtime.rngSeed, currentSave.runtime.rngCounter || 0);
    currentSave = runNpcTurn(storyPack, currentSave, turnActorId, contentPack);

    // Advance to next turn
    currentSave = advanceCombatTurn(currentSave, storyPack);

    safety++;
    if (safety > 20) {
      // Safety guard - prevent infinite loops
      console.warn("processNpcTurnsUntilPlayerTurn: safety limit reached");
      break;
    }
  }

  return currentSave;
}
