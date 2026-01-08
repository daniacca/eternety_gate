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
export { performCheck, resolveActor, getStatOrSkillValue } from "./runtime/checks";
export { RNG, rollD100 } from "./runtime/rng";

// Equipment helpers
export { getActorWeapon, getActorArmor, calculateWeaponDamage } from "./runtime/combat/equipment";

// Inventory helpers
export {
  posKey,
  getEquippedWeaponId,
  getEquippedArmorId,
  getActorInventory,
  isWeaponItemRef,
  isArmorItemRef,
} from "./runtime/inventory";

// Combat movement helpers
export { distanceChebyshev, clampToGrid } from "./runtime/combat/movement";

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

// Types
export type * from "./runtime/types";
