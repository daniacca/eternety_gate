import type { CombatAttackCheck, CheckResult, StoryPack, GameSave, StatOrSkillKey } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { type IRNG } from "../../rng";
import { resolveActor } from "../resolve";
import { computeTargetBreakdown } from "../target";
import { rollD100CheckWithFate, type FateRerollContext, createFateRerollContext } from "../fate";
import { hasCondition } from "../../conditions";
import { getStatOrSkillValue } from "../values";
import { getEquippedWeaponId } from "../../characters/inventory";
import { footprintDistanceBetweenActors } from "../../combat/footprint";
import { appendCombatLog, appendRuntimeLog } from "../../combat/narration";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { getEquippedWeapon, hasShieldEquipped } from "../../combat/equipment";
import { hasNaturalWeapons } from "../../characters/naturalWeapons";
import { resolveForceFieldBlock } from "../../combat/forceField";
import { hasWeaponQuality } from "../../weaponQualities";
import { consumeFateProtection } from "../../characters/fate";
import { getShieldMasteryParryBonus } from "../../characters/talentModifiers";
import { getUnnaturalSenseRange, isActorBlind } from "./utils";
import { computeAttackTarget } from "./computeAttackTarget";
import { resolveAttackStatKey } from "./resolveAttackStatKey";

/**
 * Performs a combat attack check and returns the result and the updated game save.
 * @param check - The combat attack check
 * @param storyPack - The story pack
 * @param save - The game save
 * @param rng - The random number generator
 * @param resolutionId - The resolution ID
 * @param fateContext - The fate reroll context
 * @returns The combat attack check result and the updated game save
 */
export function performCombatAttackCheck(
  check: CombatAttackCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  resolutionId?: string,
  fateContext?: FateRerollContext,
): { result: CheckResult; save: GameSave } {
  // Resolve actors
  const attacker = resolveActor(check.attacker.actorRef, save, storyPack);
  const defender = resolveActor(check.defender.actorRef, save, storyPack);
  if (!attacker || !defender) return { result: null, save };

  let updatedSave = save;

  const wordOfGod = defender.conditions?.word_of_god;
  if (wordOfGod?.params?.auraApplied) {
    const wilBonus = typeof wordOfGod.params?.wilBonus === "number" ? wordOfGod.params.wilBonus : 0;
    const overcast = typeof wordOfGod.params?.overcast === "number" ? wordOfGod.params.overcast : 0;
    const penalty = -2 * wilBonus - 2 * overcast;
    const targetValue = getStatOrSkillValue(attacker, "WIL", save, storyPack);
    const preCheckContext = createFateRerollContext();
    const preCheck = rollD100CheckWithFate(
      `combat:wordOfGod:${attacker.id}:${defender.id}`,
      attacker.id,
      targetValue + penalty,
      storyPack,
      save,
      rng,
      preCheckContext,
    );
    if (!preCheck) {
      return { result: null, save: updatedSave };
    }
    if (preCheckContext.used && preCheckContext.actorId) {
      updatedSave = consumeFateProtection(updatedSave, preCheckContext.actorId).save;
    }
    if (!preCheck.success) {
      updatedSave = appendCombatLog(updatedSave, "La Parola di Dio respinge l'attacco.");
      return {
        result: {
          checkId: check.id,
          actorId: attacker.id,
          roll: preCheck.roll,
          target: preCheck.target,
          success: false,
          dos: preCheck.dos,
          dof: preCheck.dof,
          critical: preCheck.critical,
          tags: [...preCheck.tags, "combat:blocked=wordOfGod"],
        },
        save: updatedSave,
      };
    }
  }

  const combatDistance = footprintDistanceBetweenActors(save, attacker.id, defender.id);
  const attackerSenseRange = getUnnaturalSenseRange(attacker);
  const attackerBlindActive =
    isActorBlind(attacker) && (attackerSenseRange <= 0 || combatDistance > attackerSenseRange);
  if (check.attacker.mode === "RANGED" && attackerBlindActive) {
    updatedSave = appendCombatLog(updatedSave, "Sei accecato e non riesci a mirare.");
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=blind"],
      },
      save: updatedSave,
    };
  }

  // Load catalogs for talent modifiers
  const catalogs: CharacterCatalogs | undefined =
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

  // Compute attack target using centralized function
  const {
    target: attackTarget,
    tags: modifierTags,
    modifier: combatModifier,
  } = computeAttackTarget(check, attacker, defender, save, storyPack, catalogs);

  // Determine attack stat for tags (match computeAttackTarget)
  const attackStatKey = resolveAttackStatKey(check, attacker, save);

  const isCloseRangeShot = check.attacker.mode === "RANGED" && check.modifiers?.closeRangeShot === true;

  // Roll attack
  const attackResult = rollD100CheckWithFate(check.id, attacker.id, attackTarget, storyPack, save, rng, fateContext);
  const attackRoll = attackResult?.roll ?? 0;

  if (!attackResult) return { result: null, save };

  // Build attack tags
  const tags = [...attackResult.tags];

  // Add modifier tags from computeAttackTarget
  tags.push(...modifierTags);

  // Tag for All-Out Attack bonus (if hitBonus is present)
  if (check.modifiers?.hitBonus !== undefined && check.modifiers.hitBonus > 0) {
    tags.push("combat:stance=allOut");
  }

  // Get breakdown for base value calculation
  const breakdown = computeTargetBreakdown(attacker, attackStatKey, "Challenging", save, storyPack);
  const defenderStance = save.runtime.combat?.stancesByActorId?.[defender.id];
  if (defenderStance === "defend") {
    tags.push("combat:defenderStance=defend");
  }

  // Add distance and weapon range tags for ranged attacks
  if (check.attacker.mode === "RANGED") {
    const combat = save.runtime.combat;
    if (combat?.active) {
      // Use footprint-to-footprint distance for ranged attacks
      const dist = footprintDistanceBetweenActors(save, attacker.id, defender.id);
      tags.push(`combat:distance=${dist}`);

      // Add weapon range if available
      const weaponId =
        check.attacker.weaponId ??
        (attacker.equipment?.mainHand?.kind === "weapon" ? attacker.equipment.mainHand.id : null);
      if (weaponId && weaponId !== "unarmed" && save.weaponsById?.[weaponId]?.range !== undefined) {
        const weaponRange = save.weaponsById[weaponId].range!;
        tags.push(`combat:weaponRange=${weaponRange}`);
      }
    }
  }

  tags.push(`combat:attackStat=${attackStatKey}`);
  tags.push(`combat:attackTarget=${attackTarget}`);
  tags.push(`combat:attackRoll=${attackRoll}`);
  if (attackResult?.tags?.some((tag) => tag.startsWith("fate:"))) {
    tags.push(...attackResult.tags.filter((tag) => tag.startsWith("fate:")));
  }
  tags.push(`combat:attackDoS=${attackResult.dos}`);
  tags.push(`combat:attackDoF=${attackResult.dof}`);
  tags.push(`combat:calc:base=${breakdown.baseValue}`);
  tags.push(`combat:calc:mods=${combatModifier}`);
  tags.push(`combat:calc:target=${attackTarget}`);
  tags.push(`combat:defenderId=${defender.id}`);

  // If attack failed, return MISS (with correct DoF)
  if (!attackResult.success) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: attackResult.dof,
        critical: attackResult.critical,
        tags,
      },
      save,
    };
  }

  // Attack succeeded - determine defense
  // Check if defender can parry (based on parryDisabledUntilTurnCounterByActorId)
  const combat = save.runtime.combat;
  const turnCounter = combat?.turnCounter ?? 0;

  // Force Field: block attack before any evasion roll
  const forceFieldResult = resolveForceFieldBlock(save, defender, rng, turnCounter, catalogs);
  if (forceFieldResult.blocked) {
    const defenderName = defender.name || defender.id;
    const overloadText = forceFieldResult.overloaded
      ? ` Un lampo accecante esplode, scariche eldritiche avvolgono l'aria e il bagliore si spegne per ${
          forceFieldResult.overloadDuration ?? 0
        } turni.`
      : "";
    const fatigueText = forceFieldResult.fatigue ? ` (${forceFieldResult.fatigue} Fatigue)` : "";
    const blockLog = `${defenderName}: il Campo di Forza si illumina e annulla l'attacco.${overloadText}${fatigueText}`;
    let updatedSaveForLog = forceFieldResult.save;
    updatedSaveForLog = appendCombatLog(updatedSaveForLog, blockLog);
    const forceFieldTags = [
      "combat:blocked=forceField",
      ...(forceFieldResult.roll !== undefined ? [`combat:forceField:roll=${forceFieldResult.roll}`] : []),
      ...(forceFieldResult.protection !== undefined
        ? [`combat:forceField:protection=${forceFieldResult.protection}`]
        : []),
      ...(forceFieldResult.overload !== undefined ? [`combat:forceField:overload=${forceFieldResult.overload}`] : []),
      ...(forceFieldResult.overloaded ? ["combat:forceField:overloaded=1"] : []),
      ...(forceFieldResult.overloadDuration !== undefined
        ? [`combat:forceField:down=${forceFieldResult.overloadDuration}`]
        : []),
      ...(forceFieldResult.fatigue !== undefined ? [`combat:forceField:fatigue=${forceFieldResult.fatigue}`] : []),
    ];
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: 0,
        critical: attackResult.critical,
        tags: [...tags, ...forceFieldTags],
      },
      save: updatedSaveForLog,
    };
  }

  const disabledUntil = combat?.parryDisabledUntilTurnCounterByActorId?.[defender.id] ?? -1;
  const defenderWeapon = getEquippedWeapon(save, defender.id);
  const parryWeapon = defenderWeapon?.kind === "MELEE" ? defenderWeapon : null;
  const hasMeleeWeapon = defenderWeapon?.kind === "MELEE";
  const hasShield = hasShieldEquipped(save, defender.id);
  const attackerWeaponId = check.attacker.weaponId ?? getEquippedWeaponId(attacker);
  const attackerWeapon =
    attackerWeaponId && attackerWeaponId !== "unarmed" ? save.weaponsById?.[attackerWeaponId] : null;
  const attackHasFlexible = hasWeaponQuality(attackerWeapon, "flexible");
  const parryWeaponUnwieldy = hasWeaponQuality(parryWeapon, "unwieldy");
  const parryBlockedByUnwieldy = parryWeaponUnwieldy && !hasShield;
  const defenderHasFrenzy = hasCondition(defender, "frenzy");
  const canParry =
    turnCounter >= disabledUntil &&
    check.defense.allowParry &&
    check.attacker.mode === "MELEE" &&
    (hasMeleeWeapon || hasShield) &&
    !attackHasFlexible &&
    !parryBlockedByUnwieldy &&
    !defenderHasFrenzy;
  const canDodge = check.defense.allowDodge;

  // Use skill keys for defense
  const parrySkillKey: StatOrSkillKey = "SKILL:skill:parry";
  const dodgeSkillKey: StatOrSkillKey = "SKILL:skill:dodge";

  let defenseType: "parry" | "dodge" | "none" = "none";
  let defenseSkillKey: StatOrSkillKey | null = null;

  // Get Shield Mastery parry bonus (if defender has talent and shield equipped)
  const shieldMasteryBonus = catalogs ? getShieldMasteryParryBonus(save, catalogs, defender.id) : 0;

  if (check.defense.strategy === "preferParry" && canParry) {
    defenseType = "parry";
    defenseSkillKey = parrySkillKey;
  } else if (check.defense.strategy === "preferDodge" && canDodge) {
    defenseType = "dodge";
    defenseSkillKey = dodgeSkillKey;
  } else if (check.defense.strategy === "autoBest") {
    // Calculate both defense targets and choose the best one
    let parryTarget = -Infinity;
    let dodgeTarget = -Infinity;

    if (canParry) {
      const parryBreakdown = computeTargetBreakdown(defender, parrySkillKey, "Challenging", save, storyPack);
      parryTarget = parryBreakdown.target + shieldMasteryBonus;
    }

    if (canDodge) {
      const dodgeDifficulty =
        check.attacker.mode === "RANGED" && !isCloseRangeShot
          ? check.modifiers?.rangeBand === "POINT_BLANK"
            ? "Very Hard"
            : check.modifiers?.rangeBand === "SHORT"
              ? "Hard"
              : check.modifiers?.rangeBand === "NORMAL"
                ? "Difficult"
                : "Challenging"
          : "Challenging";
      const dodgeBreakdown = computeTargetBreakdown(defender, dodgeSkillKey, dodgeDifficulty, save, storyPack);
      dodgeTarget = dodgeBreakdown.target;
    }

    // Choose the defense with the highest target (best chance to succeed)
    if (canParry && canDodge) {
      if (parryTarget >= dodgeTarget) {
        defenseType = "parry";
        defenseSkillKey = parrySkillKey;
      } else {
        defenseType = "dodge";
        defenseSkillKey = dodgeSkillKey;
      }
    } else if (canParry) {
      defenseType = "parry";
      defenseSkillKey = parrySkillKey;
    } else if (canDodge) {
      defenseType = "dodge";
      defenseSkillKey = dodgeSkillKey;
    }
  }

  // Fallback: if preferred defense isn't available, use the other if allowed.
  if (defenseType === "none") {
    if (canDodge) {
      defenseType = "dodge";
      defenseSkillKey = dodgeSkillKey;
    } else if (canParry) {
      defenseType = "parry";
      defenseSkillKey = parrySkillKey;
    }
  }

  tags.push(`combat:defense=${defenseType}`);
  if (!canParry && check.defense.allowParry) {
    tags.push("combat:defense:parryBlocked=1");
  }
  if (attackHasFlexible) {
    tags.push("combat:defense:parryBlocked=flexible");
  }
  if (parryBlockedByUnwieldy) {
    tags.push("combat:defense:parryBlocked=unwieldy");
  }

  // updatedSave will be updated if defense check is logged

  // If no defense, HIT
  if (defenseType === "none" || !defenseSkillKey) {
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Roll defense using the chosen skill
  const dodgeDifficulty =
    defenseType === "dodge" && check.attacker.mode === "RANGED" && !isCloseRangeShot
      ? check.modifiers?.rangeBand === "POINT_BLANK"
        ? "Very Hard"
        : check.modifiers?.rangeBand === "SHORT"
          ? "Hard"
          : check.modifiers?.rangeBand === "NORMAL"
            ? "Difficult"
            : "Challenging"
      : "Challenging";
  const defenseBreakdown = computeTargetBreakdown(defender, defenseSkillKey, dodgeDifficulty, save, storyPack);
  // Add parry bonuses to parry target only
  const parryQualityBonus =
    defenseType === "parry"
      ? (hasWeaponQuality(parryWeapon, "balanced") ? 10 : 0) + (hasWeaponQuality(parryWeapon, "unbalanced") ? -10 : 0)
      : 0;
  const parryBonus = defenseType === "parry" ? shieldMasteryBonus + parryQualityBonus : 0;
  const attackerInvisibilityBonus =
    typeof attacker.conditions?.invisibility?.params?.wilBonus === "number"
      ? attacker.conditions?.invisibility?.params?.wilBonus
      : 0;
  const defenderSenseRange = getUnnaturalSenseRange(defender);
  const defenderBlindActive =
    isActorBlind(defender) && (defenderSenseRange <= 0 || combatDistance > defenderSenseRange);
  const defenseInvisPenalty =
    attackerInvisibilityBonus > 0 && (defenderSenseRange <= 0 || combatDistance > defenderSenseRange)
      ? -5 * attackerInvisibilityBonus
      : 0;
  const defenseBlindPenalty = defenderBlindActive ? -30 : 0;
  const defenseTarget = defenseBreakdown.target + parryBonus + defenseInvisPenalty + defenseBlindPenalty;

  const defenseFateContext = createFateRerollContext();
  const defenseResult = rollD100CheckWithFate(
    check.id,
    defender.id,
    defenseTarget,
    storyPack,
    save,
    rng,
    defenseFateContext,
  );
  const defenseRoll = defenseResult?.roll ?? 0;

  // Log defense check if defender belongs to party
  if (defenseResult) {
    const partyIds = new Set(save.party?.actors ?? []);
    const isDefenderPartyMember = partyIds.has(defender.id) || defender.kind === "PC";

    if (isDefenderPartyMember) {
      const defenseCheckResult: CheckResult = {
        checkId: `${check.id}:defense:${defenseType}`,
        actorId: defender.id,
        roll: defenseRoll,
        target: defenseTarget,
        success: defenseResult.success,
        dos: defenseResult.dos,
        dof: defenseResult.dof,
        critical: defenseResult.critical,
        tags: [
          `combat:defenseType=${defenseType}`,
          `combat:defenseSkill=${defenseSkillKey}`,
          `combat:defTarget=${defenseTarget}`,
          `combat:defRoll=${defenseRoll}`,
          `combat:defDoS=${defenseResult.dos}`,
          `combat:defDoF=${defenseResult.dof}`,
          `combat:defCalc:base=${defenseBreakdown.baseValue}`,
          `combat:defCalc:mods=${defenseBreakdown.tempModsSum}`,
          `combat:defCalc:target=${defenseTarget}`,
          ...(shieldMasteryBonus > 0 ? [`combat:defCalc:shieldMastery=+${shieldMasteryBonus}`] : []),
          ...(parryQualityBonus !== 0 ? [`combat:defCalc:weaponQuality=${parryQualityBonus}`] : []),
          ...(defenseInvisPenalty !== 0 ? [`combat:defCalc:invisibleAttacker=${defenseInvisPenalty}`] : []),
          ...(defenseBlindPenalty !== 0 ? [`combat:defCalc:blind=${defenseBlindPenalty}`] : []),
          ...defenseResult.tags.filter((tag) => tag.startsWith("fate:")),
        ],
      };
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "check",
        check: defenseCheckResult,
        resolutionId,
      });
    }
  }

  if (defenseFateContext.used && defenseFateContext.actorId) {
    updatedSave = consumeFateProtection(updatedSave, defenseFateContext.actorId).save;
  }

  if (!defenseResult) {
    // Defense roll failed somehow, treat as no defense
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Add defense tags
  tags.push(`combat:defTarget=${defenseTarget}`);
  tags.push(`combat:defRoll=${defenseRoll}`);
  tags.push(`combat:defDoS=${defenseResult.dos}`);
  tags.push(`combat:defSuccess=${defenseResult.success ? 1 : 0}`);
  tags.push(`combat:defCalc:base=${defenseBreakdown.baseValue}`);
  tags.push(`combat:defCalc:mods=${defenseBreakdown.tempModsSum}`);
  tags.push(`combat:defCalc:target=${defenseTarget}`);

  // Determine outcome
  if (!defenseResult.success) {
    // Defense failed - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }

  // Both attack and defense succeeded - compare DoS
  if (attackResult.dos > defenseResult.dos) {
    // Attacker wins - HIT
    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: true,
        dos: attackResult.dos - defenseResult.dos,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  } else {
    // Tie or defender wins - MISS
    const isTie = attackResult.dos === defenseResult.dos;
    if (isTie) {
      tags.push("combat:tie=1");
    }

    // Magic Field / Force: parry may destroy attacking weapon
    if (defenseType === "parry" && defenseResult.success) {
      const parryHasMagicField = hasWeaponQuality(parryWeapon, "magic_field") || hasWeaponQuality(parryWeapon, "force");
      if (parryHasMagicField) {
        const attackerHasNaturalWeapons = hasNaturalWeapons(save, catalogs, attacker.id);
        const attackerWeaponIdForDestruction = attackerWeaponId ?? getEquippedWeaponId(attacker);
        const attackerWeaponForDestruction =
          attackerWeaponIdForDestruction && attackerWeaponIdForDestruction !== "unarmed"
            ? save.weaponsById?.[attackerWeaponIdForDestruction]
            : null;
        const attackerHasMagicField =
          hasWeaponQuality(attackerWeaponForDestruction, "magic_field") ||
          hasWeaponQuality(attackerWeaponForDestruction, "force");

        if (!attackerHasNaturalWeapons && !attackerHasMagicField && attackerWeaponForDestruction) {
          const destructionRoll = rng.rollD100();
          const shouldDestroy = destructionRoll <= 50;

          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: shouldDestroy
              ? `Magic Field: ${attacker.id} weapon destroyed (roll ${destructionRoll})`
              : `Magic Field: ${attacker.id} weapon survives (roll ${destructionRoll})`,
            turnCounter: save.runtime.combat?.turnCounter ?? 0,
            resolutionId,
            tags: [
              "weapon:magicField",
              `roll=${destructionRoll}`,
              `destroyed=${shouldDestroy ? 1 : 0}`,
              `weaponId=${attackerWeaponIdForDestruction}`,
            ],
          });

          if (shouldDestroy) {
            const attackerToUpdate = updatedSave.actorsById[attacker.id];
            if (attackerToUpdate?.equipment) {
              const updatedEquipment = { ...attackerToUpdate.equipment };
              if (
                updatedEquipment.mainHand?.kind === "weapon" &&
                updatedEquipment.mainHand.id === attackerWeaponIdForDestruction
              ) {
                updatedEquipment.mainHand = null;
              }
              if (
                updatedEquipment.offHand?.kind === "weapon" &&
                updatedEquipment.offHand.id === attackerWeaponIdForDestruction
              ) {
                updatedEquipment.offHand = null;
              }
              updatedSave = {
                ...updatedSave,
                actorsById: {
                  ...updatedSave.actorsById,
                  [attacker.id]: {
                    ...attackerToUpdate,
                    equipment: updatedEquipment,
                  },
                },
              };
            }
          }
        }
      }
    }

    return {
      result: {
        checkId: check.id,
        actorId: attacker.id,
        roll: attackRoll,
        target: attackTarget,
        success: false,
        dos: 0,
        dof: 0,
        critical: attackResult.critical,
        tags,
      },
      save: updatedSave,
    };
  }
}
