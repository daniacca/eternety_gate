import type { Effect, GameSave, StoryPack } from "../../../types";
import { IRNG } from "../../../rng";
import { nextRuntimeSeq } from "../../narration";
import { applyVengeanceShotCosts } from "./applyVengeanceShotCosts";
import { buildCombatCheckFactory } from "./buildCombatCheckFactory";
import { computeCoverModifier } from "./computeCoverModifier";
import { consumeCombatAction } from "./consumeCombatAction";
import { getEquippedWeaponIds } from "./getEquippedWeaponIds";
import { injectNaturalAbilityWeapons } from "./injectNaturalAbilityWeapons";
import { loadCatalogsForAttack } from "./loadCatalogsForAttack";
import { resolveNaturalAbilityFallback } from "./resolveNaturalAbilityFallback";
import { resolveNaturalWeaponFallback } from "./resolveNaturalWeaponFallback";
import { resolveWeaponIdsToUse } from "./resolveWeaponIdsToUse";
import { resolveWeaponAttack } from "./resolveWeaponAttack";
import { validateAttackPreconditions } from "./validateAttackPreconditions";
import { validatePrimaryWeaponPrecheck } from "./validatePrimaryWeaponPrecheck";

/**
 * Centralized attack resolution: the only place that resolves attacks end-to-end
 * Validates combat, turn, action availability, performs check, applies damage, handles KO
 */
export function combatRequestAttack(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const preconditions = validateAttackPreconditions(effect, save, combat);
  if (!preconditions.ok) {
    return { save: preconditions.save };
  }
  const { dist, defenderPos } = preconditions;

  const channelDoS = combat.channeling?.actorId === effect.attackerId ? combat.channeling.accumulatedDoS : 0;
  const currentTurnCounter = combat.turnCounter ?? 0;

  // Mutable save for further updates (ammo, action, etc.)
  let currentSave: GameSave = save;
  const attacker = currentSave.actorsById[effect.attackerId];
  if (!attacker) {
    return { save: currentSave };
  }

  const { main: mainWeaponId, off: offWeaponId } = getEquippedWeaponIds(attacker);
  let { weaponIdsToUse, dualWieldPenalty } = resolveWeaponIdsToUse(effect, attacker, mainWeaponId, offWeaponId);
  const coverModifier = computeCoverModifier(effect, save, defenderPos, attacker);
  const buildCombatCheck = buildCombatCheckFactory(effect, dualWieldPenalty, coverModifier);

  const catalogs = loadCatalogsForAttack(storyPack);

  const vengeanceResult = applyVengeanceShotCosts(effect, attacker, currentSave, catalogs);
  if (vengeanceResult.blocked) {
    return { save: vengeanceResult.blocked };
  }
  currentSave = vengeanceResult.save;

  currentSave = injectNaturalAbilityWeapons(attacker, currentSave);

  // If no equipped weapons and attacker has natural weapons, use them instead of unarmed
  const naturalFallback = resolveNaturalWeaponFallback(
    effect,
    attacker,
    currentSave,
    catalogs,
    weaponIdsToUse,
    mainWeaponId,
    offWeaponId,
  );
  currentSave = naturalFallback.save;
  weaponIdsToUse = naturalFallback.weaponIdsToUse;

  // If no equipped weapons and actor has natural abilities, use first matching ability
  weaponIdsToUse = resolveNaturalAbilityFallback(
    attacker,
    currentSave,
    weaponIdsToUse,
    mainWeaponId,
    offWeaponId,
    effect.mode,
  );

  const primaryWeaponId = weaponIdsToUse[0] ?? null;
  const primaryPrecheck = validatePrimaryWeaponPrecheck(
    effect,
    currentSave,
    buildCombatCheck,
    primaryWeaponId,
    dist,
    currentTurnCounter,
    attacker,
  );
  if (primaryPrecheck.blocked) {
    return { save: primaryPrecheck.blocked };
  }

  // Consume action (but NOT aim stance yet - it needs to be available during check calculation)
  // IMPORTANT: Include stancesByActorId so aim stance is available during check
  // Reset channeling (non-magic action)
  const combatWithActionConsumed = consumeCombatAction(combat, effect);

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Generate deterministic resolutionId for this attack resolution
  // This will correlate the attack check, defense check (if any), and damage entry
  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:${seq}`;
  currentSave = saveWithSeq;

  const emittedEffects: Effect[] = [];
  let aimConsumed = false;
  const weaponCount = weaponIdsToUse.length;
  const context = {
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
  };

  for (let index = 0; index < weaponCount; index++) {
    const weaponId = weaponIdsToUse[index] ?? null;
    const result = resolveWeaponAttack(context, currentSave, aimConsumed, weaponId, index, weaponCount);
    if (result.blocked) {
      return { save: result.save };
    }
    currentSave = result.save;
    aimConsumed = result.aimConsumed;
    if (result.emittedEffects.length > 0) {
      emittedEffects.push(...result.emittedEffects);
    }
    if (result.shouldBreak) {
      break;
    }
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}
