import type { Effect, GameSave, StoryPack, OpposedCheck } from "../../types";
import { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { footprintDistanceBetweenActors } from "../footprint";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../characters/actions";

/**
 * Knockdown: opposed STR vs STR; if attacker wins -> addCondition(prone) on defender
 */
export function combatKnockdown(
  effect: Extract<Effect, { op: "combatKnockdown" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.attackerId) {
    return { save };
  }

  // Load catalogs and check if action is unlocked
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

  if (catalogs && !hasUnlockedAction(save, catalogs, effect.attackerId, "combat:knockdown")) {
    const blockedCheck = {
      checkId: "combat:knockdown:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionNotUnlocked"],
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
    const blockedCheck = {
      checkId: "combat:knockdown:blocked",
      actorId: effect.attackerId,
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

  // Validate melee range
  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    return { save };
  }

  // Use footprint-to-footprint distance
  const dist = footprintDistanceBetweenActors(save, effect.attackerId, effect.defenderId);
  if (dist > 1) {
    const blockedCheck = {
      checkId: "combat:knockdown:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
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

  // Consume action and reset channeling (non-magic action)
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
    channeling: combat.channeling?.actorId === effect.attackerId ? undefined : combat.channeling,
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Perform opposed STR check
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
  if (!attacker || !defender) {
    return { save: currentSave };
  }

  const opposedCheck: OpposedCheck = {
    id: `combat:knockdown:${effect.attackerId}:${effect.defenderId}`,
    kind: "opposed",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      key: "STR",
      difficulty: "Challenging",
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
      key: "STR",
      difficulty: "Challenging",
    },
  };

  const { result, save: afterCheckSave } = performCheckWithSave(opposedCheck, storyPack, currentSave, rng);
  if (!result) {
    return { save: currentSave };
  }

  // Use the updated save from performCheckWithSave (includes automatic logging)
  currentSave = afterCheckSave;

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      rngCounter: rng.getCounter(),
    },
  };

  const emittedEffects: Effect[] = [];
  if (result.success) {
    // Attacker wins - add prone condition
    emittedEffects.push({
      op: "addCondition",
      actorId: effect.defenderId,
      condition: "prone",
      source: "knockdown",
    });

    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry = attacker.kind === "PC" ? `Atterri ${defenderName}!` : `${attackerName} atterra ${defenderName}!`;
    currentSave = appendCombatLog(currentSave, logEntry);
  } else {
    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry =
      attacker.kind === "PC"
        ? `Tenti di atterrare ${defenderName} ma resiste.`
        : `${attackerName} tenta di atterrare ${defenderName} ma resiste.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}
