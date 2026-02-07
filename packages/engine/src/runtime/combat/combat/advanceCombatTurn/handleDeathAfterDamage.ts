import type { ActorId, CheckResult, GameSave, StoryPack } from "../../../types";
import { appendCombatLog } from "../../narration";
import { removeConditionFromActor } from "../../../conditions";
import { isActorAlive } from "../../../characters/actors";
import { shouldCombatEnd } from "..";

type AdvanceFn = (save: GameSave) => GameSave;

export function handleDeathAfterDamage(params: {
  updatedSave: GameSave;
  currentTurnActorId: ActorId;
  prevActorId: ActorId;
  last: CheckResult | null;
  storyPack?: StoryPack;
  isPlayerActor: boolean;
  actorName: string;
  advanceFn: AdvanceFn;
}): GameSave | null {
  const { updatedSave, currentTurnActorId, prevActorId, last, isPlayerActor, actorName, advanceFn } = params;
  const updatedActor = updatedSave.actorsById[currentTurnActorId];
  if (!updatedActor || updatedActor.resources.isDead !== true) {
    return null;
  }

  const deathLog = isPlayerActor ? "Sei morto!" : `${actorName} è morto!`;
  let saveWithDeathLog = appendCombatLog(updatedSave, deathLog);

  const updatedAliveParticipants =
    saveWithDeathLog.runtime.combat?.participants.filter((id) => {
      const actor = saveWithDeathLog.actorsById[id];
      return isActorAlive(actor);
    }) || [];

  const endCheckResult = shouldCombatEnd(saveWithDeathLog, updatedAliveParticipants);
  if (endCheckResult.shouldEnd) {
    const outcome = endCheckResult.outcome || "victory";
    const winnerId = endCheckResult.winnerId;
    const combatState = saveWithDeathLog.runtime.combat;
    const endedSceneId = combatState?.startedBySceneId || saveWithDeathLog.runtime.currentSceneId;

    const endLog =
      outcome === "victory"
        ? "Tutti i nemici presenti nell'area sono stati sconfitti."
        : "Il party è stato annientato. Game over.";

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
          actorId: saveWithDeathLog.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: [
            "combat:state=end",
            `combat:outcome=${outcome}`,
            ...(winnerId ? [`combat:winner=${winnerId}`] : []),
          ],
        };

    saveWithDeathLog = appendCombatLog(saveWithDeathLog, endLog);

    const clearedActorsById = { ...saveWithDeathLog.actorsById };
    for (const actorId of saveWithDeathLog.runtime.combat?.participants ?? []) {
      const actor = clearedActorsById[actorId];
      if (actor?.conditions?.shock) {
        clearedActorsById[actorId] = removeConditionFromActor(actor, "shock");
      }
    }

    return {
      ...saveWithDeathLog,
      actorsById: clearedActorsById,
      runtime: {
        ...saveWithDeathLog.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: endedSceneId,
      },
    };
  }

  const combatAfterDeath = saveWithDeathLog.runtime.combat;
  if (combatAfterDeath) {
    const prevAliveIndex = updatedAliveParticipants.indexOf(prevActorId);
    const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : 0;

    saveWithDeathLog = {
      ...saveWithDeathLog,
      runtime: {
        ...saveWithDeathLog.runtime,
        combat: {
          ...combatAfterDeath,
          participants: updatedAliveParticipants,
          currentIndex: pivotIndex,
        },
      },
    };

    return advanceFn(saveWithDeathLog);
  }

  return null;
}
