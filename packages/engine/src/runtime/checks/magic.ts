import type { MagicChannelCheck, MagicEffectCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { rollD100Check, addPhenomenaTags } from "./evaluation";

function getEquippedItems(actor: any): string[] {
  const items: string[] = [];
  if (actor.equipment?.mainHand) {
    items.push(actor.equipment.mainHand.id);
  }
  if (actor.equipment?.offHand) {
    items.push(actor.equipment.offHand.id);
  }
  if (actor.equipment?.armor) {
    items.push(actor.equipment.armor.id);
  }
  return items;
}

export function performMagicChannelCheck(
  check: MagicChannelCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic channel behaves like a normal single check
  // Uses key, respects difficulty and tempModifiers
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "NORMAL", save, storyPack);

  // Apply focus bonuses for channeling
  let channelBonus = 0;
  const items = getEquippedItems(actor);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;

    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.channelBonus) {
        channelBonus += mod.channelBonus;
      }
    }
  }

  const target = breakdown.target + channelBonus;
  const baseResult = rollD100Check(check.id, actor.id, target, storyPack, rng);

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
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  // Magic effect performs a D100 check using chosenStat
  const breakdown = computeTargetBreakdown(actor, check.key, check.difficulty || "NORMAL", save, storyPack);

  // Apply focus bonuses for casting
  let castBonus = 0;
  const items = getEquippedItems(actor);

  for (const itemId of items) {
    const item = save.itemCatalogById[itemId];
    if (!item) continue;

    for (const mod of item.mods) {
      if (mod.type === "focus" && mod.castBonus) {
        castBonus += mod.castBonus;
      }
    }
  }

  const target = breakdown.target + castBonus;
  const baseResult = rollD100Check(check.id, actor.id, target, storyPack, rng);

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

