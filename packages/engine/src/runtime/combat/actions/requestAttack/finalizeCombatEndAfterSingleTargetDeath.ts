import type { ActorId, CheckResult, GameSave } from "../../../types";
import { clearCombatEndConditions } from "../../combat";
import { appendCombatLog } from "../../narration";

export function finalizeCombatEndAfterSingleTargetDeath(save: GameSave, defenderId: ActorId): GameSave {
  if (!save.runtime.combat?.active) return save;

  const deadActor = save.actorsById[defenderId];
  if (!deadActor || deadActor.resources.isDead !== true) {
    return save;
  }

  const aliveParticipants = save.runtime.combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return actor && actor.resources.isDead !== true;
  });

  const partyIds = new Set(save.party.actors);
  const enemyIds = aliveParticipants.filter((id) => !partyIds.has(id));
  const partyAlive = aliveParticipants.filter((id) => {
    const actor = save.actorsById[id];
    return partyIds.has(id) && actor && actor.resources.isDead !== true;
  });
  const enemiesAlive = aliveParticipants.filter((id) => {
    const actor = save.actorsById[id];
    return enemyIds.includes(id) && actor && actor.resources.isDead !== true;
  });

  if (enemiesAlive.length === 0 && partyAlive.length > 0) {
    const combatState = save.runtime.combat;
    const endedSceneId = combatState?.startedBySceneId || save.runtime.currentSceneId;
    const clearedResult = combatState?.participants
      ? clearCombatEndConditions(save, combatState.participants)
      : { actorsById: save.actorsById, partyActors: save.party?.actors ?? [] };
    const clearedActorsById = clearedResult.actorsById;
    let updatedSave = appendCombatLog(save, "Tutti i nemici presenti nell'area sono stati sconfitti.");

    const last = updatedSave.runtime.lastCheck;
    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [...last.tags, "combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
        }
      : {
          checkId: "combat:end",
          actorId: updatedSave.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: ["combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
        };

    return {
      ...updatedSave,
      actorsById: clearedActorsById,
      party: {
        ...updatedSave.party,
        actors: clearedResult.partyActors,
      },
      runtime: {
        ...updatedSave.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: endedSceneId,
      },
    };
  }

  if (partyAlive.length === 0) {
    const combatState = save.runtime.combat;
    const endedSceneId = combatState?.startedBySceneId || save.runtime.currentSceneId;
    const clearedResult = combatState?.participants
      ? clearCombatEndConditions(save, combatState.participants)
      : { actorsById: save.actorsById, partyActors: save.party?.actors ?? [] };
    const clearedActorsById = clearedResult.actorsById;
    let updatedSave = appendCombatLog(save, "Il party è stato annientato. Game over.");

    const last = updatedSave.runtime.lastCheck;
    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [
            ...last.tags,
            "combat:state=end",
            "combat:outcome=defeat",
            ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
          ],
        }
      : {
          checkId: "combat:end",
          actorId: updatedSave.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: [
            "combat:state=end",
            "combat:outcome=defeat",
            ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
          ],
        };

    return {
      ...updatedSave,
      actorsById: clearedActorsById,
      party: {
        ...updatedSave.party,
        actors: clearedResult.partyActors,
      },
      runtime: {
        ...updatedSave.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: endedSceneId,
      },
    };
  }

  return save;
}
