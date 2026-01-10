/**
 * Eternity Gate Engine
 * Runtime-safe for React Native
 * Pure deterministic state machine (no IO)
 */

// Main API
export {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
  startCombat,
  getCurrentTurnActorId,
  advanceCombatTurn,
  runNpcTurn,
} from "./runtime/engine";

// Utilities
export { evaluateCondition, evaluateConditions } from "./runtime/conditions";
export { applyEffect, applyEffects } from "./runtime/effects";
export { performCheck, performCheckWithSave, resolveActor, getStatOrSkillValue } from "./runtime/checks";
export { RNG, rollD100 } from "./runtime/rng";

// Equipment helpers
export { getActorWeapon, getActorArmor, calculateWeaponDamage } from "./runtime/combat/equipment";

// Inventory helpers
export { posKey, isWeaponItemRef, isArmorItemRef } from "./runtime/items";
export { getEquippedWeaponId, getEquippedArmorId, getActorInventory } from "./runtime/characters/inventory";

// Combat movement helpers
export { distanceChebyshev, clampToGrid } from "./runtime/combat/movement";
export { isActorAlive } from "./runtime/combat/combat";

// Content pack types and utilities
export type { ContentPack } from "./content/types";
export { mergeWeapons, mergeArmors } from "./content/merge";
export { loadCharacterCatalogs, getSkillById, getTalentById, getTraitById } from "./content/loadCatalogs";
export type { Skill, Talent, Trait, CharacterCatalogs, SkillId, TalentId, TraitId } from "./content/catalogs";

// Character framework
export { getXp, addXp, spendXp, buyTalent } from "./runtime/characters/xp";
export { evaluatePrerequisites, hasTrait, hasTalentRank, statAtLeast } from "./runtime/characters/prerequisites";
export { hasUnlockedAction } from "./runtime/characters/actions";
export { getModifierTotal } from "./runtime/characters/modifiers";
export { getSkillTarget } from "./runtime/characters/skills";
export { getRangedDamageBonusFromMightyShot } from "./runtime/characters/mightyShot";
export { getNaturalWeaponProfile } from "./runtime/characters/naturalWeapons";
export { processRegeneration } from "./runtime/characters/regeneration";
export { getCharacteristicBonus, getStatTestTarget } from "./runtime/characters/bonuses";
export { calculateMaxHp, calculateMaxRf, getCurrentHp } from "./runtime/characters/hp";
export { getMagicPower } from "./runtime/magic/pm";
export { canLearnSpell, learnSpell, getLearnedSpells, hasLearnedSpell } from "./runtime/magic/learning";
export { getAllSpells, getSpellById, getEffectById } from "./runtime/magic/catalogs";

// Targeting types
export type { TargetSpec, TargetingDefinition, TargetResolution, Direction9, Point } from "./runtime/targeting/types";
export { getActorsInRange } from "./runtime/targeting/getActorsInRange";

// Types
export type * from "./runtime/types";
