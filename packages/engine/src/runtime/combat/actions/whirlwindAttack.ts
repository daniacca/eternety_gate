import type { Effect, GameSave, StoryPack, CombatAttackCheck, CheckResult } from "../../types";
import { IRNG } from "../../rng";
import { finalizeCombatIfEnded, getCurrentTurnActorId } from "../combat";
import { appendCombatLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave } from "../../checks";
import { applyCombatDamageIfHit } from "../damage";
import { footprintDistanceBetweenActors } from "../footprint";
import { getEquippedWeaponId } from "../../characters/inventory";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../characters/actions";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { isActorAlive } from "../../characters/actors";
import {
  getNaturalWeaponProfile,
  getNaturalWeaponProfileFromActor,
  isNaturalWeaponId,
} from "../../characters/naturalWeapons";

export function combatWhirlwindAttack(
  effect: Extract<Effect, { op: "combatWhirlwindAttack" }>,
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

  const attacker = save.actorsById[turnActorId];
  if (!attacker) {
    return { save };
  }

  const catalogs =
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

  if (catalogs && !hasUnlockedAction(save, catalogs, effect.attackerId, "combat:whirlwindAttack")) {
    const blockedCheck = {
      checkId: "combat:whirlwindAttack:blocked",
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
      checkId: "combat:whirlwindAttack:blocked",
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

  const partyIds = new Set(save.party?.actors ?? []);
  const attackerIsParty = partyIds.has(attacker.id) || attacker.kind === "PC";
  const meleeTargets = combat.participants
    .filter((id) => id !== effect.attackerId)
    .filter((id) => {
      const target = save.actorsById[id];
      if (!target || !isActorAlive(target)) return false;
      const targetIsParty = partyIds.has(id) || target.kind === "PC";
      const isEnemy = attackerIsParty ? !targetIsParty : targetIsParty;
      if (!isEnemy) return false;
      const dist = footprintDistanceBetweenActors(save, effect.attackerId, id);
      return dist <= 1;
    })
    .sort((a, b) => a.localeCompare(b));

  if (meleeTargets.length < 2) {
    const blockedCheck = {
      checkId: "combat:whirlwindAttack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notEnoughTargets"],
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

  const wsBonus = catalogs ? getCharacteristicBonus(save, attacker.id, "WS", catalogs) : getCharacteristicBonus(save, attacker.id, "WS");
  const maxTargets = Math.max(1, wsBonus);
  const targets = meleeTargets.slice(0, maxTargets);

  let weaponId = effect.weaponId ?? getEquippedWeaponId(attacker);
  if (!weaponId || (isNaturalWeaponId(weaponId) && !save.weaponsById?.[weaponId])) {
    const naturalWeapon =
      catalogs ? getNaturalWeaponProfile(save, catalogs, attacker.id) : getNaturalWeaponProfileFromActor(attacker);
    if (naturalWeapon) {
      weaponId = naturalWeapon.id;
    }
  }

  // Consume action and movement (full round) and reset channeling
  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: {
        ...combat,
        turn: {
          ...combat.turn,
          actionAvailable: false,
          moveRemaining: 0,
        },
        channeling: combat.channeling?.actorId === effect.attackerId ? undefined : combat.channeling,
      },
    },
  };

  if (weaponId && weaponId !== "unarmed" && currentSave.weaponsById?.[weaponId] == null) {
    const naturalWeapon =
      catalogs ? getNaturalWeaponProfile(currentSave, catalogs, attacker.id) : getNaturalWeaponProfileFromActor(attacker);
    if (naturalWeapon) {
      currentSave = {
        ...currentSave,
        weaponsById: {
          ...(currentSave.weaponsById || {}),
          [naturalWeapon.id]: naturalWeapon,
        },
      };
      weaponId = naturalWeapon.id;
    } else {
      weaponId = null;
    }
  }

  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:whirlwind:${seq}`;
  currentSave = saveWithSeq;

  const attackerName = attacker.name || effect.attackerId;
  currentSave = appendCombatLog(
    currentSave,
    attacker.kind === "PC" ? "Ti lanci in una raffica di colpi!" : `${attackerName} si lancia in una raffica di colpi!`
  );

  for (const targetId of targets) {
    const target = currentSave.actorsById[targetId];
    if (!target) continue;

    const check: CombatAttackCheck = {
      id: `combat:whirlwind:${effect.attackerId}:${targetId}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: effect.attackerId },
        mode: "MELEE",
        weaponId: weaponId ?? null,
      },
      defender: {
        actorRef: { mode: "byId", actorId: targetId },
      },
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };

    const attackResolutionId = `${resolutionId}:${targetId}`;
    const { result, save: afterCheckSave } = performCheckWithSave(check, storyPack, currentSave, rng, attackResolutionId);
    if (!result) {
      continue;
    }
    currentSave = {
      ...afterCheckSave,
      runtime: {
        ...afterCheckSave.runtime,
        lastCheck: result,
        lastPlayerCheck: attacker.kind === "PC" ? result : afterCheckSave.runtime.lastPlayerCheck,
        rngCounter: rng.getCounter(),
      },
    };

    const defenderName = target.name || targetId;
    const logEntry =
      attacker.kind === "PC"
        ? `Colpisci ${defenderName} con un attacco vorticoso!`
        : `${attackerName} colpisce ${defenderName} con un attacco vorticoso!`;
    currentSave = appendCombatLog(currentSave, logEntry);

    const damageResult = applyCombatDamageIfHit(
      check,
      result,
      currentSave,
      rng,
      storyPack,
      attackResolutionId,
      catalogs
    );
    currentSave = damageResult.save;

    if (currentSave.runtime.gameOver) {
      return { save: currentSave };
    }
  }

  currentSave = finalizeCombatIfEnded(currentSave);
  return { save: currentSave };
}
