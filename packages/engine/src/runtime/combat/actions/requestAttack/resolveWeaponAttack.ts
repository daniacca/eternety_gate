import type { CombatAttackCheck, Effect, GameSave, StoryPack } from "../../../types";
import type { TargetPreview } from "../../targeting/types";
import type { IRNG } from "../../../rng";
import type { loadCatalogsForAttack } from "./loadCatalogsForAttack";
import { appendAttackNarration, appendCombatLog } from "../../narration";
import { finalizeCombatIfEnded } from "../../combat";
import { performCheckWithSave, resolveActor } from "../../../checks";
import { applyCombatDamageIfHit } from "../../damage";
import { validateAndApplyRangedModifiers } from "../../validation";
import { getWeaponQualityRank, hasWeaponQuality } from "../../../weaponQualities";
import { applyGameOverIfNeeded } from "./applyGameOverIfNeeded";
import { consumeAimStanceIfNeeded } from "./consumeAimStanceIfNeeded";
import { finalizeCombatEndAfterSingleTargetDeath } from "./finalizeCombatEndAfterSingleTargetDeath";
import { handleRangedWeaponState } from "./handleRangedWeaponState";
import { resolveAoETargeting } from "./resolveAoETargeting";
import { updateWeaponRechargeAfterCheck } from "./updateWeaponRechargeAfterCheck";

export type WeaponAttackContext = {
  effect: Extract<Effect, { op: "combatRequestAttack" }>;
  storyPack: StoryPack;
  rng: IRNG;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  dist: number;
  channelDoS: number;
  currentTurnCounter: number;
  attacker: GameSave["actorsById"][string];
  buildCombatCheck: (
    weaponId: string | null,
    suffix: string,
    defenderId?: string,
    defenseOverride?: CombatAttackCheck["defense"],
  ) => CombatAttackCheck;
  catalogs: ReturnType<typeof loadCatalogsForAttack>;
  resolutionId: string;
};

export type WeaponAttackResult = {
  save: GameSave;
  aimConsumed: boolean;
  emittedEffects: Effect[];
  blocked: boolean;
  skipped: boolean;
  shouldBreak: boolean;
};

export function resolveWeaponAttack(
  context: WeaponAttackContext,
  currentSave: GameSave,
  aimConsumed: boolean,
  weaponId: string | null,
  index: number,
  weaponCount: number,
): WeaponAttackResult {
  const {
    effect,
    storyPack,
    rng,
    combat,
    dist,
    channelDoS,
    currentTurnCounter,
    attacker,
    buildCombatCheck,
    catalogs,
    resolutionId,
  } = context;

  const suffix = weaponCount > 1 ? `:twf${index + 1}` : "";
  const attackCheck = buildCombatCheck(weaponId, suffix);
  const weaponDef = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
  const hasSpray = effect.mode === "RANGED" && hasWeaponQuality(weaponDef, "spray");
  const blastRank = effect.mode === "RANGED" ? getWeaponQualityRank(weaponDef, "blast") : null;
  const hasBlast = blastRank !== null && blastRank > 0;
  const usesAoE = hasSpray || hasBlast;
  let targetPreview: TargetPreview | null = null;
  let aoeTargets: string[] = [];

  if (effect.mode === "RANGED" && usesAoE) {
    const aoeResult = resolveAoETargeting(
      effect,
      currentSave,
      combat,
      attackCheck,
      weaponDef,
      hasBlast,
      blastRank,
      attacker,
      index,
    );
    if (aoeResult.blocked) {
      return {
        save: aoeResult.blocked,
        aimConsumed,
        emittedEffects: [],
        blocked: true,
        skipped: false,
        shouldBreak: false,
      };
    }
    if (aoeResult.shouldSkip) {
      return {
        save: currentSave,
        aimConsumed,
        emittedEffects: [],
        blocked: false,
        skipped: true,
        shouldBreak: false,
      };
    }
    targetPreview = aoeResult.targetPreview;
    aoeTargets = aoeResult.aoeTargets;
  }

  if (effect.mode === "RANGED" && !usesAoE) {
    const blockedCheck = validateAndApplyRangedModifiers(
      attackCheck,
      currentSave,
      dist,
      attackCheck.id,
      effect.attackerId,
    );
    if (blockedCheck) {
      if (index === 0) {
        return {
          save: {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          },
          aimConsumed,
          emittedEffects: [],
          blocked: true,
          skipped: false,
          shouldBreak: false,
        };
      }
      return {
        save: currentSave,
        aimConsumed,
        emittedEffects: [],
        blocked: false,
        skipped: true,
        shouldBreak: false,
      };
    }
  }

  const rangedState = handleRangedWeaponState(effect, currentSave, weaponId, currentTurnCounter, index);
  if (rangedState.blocked) {
    return {
      save: rangedState.blocked,
      aimConsumed,
      emittedEffects: [],
      blocked: true,
      skipped: false,
      shouldBreak: false,
    };
  }
  if (rangedState.shouldSkip) {
    return {
      save: rangedState.save,
      aimConsumed,
      emittedEffects: [],
      blocked: false,
      skipped: true,
      shouldBreak: false,
    };
  }
  currentSave = rangedState.save;

  const attackResolutionId = `${resolutionId}${suffix}`;
  const attackCheckForRoll = usesAoE
    ? buildCombatCheck(weaponId, `${suffix}:aoe`, aoeTargets[0] ?? effect.defenderId, {
        allowParry: false,
        allowDodge: false,
        strategy: "autoBest",
      })
    : attackCheck;
  const { result, save: afterCheckSave } = performCheckWithSave(
    attackCheckForRoll,
    storyPack,
    currentSave,
    rng,
    attackResolutionId,
  );
  if (!result) {
    return {
      save: currentSave,
      aimConsumed,
      emittedEffects: [],
      blocked: false,
      skipped: true,
      shouldBreak: false,
    };
  }

  currentSave = afterCheckSave;
  currentSave = updateWeaponRechargeAfterCheck(currentSave, effect, weaponId, weaponDef);

  const isPlayerActor = currentSave.actorsById[effect.attackerId]?.kind === "PC";
  const aimResult = consumeAimStanceIfNeeded(currentSave, effect, aimConsumed);
  currentSave = aimResult.save;
  aimConsumed = aimResult.aimConsumed;

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      lastPlayerCheck: isPlayerActor ? result : currentSave.runtime.lastPlayerCheck,
      rngCounter: rng.getCounter(),
    },
  };

  const weaponForQuality = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
  const isMagicFueled = hasWeaponQuality(weaponForQuality, "magic_fueled");
  const magicFueledRank = getWeaponQualityRank(weaponForQuality, "magic_fueled") ?? 1;
  const vengeanceDamageOptions =
    effect.vengeanceShot && result.success
      ? { bonusDamage: result.dos, bonusPenetration: result.dos }
      : undefined;

  let damageResult = { save: currentSave, didApplyDamage: false, targetKo: false } as ReturnType<
    typeof applyCombatDamageIfHit
  >;
  const onDamageEffects: Effect[] = [];

  if (usesAoE) {
    if (targetPreview && targetPreview.affectedActorIds.length > 0) {
      const targetNames = aoeTargets.map((id) => currentSave.actorsById[id]?.name || id).join(", ");
      if (targetNames) {
        currentSave = appendCombatLog(currentSave, `Bersagli: ${targetNames}`);
      }
    }

    if (result.success && aoeTargets.length > 0) {
      for (const targetId of aoeTargets) {
        const aoeCheck: CombatAttackCheck = {
          ...attackCheckForRoll,
          defender: { actorRef: { mode: "byId", actorId: targetId } },
        };
        const targetResolutionId = `${attackResolutionId}:aoe:${targetId}`;
        damageResult = applyCombatDamageIfHit(
          aoeCheck,
          result,
          currentSave,
          rng,
          storyPack,
          targetResolutionId,
          catalogs,
          isMagicFueled,
          vengeanceDamageOptions,
        );
        currentSave = damageResult.save;
        if (damageResult.effects && damageResult.effects.length > 0) {
          onDamageEffects.push(...damageResult.effects);
        }

        if (damageResult.actorDied) {
          currentSave = applyGameOverIfNeeded(currentSave, targetId);
        }

        if (currentSave.runtime.gameOver) {
          break;
        }
      }
    }
  } else {
    damageResult = applyCombatDamageIfHit(
      attackCheck,
      result,
      currentSave,
      rng,
      storyPack,
      attackResolutionId,
      catalogs,
      isMagicFueled,
      vengeanceDamageOptions,
    );
    currentSave = damageResult.save;
    if (damageResult.effects && damageResult.effects.length > 0) {
      onDamageEffects.push(...damageResult.effects);
    }
  }

  if (isMagicFueled && result.success && !usesAoE) {
    const totalDoS = result.dos + channelDoS;
    const hits = Math.min(magicFueledRank, Math.max(1, totalDoS));
    if (hits > 1) {
      for (let hitNumber = 2; hitNumber <= hits; hitNumber++) {
        damageResult = applyCombatDamageIfHit(
          attackCheck,
          result,
          currentSave,
          rng,
          storyPack,
          attackResolutionId,
          catalogs,
          true,
          vengeanceDamageOptions,
        );
        currentSave = damageResult.save;
        if (damageResult.actorDied && currentSave.runtime.gameOver) {
          break;
        }
      }
      const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
      const defenderName = defender?.name || effect.defenderId;
      const hitsLogEntry =
        attacker?.kind === "PC"
          ? `Colpisci ${defenderName} ${hits} volte con l'energia magica!`
          : `${attacker?.name || effect.attackerId} colpisce ${defenderName} ${hits} volte con energia magica.`;
      currentSave = appendCombatLog(currentSave, hitsLogEntry);
    }
  }

  if (!usesAoE && damageResult.actorDied) {
    currentSave = applyGameOverIfNeeded(currentSave, effect.defenderId);
  }

  if (!usesAoE) {
    const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
    if (attacker && defender) {
      currentSave = appendAttackNarration(currentSave, attacker, defender, result);
    }
  }

  if (!usesAoE && damageResult.actorDied && currentSave.runtime.combat?.active) {
    currentSave = finalizeCombatEndAfterSingleTargetDeath(currentSave, effect.defenderId);
  }

  if (usesAoE && currentSave.runtime.combat?.active) {
    currentSave = finalizeCombatIfEnded(currentSave);
  }

  const emittedEffects: Effect[] = [];
  if (result.success) {
    if (effect.onSuccessEffects && effect.onSuccessEffects.length > 0) {
      emittedEffects.push(...effect.onSuccessEffects);
    }
    if (onDamageEffects.length > 0) {
      emittedEffects.push(...onDamageEffects);
    }
  } else if (effect.onFailureEffects && effect.onFailureEffects.length > 0) {
    emittedEffects.push(...effect.onFailureEffects);
  }

  return {
    save: currentSave,
    aimConsumed,
    emittedEffects,
    blocked: false,
    skipped: false,
    shouldBreak: Boolean(currentSave.runtime.gameOver),
  };
}
