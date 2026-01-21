import type { Effect, GameSave, StoryPack, SingleCheck } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import { getCharacteristicBonus } from "../../characters/bonuses";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { getUntouchableAuraImpact } from "../untouchableAura";
import { hasTrait } from "../../characters/prerequisites";

/**
 * Channeling action: Full Round Action
 * Performs a d100 check on Channeling skill (MVP: uses WIL bonus)
 * If success: accumulate DoS into combatState.channeling
 */
export function combatChannel(
  effect: Extract<Effect, { op: "combatChannel" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:channel:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:channel:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Load catalogs for bonus calculation
  const catalogs: CharacterCatalogs | undefined =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? {
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        }
      : undefined;

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }

  // MVP: Use WIL bonus for channeling (future: use SKILL:skill:channeling)
  const wilBonus = getCharacteristicBonus(save, turnActorId, "WIL", catalogs);
  const channelingTarget = wilBonus;

  // Untouchable aura penalty applies when a weaver channels within the aura
  let auraPenalty = 0;
  if (hasTrait(actor, "trait:weaver", save) && catalogs) {
    const impact = getUntouchableAuraImpact(save, catalogs, turnActorId);
    if (impact) {
      auraPenalty = impact.penalty;
    }
  }

  // Create channeling check
  const channelingCheck: SingleCheck = {
    id: `combat:channeling:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: "WIL", // MVP: use WIL stat directly
    difficulty: "Challenging",
    modifier: auraPenalty !== 0 ? auraPenalty : undefined,
  };

  // Generate resolutionId
  const { save: saveWithSeq, seq } = nextRuntimeSeq(save);
  const resolutionId = `res:${seq}`;

  // Perform check
  const { result, save: afterCheckSave } = performCheckWithSave(
    channelingCheck,
    storyPack,
    saveWithSeq,
    rng,
    resolutionId
  );

  if (!result) {
    return { save: afterCheckSave };
  }

  // Update combat state: consume action and movement (Full Round Action)
  const currentChanneling = combat.channeling;
  const accumulatedDoS = currentChanneling?.actorId === turnActorId ? currentChanneling.accumulatedDoS : 0;
  const newAccumulatedDoS = result.success ? accumulatedDoS + result.dos : accumulatedDoS;

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false, // Consume action
      moveRemaining: 0, // Full Round Action: no movement
    },
    channeling: result.success
      ? {
          actorId: turnActorId,
          accumulatedDoS: newAccumulatedDoS,
          lastChannelTurnCounter: combat.turnCounter ?? 0,
        }
      : currentChanneling, // Keep existing channeling if failed
  };

  let updatedSave: GameSave = {
    ...afterCheckSave,
    runtime: {
      ...afterCheckSave.runtime,
      combat: updatedCombat,
      lastCheck: result,
    },
  };

  // Add narration
  if (result.success) {
    const logEntry =
      actor?.kind === "PC"
        ? `Canalizzi energia magica. Accumuli ${result.dos} DoS (totale: ${newAccumulatedDoS}).`
        : `${actor?.name || turnActorId} canalizza energia magica. Accumula ${result.dos} DoS (totale: ${newAccumulatedDoS}).`;
    updatedSave = appendCombatLog(updatedSave, logEntry);

    // Log system entry
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Channeling: accumulati ${result.dos} DoS (totale: ${newAccumulatedDoS})`,
      turnCounter: combat.turnCounter,
      resolutionId,
    });
  } else {
    const logEntry =
      actor?.kind === "PC"
        ? `Tentativo di canalizzazione fallito.`
        : `${actor?.name || turnActorId} fallisce il tentativo di canalizzazione.`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  }

  return { save: updatedSave };
}

