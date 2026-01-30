import type { Effect, GameSave, StoryPack } from "../../types";
import { IRNG, RNG } from "../../rng";
import { getCurrentTurnActorId, advanceCombatTurn } from "../combat";
import { appendCombatLog } from "../narration";
import { runNpcTurn } from "../npcAi";
import type { ContentPack } from "../../../content/types";

/**
 * Ends the current turn and advances to next actor, running NPC turns until player's turn
 */
export function combatEndTurn(
  effect: Extract<Effect, { op: "combatEndTurn" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn - ignore
    return { save };
  }

  // Add narration before ending turn
  const actor = save.actorsById[turnActorId];
  const logEntry = actor?.kind === "PC" ? `Termini il turno.` : `${actor?.name || turnActorId} termina il turno.`;
  let currentSave: GameSave = appendCombatLog(save, logEntry);

  // Set combatCycleStartIndex to the start of the player's turn that just ended
  // This represents "the start of the turn that includes all player actions + 'Termini il turno'"
  // Must be captured BEFORE advanceCombatTurn changes combatTurnStartIndex
  const cycleStart = save.runtime.combatTurnStartIndex ?? 0;
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      rngCounter: rng.getCounter(),
      combatCycleStartIndex: cycleStart,
    },
  };
  currentSave = advanceCombatTurn(currentSave, storyPack);

  // Loop: run NPC turns until it's a player-controlled turn
  let safety = 0;
  while (currentSave.runtime.combat?.active) {
    const turnActorId = getCurrentTurnActorId(currentSave);
    if (!turnActorId) break;

    const partyIds = new Set(currentSave.party?.actors ?? []);
    if (partyIds.has(turnActorId)) {
      break;
    }

    const npcRng = new RNG(currentSave.runtime.rngSeed, currentSave.runtime.rngCounter || 0);
    currentSave = runNpcTurn(storyPack, currentSave, turnActorId, contentPack);
    currentSave = advanceCombatTurn(currentSave, storyPack);

    safety++;
    if (safety > 10) break; // safety guard
  }

  return { save: currentSave };
}
