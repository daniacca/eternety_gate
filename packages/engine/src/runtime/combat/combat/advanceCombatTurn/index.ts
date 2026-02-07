import { shouldCombatEnd, clearCombatEndConditions, initializeTurnState, updateAuraEffects } from "..";
import { loadCharacterCatalogs } from "../../../../content/loadCatalogs";
import type { GameSave, StoryPack, CheckResult } from "../../../types";
import { appendCombatLog } from "../../narration";
import { appendTurnHeader } from "./appendTurnHeader";
import { buildNewCombatState } from "./buildNewCombatState";
import { computeAliveParticipants } from "./computeAliveParticipants";
import { computeFinalAliveParticipants } from "./computeFinalAliveParticipants";
import { computeNextTurnSelection } from "./computeNextTurnSelection";
import { resetStancesForNewTurn } from "./resetStancesForNewTurn";
import { updateLastCheckForNewTurn } from "./updateLastCheckForNewTurn";
import { applyStunnedEffect } from "./applyStunnedEffect";
import { applyBleedingEffect } from "./applyBleedingEffect";
import { handleBoundEscape } from "./handleBoundEscape";
import { handleSpiritualInstability } from "./handleSpiritualInstability";
import { removeExpiredConditions } from "./removeExpiredConditions";

/**
 * Advances combat turn, removes KO participants, and ends combat if needed
 */
export function advanceCombatTurn(save: GameSave, storyPack?: StoryPack): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  const aliveParticipants = computeAliveParticipants(save, combat.participants);

  const last = save.runtime.lastCheck && save.runtime.lastCheck !== null ? save.runtime.lastCheck : null;

  // Check if combat should end based on faction deaths
  const endCheckResult = shouldCombatEnd(save, aliveParticipants);

  if (endCheckResult.shouldEnd) {
    const outcome = endCheckResult.outcome || "victory";
    const winnerId = endCheckResult.winnerId;

    // Determine scene ID where combat ended (use startedBySceneId if available)
    const endedSceneId = combat.startedBySceneId || save.runtime.currentSceneId;

    let logEntry: string;
    if (outcome === "victory") {
      logEntry = "Tutti i nemici presenti nell'area sono stati sconfitti.";
    } else {
      logEntry = "Il party è stato annientato. Game over.";
    }

    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [
            ...last.tags,
            "combat:state=end",
            `combat:outcome=${outcome}`,
            ...(winnerId ? [`combat:winner=${winnerId}`] : []),
          ],
        }
      : {
          checkId: "combat:end",
          actorId: save.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: ["combat:state=end", `combat:outcome=${outcome}`, ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        };

    const { actorsById: clearedActorsById, partyActors } = clearCombatEndConditions(save, combat.participants);

    let updatedSave = {
      ...save,
      actorsById: clearedActorsById,
      party: {
        ...save.party,
        actors: partyActors,
      },
      runtime: {
        ...save.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: endedSceneId,
      },
    };

    return appendCombatLog(updatedSave, logEntry);
  }

  const { prevActorId, newCurrentIndex, newRound, currentTurnActorId } = computeNextTurnSelection(
    combat,
    aliveParticipants,
  );

  // Set combatTurnStartIndex at the start of this new turn (before any actions)
  const currentLogLength = save.runtime.combatLog?.length ?? 0;
  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combatTurnStartIndex: currentLogLength,
    },
  };

  // Increment turn counter (monotonic) - needed for condition expiration checks
  const newTurnCounter = (combat.turnCounter ?? 0) + 1;

  // Load catalogs from storyPack (if available) for movement calculation with trait bonuses
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Initialize turn state for new actor and apply condition effects
  let currentActor = updatedSave.actorsById[currentTurnActorId];
  let newTurnState = currentActor
    ? initializeTurnState(currentActor, updatedSave, catalogs)
    : { moveRemaining: 0, actionAvailable: true };

  // Apply condition effects at turn start
  if (currentActor) {
    const isPlayerActor = currentActor.kind === "PC";
    const actorName = currentActor.name || currentTurnActorId;

    const stunnedResult = applyStunnedEffect(updatedSave, currentTurnActorId, newTurnCounter, newTurnState);
    updatedSave = stunnedResult.updatedSave;
    newTurnState = stunnedResult.newTurnState;

    const bleedingResult = applyBleedingEffect({
      updatedSave,
      currentActor,
      currentTurnActorId,
      last,
      prevActorId,
      storyPack,
      isPlayerActor,
      actorName,
      advanceFn: (nextSave) => advanceCombatTurn(nextSave, storyPack),
    });
    if (bleedingResult.earlyReturn) {
      return bleedingResult.earlyReturn;
    }
    updatedSave = bleedingResult.updatedSave;
    currentActor = bleedingResult.currentActor;

    const boundResult = handleBoundEscape({
      updatedSave,
      currentActor,
      currentTurnActorId,
      newTurnCounter,
      newTurnState,
      storyPack,
      isPlayerActor,
      actorName,
    });
    updatedSave = boundResult.updatedSave;
    currentActor = boundResult.currentActor;
    newTurnState = boundResult.newTurnState;

    const spiritualResult = handleSpiritualInstability({
      updatedSave,
      currentActor,
      currentTurnActorId,
      newTurnCounter,
      storyPack,
      catalogs,
      last,
      prevActorId,
      isPlayerActor,
      actorName,
      advanceFn: (nextSave) => advanceCombatTurn(nextSave, storyPack),
    });
    if (spiritualResult.earlyReturn) {
      return spiritualResult.earlyReturn;
    }
    updatedSave = spiritualResult.updatedSave;
    currentActor = spiritualResult.currentActor;

    const removalResult = removeExpiredConditions({
      updatedSave,
      currentActor,
      currentTurnActorId,
      newTurnCounter,
    });
    updatedSave = removalResult.updatedSave;
    currentActor = removalResult.currentActor;
  }

  const updatedStancesByActorId = resetStancesForNewTurn(combat, prevActorId, currentTurnActorId);

  const finalAliveParticipants = updatedSave.runtime.combat?.participants
    ? computeFinalAliveParticipants(updatedSave, updatedSave.runtime.combat.participants)
    : [];

  const newCombatState = buildNewCombatState(
    combat,
    finalAliveParticipants,
    newCurrentIndex,
    newRound,
    newTurnState,
    newTurnCounter,
    updatedStancesByActorId,
    currentTurnActorId,
  );

  const updatedLastCheck = updateLastCheckForNewTurn(last, newRound, currentTurnActorId);

  updatedSave = {
    ...updatedSave,
    runtime: { ...updatedSave.runtime, combat: newCombatState, lastCheck: updatedLastCheck },
  };

  updatedSave = appendTurnHeader(updatedSave, currentTurnActorId, newTurnCounter);

  return updateAuraEffects(updatedSave, catalogs);
}
