import type { CheckResult, GameSave } from "../../types";
import { appendCombatLog } from "../narration";
import { clearCombatEndConditions } from "./clearCombatEndConditions";
import { shouldCombatEnd } from "./shouldCombatEnd";
import { isActorAlive } from "../../characters/actors";

/**
 * Ensures combat end state is applied consistently.
 *
 * Why: different kill sources (spells, effects, conditions) may update isDead
 * without going through the attack action handlers that currently stamp
 * `combat:state=end` and `combatEndedSceneId`.
 *
 * This helper can be called after any batch of effects to make sure victory/defeat
 * UI triggers reliably.
 */
export function finalizeCombatIfEnded(save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  const aliveParticipants = combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });

  const end = shouldCombatEnd(save, aliveParticipants);
  if (!end.shouldEnd) return save;

  const outcome = end.outcome || "victory";
  const winnerId = end.winnerId;
  const endedSceneId = combat.startedBySceneId || save.runtime.currentSceneId;

  const last = save.runtime.lastCheck;
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

  const logEntry =
    outcome === "victory" ? "Tutti i nemici presenti nell'area sono stati sconfitti." : "Il party è stato annientato. Game over.";

  const { actorsById: clearedActorsById, partyActors } = clearCombatEndConditions(save, combat.participants);

  const updatedSave: GameSave = {
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
