import type { Effect, GameSave, StoryPack, SingleCheck } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { getUntouchableAuraImpact } from "../untouchableAura";
import { hasTrait } from "../../characters/prerequisites";
import { getChannelingBonus } from "../../characters/talentModifiers";
import { isDoublesRoll, rollPhenomena } from "../../magic/phenomena";

/**
 * Channeling action: Full Round Action
 * Performs a d100 check on Channeling skill
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

  const actor = save.actorsById[turnActorId];
  if (actor?.conditions?.frenzy) {
    const blockedCheck = {
      checkId: "combat:channel:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=frenzy"],
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
  if (actor?.conditions?.shock) {
    const blockedCheck = {
      checkId: "combat:channel:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=shock"],
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
      ? loadCharacterCatalogs({
          id: storyPack.id,
          items: storyPack.items || [],
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  if (!actor) {
    return { save };
  }

  // Untouchable aura penalty applies when a weaver channels within the aura
  let auraPenalty = 0;
  if (hasTrait(actor, "trait:weaver", save) && catalogs) {
    const impact = getUntouchableAuraImpact(save, catalogs, turnActorId);
    if (impact) {
      auraPenalty = impact.penalty;
    }
  }
  const channelBonus = catalogs ? getChannelingBonus(save, catalogs, turnActorId) : 0;
  const channelModifier = auraPenalty + channelBonus;

  // Create channeling check
  const channelingCheck: SingleCheck = {
    id: `combat:channeling:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: "SKILL:skill:channeling",
    difficulty: "Challenging",
    modifier: channelModifier !== 0 ? channelModifier : undefined,
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

  const currentChanneling = combat.channeling;
  const accumulatedDoS = currentChanneling?.actorId === turnActorId ? currentChanneling.accumulatedDoS : 0;
  const addedDoS = result.success ? Math.max(1, result.dos) : 0;

  let newAccumulatedDoS: number;
  let channelingState: typeof combat.channeling;
  if (result.success) {
    newAccumulatedDoS = accumulatedDoS + addedDoS;
    channelingState = {
      actorId: turnActorId,
      accumulatedDoS: newAccumulatedDoS,
      lastChannelTurnCounter: combat.turnCounter ?? 0,
    };
  } else {
    newAccumulatedDoS = Math.max(0, accumulatedDoS - result.dof);
    if (isDoublesRoll(result) && result.dof >= 1) {
      channelingState = undefined;
    } else {
      channelingState =
        newAccumulatedDoS > 0 && currentChanneling?.actorId === turnActorId
          ? { ...currentChanneling, accumulatedDoS: newAccumulatedDoS }
          : newAccumulatedDoS > 0
            ? { actorId: turnActorId, accumulatedDoS: newAccumulatedDoS, lastChannelTurnCounter: combat.turnCounter ?? 0 }
            : undefined;
    }
  }

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      moveRemaining: 0,
    },
    channeling: channelingState,
  };

  let updatedSave: GameSave = {
    ...afterCheckSave,
    runtime: {
      ...afterCheckSave.runtime,
      combat: updatedCombat,
      lastCheck: result,
    },
  };

  if (isDoublesRoll(result) && result.dof >= 1 && !result.success) {
    const phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs);
    updatedSave = phenomenaResult.save;
    updatedSave = appendCombatLog(updatedSave, `Fenomeno durante canalizzazione: ${phenomenaResult.description}`);
  }

  if (result.success) {
    const logEntry =
      actor?.kind === "PC"
        ? `Canalizzi energia magica. Accumuli ${addedDoS} DoS (totale: ${newAccumulatedDoS}).`
        : `${actor?.name || turnActorId} canalizza energia magica. Accumula ${addedDoS} DoS (totale: ${newAccumulatedDoS}).`;
    updatedSave = appendCombatLog(updatedSave, logEntry);

    // Log system entry
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Channeling: accumulati ${addedDoS} DoS (totale: ${newAccumulatedDoS})`,
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

