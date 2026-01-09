import type { Effect, GameSave, StoryPack, SingleCheck, ActorId, CheckResult } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { getCharacteristicBonus } from "../../characters/bonuses";
import { getSpellById, getEffectById } from "../../magic/catalogs";
import { getMagicPower } from "../../magic/pm";
import { applyFatigue } from "../../magic/fatigue";
import { shouldTriggerPhenomena, getPhenomenaSeverity, rollPhenomena } from "../../magic/phenomena";
import { hasLearnedSpell } from "../../magic/learning";
import { addConditionToActor } from "../../conditions";
import { applyDamageToActor } from "../criticalDamage";
import { calculateMaxHp } from "../../characters/hp";
import { hasUnlockedAction } from "../../characters/actions";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";

/**
 * Cast Spell action: performs spell casting check and applies effects
 */
export function combatCastSpell(
  effect: Extract<Effect, { op: "combatCastSpell" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    // Not caster's turn
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: effect.actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
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

  // Load spell and effect definitions
  const spell = getSpellById(effect.spellId);
  if (!spell) {
    return { save };
  }

  const effectDef = getEffectById(spell.effectId);
  if (!effectDef) {
    return { save };
  }

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }

  // Load catalogs early for checks
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

  // Check if actor has magic gate trait (unlocks magic actions)
  // Note: Check for "magic:cast" action unlock (trait:weaver grants this)
  if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "magic:cast")) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=noMagicGate"],
    };
    let updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: "Non puoi lanciare incantesimi: ti manca il tratto magico necessario.",
      turnCounter: combat.turnCounter,
    });
    return { save: updatedSave };
  }

  // Check if spell is learned
  if (!hasLearnedSpell(actor, effect.spellId)) {
    const blockedCheck: CheckResult = {
      checkId: "combat:castSpell:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=spellNotLearned"],
    };
    let updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        lastCheck: blockedCheck,
      },
    };
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Non conosci l'incantesimo: ${spell.name}`,
      turnCounter: combat.turnCounter,
    });
    // DO NOT consume action or reset channeling on failure
    return { save: updatedSave };
  }

  // Check action economy
  if (spell.castTime === "free") {
    // Free spell: check if already used this turn
    const freeSpellUsed = combat.freeSpellUsedThisTurn?.[turnActorId] ?? false;
    if (freeSpellUsed) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=freeSpellUsed"],
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
  } else {
    // Standard or Full Round: check action availability
    if (!combat.turn.actionAvailable) {
      const blockedCheck: CheckResult = {
        checkId: "combat:castSpell:blocked",
        actorId: turnActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
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
  }

  // Check channeling bonus
  // Channeling bonus applies if channeling was done on current turn or previous turn
  const channeling = combat.channeling;
  const currentTurnCounter = combat.turnCounter ?? 0;
  const channelBonus =
    channeling?.actorId === turnActorId &&
    (channeling.lastChannelTurnCounter === currentTurnCounter ||
      channeling.lastChannelTurnCounter === currentTurnCounter - 1)
      ? channeling.accumulatedDoS
      : 0;

  // Check for casting penalty from phenomena and remove it after applying
  const castingPenaltyModifier = actor.status.tempModifiers?.find(
    (mod) => mod.id === `phenomena:castingPenalty:${turnActorId}`
  );
  const hasCastingPenalty = !!castingPenaltyModifier;

  // Create casting check
  const castingCheck: SingleCheck = {
    id: `combat:cast:${spell.id}:${turnActorId}`,
    kind: "single",
    actorRef: { mode: "byId", actorId: turnActorId },
    key: effectDef.castingStat,
    difficulty: "NORMAL",
  };

  // Generate resolutionId
  const { save: saveWithSeq, seq } = nextRuntimeSeq(save);
  const resolutionId = `res:${seq}`;

  // Perform casting check (penalty will be applied via tempModifier system)
  const { result, save: afterCheckSave } = performCheckWithSave(
    castingCheck,
    storyPack,
    saveWithSeq,
    rng,
    resolutionId
  );

  // Remove casting penalty modifier AFTER check (it was consumed)
  let saveAfterPenaltyRemoval = afterCheckSave;
  if (hasCastingPenalty && afterCheckSave.actorsById[turnActorId]) {
    const actorAfterCheck = afterCheckSave.actorsById[turnActorId];
    const updatedActorAfterPenalty = {
      ...actorAfterCheck,
      status: {
        ...actorAfterCheck.status,
        tempModifiers: (actorAfterCheck.status.tempModifiers || []).filter(
          (mod) => mod.id !== `phenomena:castingPenalty:${turnActorId}`
        ),
      },
    };
    saveAfterPenaltyRemoval = {
      ...afterCheckSave,
      actorsById: {
        ...afterCheckSave.actorsById,
        [turnActorId]: updatedActorAfterPenalty,
      },
    };
  }

  if (!result) {
    return { save: saveAfterPenaltyRemoval };
  }

  // Calculate effective DoS (check DoS + channel bonus)
  const effectiveDoS = result.dos + channelBonus;
  const requiredCN = spell.baseCN;
  const powerIntensity = spell.baseCN; // MVP: PI = baseCN (no extra CN chosen)
  const success = effectiveDoS >= requiredCN;

  // Calculate PM
  const pm = getMagicPower(save, turnActorId, catalogs);

  // Check for phenomena trigger
  const phenomenaTriggered = shouldTriggerPhenomena(result);
  const phenomenaSeverity = phenomenaTriggered ? getPhenomenaSeverity(powerIntensity, pm) : null;
  let rfToApply = 0;

  // Apply RF based on success/failure
  if (success) {
    // Success: apply RF
    if (powerIntensity > pm) {
      rfToApply += 1;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
    if (effectDef.specialFatigue) {
      rfToApply += effectDef.specialFatigue;
    }
    // Healing spells: +1 RF total
    if (spell.discipline === "CORPUS" && effectDef.baseDamageDice) {
      rfToApply += 1;
    }
  } else {
    // Failure: apply RF
    if (powerIntensity > pm) {
      rfToApply += 1;
    }
    if (result.dof >= 2) {
      // Severe failure
      rfToApply += 2;
    }
    if (phenomenaTriggered) {
      rfToApply += 1;
    }
  }

  // Apply RF
  if (rfToApply > 0) {
    updatedSave = applyFatigue(updatedSave, turnActorId, rfToApply, catalogs);
  }

  // Resolve phenomena if triggered
  if (phenomenaTriggered) {
    const phenomenaResult = rollPhenomena(updatedSave, turnActorId, rng, catalogs);
    updatedSave = phenomenaResult.save;
    const phenomenaDesc = phenomenaResult.description;

    // Log phenomena
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Fenomeno magico: ${phenomenaDesc}`,
      turnCounter: combat.turnCounter,
      resolutionId,
    });

    const actorName = actor.name || turnActorId;
    const logEntry =
      actor.kind === "PC"
        ? `Fenomeno magico: ${phenomenaDesc}`
        : `${actorName} subisce un fenomeno magico: ${phenomenaDesc}`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  }

  // Apply spell effects if successful
  if (success) {
    // Determine target(s)
    const targetSpec = effect.targetSpec;
    let targets: Array<{ actorId: ActorId; actor: typeof actor }> = [];

    if (spell.targetShape === "self") {
      targets = [{ actorId: turnActorId, actor }];
    } else if (targetSpec.type === "actor" && targetSpec.actorId) {
      const targetActor = updatedSave.actorsById[targetSpec.actorId];
      if (targetActor) {
        targets = [{ actorId: targetSpec.actorId, actor: targetActor }];
      }
    }
    // MVP: line/cone/radius targeting not fully implemented - just use single target

    // Apply damage if effect has damage
    if (effectDef.baseDamageDice && targets.length > 0) {
      const dice = effectDef.baseDamageDice.dice;
      const sides = effectDef.baseDamageDice.sides;
      const flat = effectDef.baseDamageFlat ?? 0;

      // Roll damage dice
      let damageRolls: number[] = [];
      let totalDamage = flat;
      for (let i = 0; i < dice; i++) {
        const roll = rng.nextInt(1, sides);
        damageRolls.push(roll);
        totalDamage += roll;
      }

      // Damage scaling: +2 flat damage per CN above baseCN
      const extraCN = Math.max(0, effectiveDoS - requiredCN);
      const scaledDamage = totalDamage + extraCN * 2;

      // Apply damage to each target
      for (const target of targets) {
        if (spell.discipline === "CORPUS" && effectDef.baseDamageDice) {
          // Healing: reduce wounds instead of applying damage
          const maxHp = catalogs ? calculateMaxHp(updatedSave, target.actor, catalogs) : target.actor.derived?.hpMax ?? 100;
          const woundsBefore = target.actor.resources.wounds ?? 0;
          const woundsAfter = Math.max(0, woundsBefore - scaledDamage);
          const healed = woundsBefore - woundsAfter;

          const updatedTargetActor = {
            ...target.actor,
            resources: {
              ...target.actor.resources,
              wounds: woundsAfter,
            },
          };

          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: updatedTargetActor,
            },
          };

          // Log healing
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "damage",
            attackerId: turnActorId,
            defenderId: target.actorId,
            formula: `${dice}d${sides}${flat > 0 ? ` + ${flat}` : ""}${extraCN > 0 ? ` + ${extraCN * 2} (CN bonus)` : ""}`,
            rolls: damageRolls,
            rawDamage: scaledDamage,
            soak: 0,
            finalDamage: -healed, // Negative for healing
            turnCounter: combat.turnCounter,
            resolutionId,
          });

          const targetName = target.actor.name || target.actorId;
          const healLog =
            actor.kind === "PC"
              ? `Ripristini ${healed} HP a ${targetName}.`
              : `${actor.name || turnActorId} ripristina ${healed} HP a ${targetName}.`;
          updatedSave = appendCombatLog(updatedSave, healLog);
        } else {
          // Damage: apply true damage (bypasses armor for MVP)
          const damageResult = applyDamageToActor(target.actor, scaledDamage, updatedSave, rng, storyPack, catalogs);
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: damageResult.updatedActor,
            },
          };

          // Log damage
          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "damage",
            attackerId: turnActorId,
            defenderId: target.actorId,
            formula: `${dice}d${sides}${flat > 0 ? ` + ${flat}` : ""}${extraCN > 0 ? ` + ${extraCN * 2} (CN bonus)` : ""}`,
            rolls: damageRolls,
            rawDamage: scaledDamage,
            soak: 0,
            finalDamage: scaledDamage,
            turnCounter: combat.turnCounter,
            resolutionId,
          });

          const targetName = target.actor.name || target.actorId;
          const damageLog =
            actor.kind === "PC"
              ? `Infliggi ${scaledDamage} danni a ${targetName}.`
              : `${actor.name || turnActorId} infligge ${scaledDamage} danni a ${targetName}.`;
          updatedSave = appendCombatLog(updatedSave, damageLog);
        }
      }
    }

    // Apply conditions if effect has conditions
    if (effectDef.applyConditions && targets.length > 0) {
      for (const conditionSpec of effectDef.applyConditions) {
        for (const target of targets) {
          const durationRounds = conditionSpec.durationRounds ?? 1;
          const untilTurnCounter = combat.turnCounter + durationRounds;
          const stacks = conditionSpec.value ?? 1;

          const updatedTargetActor = addConditionToActor(
            target.actor,
            conditionSpec.conditionId as any,
            stacks,
            untilTurnCounter,
            `spell:${spell.id}`
          );

          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: updatedTargetActor,
            },
          };
        }
      }
    }
  }

  // Update combat state: consume action/movement
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: spell.castTime === "free" ? combat.turn.actionAvailable : false,
      moveRemaining: spell.castTime === "fullRound" ? 0 : combat.turn.moveRemaining,
    },
    freeSpellUsedThisTurn: {
      ...(combat.freeSpellUsedThisTurn || {}),
      ...(spell.castTime === "free" ? { [turnActorId]: true } : {}),
    },
    channeling: undefined, // Consume channeling after cast
  };

  updatedSave = {
    ...updatedSave,
    runtime: {
      ...updatedSave.runtime,
      combat: updatedCombat,
      lastCheck: result,
    },
  };

  // Add narration
  const actorName = actor.name || turnActorId;
  const spellName = spell.name;
  if (success) {
    const logEntry =
      actor.kind === "PC"
        ? `Lanci ${spellName}.`
        : `${actorName} lancia ${spellName}.`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  } else {
    const logEntry =
      actor.kind === "PC"
        ? `Tentativo di lanciare ${spellName} fallito.`
        : `${actorName} fallisce il tentativo di lanciare ${spellName}.`;
    updatedSave = appendCombatLog(updatedSave, logEntry);
  }

  return { save: updatedSave };
}

