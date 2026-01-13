import type { Effect, GameSave, StoryPack, OpposedCheck, ItemRef } from "../../types";
import { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { footprintDistanceBetweenActors } from "../footprint";
import { posKey } from "../../items";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../characters/actions";

/**
 * Disarm: opposed WS vs WS; if attacker wins -> remove defender weapon and add to groundItemsByPos
 */
export function combatDisarm(
  effect: Extract<Effect, { op: "combatDisarm" }>,
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

  if (catalogs && !hasUnlockedAction(save, catalogs, effect.attackerId, "combat:disarm")) {
    const blockedCheck = {
      checkId: "combat:disarm:blocked",
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
      checkId: "combat:disarm:blocked",
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
      checkId: "combat:disarm:blocked",
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

  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, save);
  if (!defender) {
    return { save };
  }

  // Check if defender has a weapon
  const defenderMainHand = defender.equipment?.mainHand;
  const defenderWeaponId = defenderMainHand?.kind === "weapon" ? defenderMainHand.id : null;

  if (!defenderWeaponId || defenderWeaponId === "unarmed") {
    const blockedCheck = {
      checkId: "combat:disarm:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=defenderUnarmed"],
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

  // Perform opposed WS check
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  if (!attacker) {
    return { save: currentSave };
  }

  const opposedCheck: OpposedCheck = {
    id: `combat:disarm:${effect.attackerId}:${effect.defenderId}`,
    kind: "opposed",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      key: "WS",
      difficulty: "Challenging",
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
      key: "WS",
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

  if (result.success) {
    // Attacker wins - disarm defender
    // Create ItemRef for the weapon being dropped
    const weaponItemRef: ItemRef = { kind: "weapon", id: defenderWeaponId };

    // Update defender equipment (clear mainHand)
    const updatedDefender = {
      ...defender,
      equipment: {
        ...defender.equipment,
        mainHand: null,
      },
    };

    const updatedActorsById = {
      ...currentSave.actorsById,
      [effect.defenderId]: updatedDefender,
    };

    // Add weapon to groundItemsByPos at defender position
    const posKeyStr = posKey(defenderPos);
    const currentGroundItemsByPos = combat.groundItemsByPos || {};
    const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
    const updatedGroundItemsByPos = {
      ...currentGroundItemsByPos,
      [posKeyStr]: [...itemsAtPos, weaponItemRef],
    };

    const updatedCombat = {
      ...combatWithActionConsumed,
      groundItemsByPos: updatedGroundItemsByPos,
    };

    currentSave = {
      ...currentSave,
      actorsById: updatedActorsById,
      runtime: {
        ...currentSave.runtime,
        combat: updatedCombat,
      },
    };

    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const weaponName = save.weaponsById?.[defenderWeaponId]?.name || "l'arma";
    const logEntry =
      attacker.kind === "PC"
        ? `Disarmi ${defenderName}! ${weaponName} cade a terra.`
        : `${attackerName} disarma ${defenderName}! ${weaponName} cade a terra.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  } else {
    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry =
      attacker.kind === "PC"
        ? `Tenti di disarmare ${defenderName} ma fallisci.`
        : `${attackerName} tenta di disarmare ${defenderName} ma fallisce.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  }

  return { save: currentSave };
}
