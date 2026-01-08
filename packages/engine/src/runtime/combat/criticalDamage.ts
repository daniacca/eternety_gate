import type {
  GameSave,
  Actor,
  Effect,
  SingleCheck,
  StoryPack,
  StatKey,
} from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import type { IRNG } from "../rng";
import { performCheck } from "../checks";
import { calculateMaxHp } from "../characters/hp";

/**
 * Applies critical damage tier effects and determines if actor dies.
 * This is the single source of truth for critical damage tier application.
 * 
 * @param actor - The actor taking critical damage
 * @param criticalDamage - The total critical damage amount
 * @param criticalTierApplied - The highest tier already applied
 * @param save - The game save
 * @param rng - Random number generator
 * @param storyPack - Optional story pack (required for toughness checks)
 * @param catalogs - Optional catalogs (for maxHp calculation)
 * @returns Object with emitted effects and whether actor died
 */
export function applyCriticalDamageTiers(
  actor: Actor,
  criticalDamage: number,
  criticalTierApplied: number,
  save: GameSave,
  rng: IRNG,
  storyPack?: StoryPack,
  catalogs?: CharacterCatalogs
): {
  emittedEffects: Effect[];
  actorDied: boolean;
  newTierApplied: number;
} {
  const emittedEffects: Effect[] = [];
  let actorDied = false;

  // Check if actor already has critical damage >= 10 and should be dead
  if (criticalDamage >= 10 && !actor.resources.isDead) {
    actorDied = true;
  }

  const newTier = Math.min(10, Math.floor(criticalDamage));

  // Apply effects only for tiers (criticalTierApplied+1 .. newTier), in order
  // Note: newTier is capped at 10 for effect application, but we check criticalDamage >= 10 for death
  for (let tier = criticalTierApplied + 1; tier <= newTier; tier++) {
    if (tier === 1) {
      // Tier 1: +1 fatigue stack
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "fatigue",
        stacks: 1,
        source: "criticalDamage",
      });
    } else if (tier === 2) {
      // Tier 2: +1d5 fatigue stacks, and a normal Toughness test; fail => stunned for (1d10 + DoF) rounds
      const fatigueRoll = rng.nextInt(1, 5);
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "fatigue",
        stacks: fatigueRoll,
        source: "criticalDamage",
      });
      // Toughness test handled below after damage application
    } else if (tier === 3) {
      // Tier 3: bleeding (stacks 1) + reduce random physical stat by 1d5
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "bleeding",
        stacks: 1,
        source: "criticalDamage",
      });
      // Stat reduction handled separately (future)
    } else if (tier === 4) {
      // Tier 4: reduce random physical stat by 1d10; hard Toughness test fail => prone
      // Stat reduction handled separately (future)
    } else if (tier === 5) {
      // Tier 5: prone and movement halved until medical care
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "prone",
        source: "criticalDamage",
      });
    } else if (tier === 6) {
      // Tier 6: prone + stunned 1d5 rounds + bleeding
      const stunnedRounds = rng.nextInt(1, 5);
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "stunned",
        durationTurns: stunnedRounds,
        source: "criticalDamage",
      });
      emittedEffects.push({
        op: "addCondition",
        actorId: actor.id,
        condition: "bleeding",
        stacks: 1,
        source: "criticalDamage",
      });
    } else if (tier === 7) {
      // Tier 7: normal Toughness test; fail => die
      const saveKey: StatKey = actor.stats.TOU != null ? "TOU" : "WIL";
      const toughnessCheck: SingleCheck = {
        id: `combat:criticalDamage:tier7:${actor.id}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: actor.id },
        key: saveKey,
        difficulty: "NORMAL",
      };
      const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
      if (!toughnessResult || !toughnessResult.success) {
        actorDied = true;
      }
    } else if (tier === 8) {
      // Tier 8: hard Toughness test; fail => die
      const saveKey: StatKey = actor.stats.TOU != null ? "TOU" : "WIL";
      const toughnessCheck: SingleCheck = {
        id: `combat:criticalDamage:tier8:${actor.id}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: actor.id },
        key: saveKey,
        difficulty: "HARD",
      };
      const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
      if (!toughnessResult || !toughnessResult.success) {
        actorDied = true;
      }
    } else if (tier === 9) {
      // Tier 9: very hard Toughness test; fail => die
      const saveKey: StatKey = actor.stats.TOU != null ? "TOU" : "WIL";
      const toughnessCheck: SingleCheck = {
        id: `combat:criticalDamage:tier9:${actor.id}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: actor.id },
        key: saveKey,
        difficulty: "VERY_HARD",
      };
      const toughnessResult = storyPack ? performCheck(toughnessCheck, storyPack, save, rng) : null;
      if (!toughnessResult || !toughnessResult.success) {
        actorDied = true;
      }
    } else if (tier === 10) {
      // Tier 10: die immediately
      actorDied = true;
    }
  }

  // Check if critical damage reached 10+ (even if we didn't process tier 10 in the loop)
  // This handles cases where criticalDamage is 11+ but criticalTierApplied was already 10
  if (criticalDamage >= 10 && !actorDied) {
    actorDied = true;
  }

  return {
    emittedEffects,
    actorDied,
    newTierApplied: newTier,
  };
}

/**
 * Applies damage to an actor, handling wounds and critical damage track.
 * This is the single source of truth for damage application logic.
 * 
 * @param actor - The actor taking damage
 * @param damage - The amount of damage to apply
 * @param save - The game save
 * @param rng - Random number generator
 * @param storyPack - Optional story pack (required for toughness checks)
 * @param catalogs - Optional catalogs (for maxHp calculation)
 * @returns Updated actor and effects
 */
export function applyDamageToActor(
  actor: Actor,
  damage: number,
  save: GameSave,
  rng: IRNG,
  storyPack?: StoryPack,
  catalogs?: CharacterCatalogs
): {
  updatedActor: Actor;
  effects: Effect[];
  actorDied: boolean;
} {
  if (damage <= 0 || actor.resources.isDead) {
    return {
      updatedActor: actor,
      effects: [],
      actorDied: actor.resources.isDead ?? false,
    };
  }

  // Calculate max HP
  const maxHp = catalogs ? calculateMaxHp(save, actor, catalogs) : actor.derived?.hpMax ?? 100;
  const woundsBefore = actor.resources.wounds ?? 0;
  const hpBefore = maxHp - woundsBefore;

  // Normalize wounds if they exceed maxHp (shouldn't happen, but handle it)
  const normalizedWoundsBefore = Math.min(maxHp, woundsBefore);
  const normalizedHpBefore = maxHp - normalizedWoundsBefore;

  let criticalDamage = actor.resources.criticalDamage ?? 0;
  let criticalTierApplied = actor.resources.criticalTierApplied ?? 0;
  let woundsAfter: number;
  let hpAfter: number;
  let effects: Effect[] = [];
  let actorDied = false;

  if (normalizedHpBefore <= 0 && damage > 0) {
    // Already at 0 HP - damage goes to critical damage track
    criticalDamage += damage;
    woundsAfter = maxHp; // Keep wounds at maxHp (HP = 0)
    hpAfter = 0;

    // Apply critical damage tier effects
    const tierResult = applyCriticalDamageTiers(
      actor,
      criticalDamage,
      criticalTierApplied,
      save,
      rng,
      storyPack,
      catalogs
    );
    effects = tierResult.emittedEffects;
    actorDied = tierResult.actorDied;
    criticalTierApplied = tierResult.newTierApplied;
  } else if (normalizedHpBefore > 0 && damage > 0) {
    // HP is above 0 - apply normal damage
    woundsAfter = Math.min(maxHp, woundsBefore + damage);
    hpAfter = maxHp - woundsAfter;

    // If damage brings HP to 0 or below, ensure wounds = maxHp and start critical damage track
    if (hpAfter <= 0) {
      woundsAfter = maxHp;
      hpAfter = 0;
      // First time reaching 0 HP - start critical damage track
      if (criticalDamage === 0) {
        criticalDamage = damage;
        const tierResult = applyCriticalDamageTiers(
          actor,
          criticalDamage,
          0,
          save,
          rng,
          storyPack,
          catalogs
        );
        effects = tierResult.emittedEffects;
        actorDied = tierResult.actorDied;
        criticalTierApplied = tierResult.newTierApplied;
      }
    }
  } else {
    // No damage or already dead - normalize wounds
    woundsAfter = Math.min(maxHp, woundsBefore);
    hpAfter = maxHp - woundsAfter;
  }

  // Update actor immutably
  const updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      wounds: actorDied ? maxHp : woundsAfter, // If dead, wounds = maxHp (HP = 0)
      criticalDamage: criticalDamage > 0 ? criticalDamage : undefined,
      criticalTierApplied: criticalTierApplied > 0 ? criticalTierApplied : undefined,
      isDead: actorDied ? true : actor.resources.isDead,
    },
  };

  return {
    updatedActor,
    effects,
    actorDied,
  };
}

