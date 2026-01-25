import type { Effect, GameSave, StoryPack, Actor } from "../../types";
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
  let workingSave = save;
  if (effect.resetParticipants && storyPack.cast?.npcs?.length) {
    const npcById = new Map(storyPack.cast.npcs.map((npc) => [npc.id, npc]));
    const updatedActors: Record<string, Actor> = {};
    for (const id of effect.participantIds) {
      const npc = npcById.get(id);
      if (!npc) continue;
      updatedActors[id] = {
        ...npc,
        resources: {
          ...npc.resources,
          wounds: 0,
          rf: 0,
          criticalDamage: 0,
          criticalTierApplied: 0,
          isDead: false,
        },
        conditions: undefined,
        status: {
          conditions: [],
          tempModifiers: [],
        },
      };
    }
    if (Object.keys(updatedActors).length > 0) {
      workingSave = {
        ...workingSave,
        actorsById: {
          ...workingSave.actorsById,
          ...updatedActors,
        },
      };
    }
  }

  const partyIds = workingSave.party?.actors ?? [];
  const participantIds = Array.from(new Set([...partyIds, ...effect.participantIds]));
  let combatSave = startCombat(
    storyPack,
    workingSave,
    participantIds,
    workingSave.runtime.currentSceneId,
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

