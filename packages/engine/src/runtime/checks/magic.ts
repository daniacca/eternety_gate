import type { MagicChannelCheck, MagicEffectCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { addPhenomenaTags } from "./evaluation";
import { rollD100CheckWithFate, type FateRerollContext } from "./fate";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";
import { getModifierTotal } from "../characters/modifiers";

export function performMagicChannelCheck(
  check: MagicChannelCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic channel behaves like a normal single check
  // Uses key, respects difficulty and tempModifiers
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "Challenging", save, storyPack);

  // Apply channel bonuses from catalogs/items
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
  const channelBonus = catalogs ? getModifierTotal(save, catalogs, actor.id, "magic.channelBonus") : 0;

  const target = breakdown.target + channelBonus;
  const baseResult = rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);

  if (!baseResult) return null;

  // Magic channel resolution rules with targetDoS
  let result: CheckResult;

  if (!baseResult.success) {
    // Underlying roll failed
    result = {
      ...baseResult,
      success: false,
      dos: 0,
      dof: check.targetDoS,
      tags: [...baseResult.tags, "magic:channel=1", `magic:channelTarget=${check.targetDoS}`, "magic:fail=1"],
    };
  } else {
    // Underlying roll succeeded
    if (baseResult.dos < check.targetDoS) {
      // Insufficient channel power
      result = {
        ...baseResult,
        success: false,
        dos: 0,
        dof: check.targetDoS - baseResult.dos,
        tags: [
          ...baseResult.tags,
          "magic:channel=1",
          `magic:channelTarget=${check.targetDoS}`,
          "magic:channelInsufficient=1",
        ],
      };
    } else {
      // Channel succeeds
      result = {
        ...baseResult,
        success: true,
        dos: baseResult.dos, // Keep the produced DoS, do NOT subtract targetDoS
        dof: 0,
        tags: [...baseResult.tags, "magic:channel=1", `magic:channelTarget=${check.targetDoS}`, "magic:success=1"],
      };
    }
  }

  // Check for doubles and add phenomena tags
  addPhenomenaTags(result, check.powerMode || "CONTROLLED");

  return result;
}

export function performMagicEffectCheck(
  check: MagicEffectCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic effect performs a D100 check using chosenStat
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "Challenging", save, storyPack);

  // Apply cast bonuses from catalogs/items
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
  const castBonus = catalogs ? getModifierTotal(save, catalogs, actor.id, "magic.castBonus") : 0;

  const target = breakdown.target + castBonus;
  const baseResult = rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);

  if (!baseResult) return null;

  // Magic effect resolution rules
  let result: CheckResult;

  if (!baseResult.success) {
    // Check failed
    result = {
      ...baseResult,
      success: false,
      dos: 0,
      dof: check.castingNumberDoS,
      tags: [...baseResult.tags, "magic:fail=1"],
    };
  } else {
    // Check succeeded
    if (baseResult.dos < check.castingNumberDoS) {
      // Insufficient DoS
      result = {
        ...baseResult,
        success: false,
        dos: 0,
        dof: check.castingNumberDoS - baseResult.dos,
        tags: [...baseResult.tags, "magic:insufficient=1"],
      };
    } else {
      // Sufficient DoS - effect succeeds
      const extraDoS = baseResult.dos - check.castingNumberDoS;
      result = {
        ...baseResult,
        success: true,
        dos: extraDoS,
        dof: 0,
        tags: [...baseResult.tags, "magic:success=1", `magic:extraDos=${extraDoS}`],
      };
    }
  }

  // Check for doubles and add phenomena tags
  addPhenomenaTags(result, check.powerMode || "CONTROLLED");

  return result;
}
