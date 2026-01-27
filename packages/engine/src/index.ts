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
export {
  getActorWeapon,
  getActorArmor,
  calculateWeaponDamage,
  getEquippedWeapon,
  getEquippedArmor,
  hasShieldEquipped,
} from "./runtime/combat/equipment";

export {
  canEquipItem,
  equipItem,
  unequipItem,
  listEquippableInventoryItems,
  getItemDefinition,
  getItemDisplaySummary,
} from "./runtime/equipment/management";

// Inventory helpers
export { posKey, isWeaponItemRef, isArmorItemRef, isCatalogItemRef } from "./runtime/items";
export {
  getEquippedWeaponId,
  getEquippedArmorId,
  getActorInventory,
  getItemRefQty,
  getInventoryItemQty,
  getActorCarriedWeightKg,
  getActorCarryCapacityKg,
} from "./runtime/characters/inventory";
export { canUseItem, useItem } from "./runtime/items";
export { getItemPrice, getAdjustedPrice, getBasePriceFromRarity } from "./runtime/items/pricing";

// Combat movement helpers
export { distanceChebyshev, clampToGrid } from "./runtime/combat/movement";
export { isActorAlive } from "./runtime/characters/actors";
export {
  getFootprintRadius,
  getFootprintCells,
  getActorSize,
  getActorFootprint,
  getFootprintBBox,
  chebyshevDistanceBetweenBBoxes,
  footprintDistanceBetweenActors,
  footprintIntersects,
  isFootprintWalkable,
  canPlaceActorAt,
  buildOccupancyMap,
} from "./runtime/combat/footprint";

// Content pack types and utilities
export type { ContentPack } from "./content/types";
export { mergeWeapons, mergeArmors, mergeItems } from "./content/merge";
export {
  loadCharacterCatalogs,
  loadTerrainCatalogs,
  loadEquipmentCatalogs,
  loadWeaponQualities,
  getSkillById,
  getTalentById,
  getTraitById,
} from "./content/loadCatalogs";
export type {
  Skill,
  Talent,
  Trait,
  CharacterCatalogs,
  SkillId,
  TalentId,
  TraitId,
  GridDefinition,
  TileDefinition,
  TerrainCatalogs,
  WeaponQuality,
  WeaponQualityId,
} from "./content/catalogs";

// Terrain helpers
export { getGrid, getCellTerrain } from "./runtime/combat/terrain";

// Character framework
export { getActorXp, grantActorXp, spendActorXp, buyTalent } from "./runtime/characters/xp";
export { getActorGold, grantActorGold, spendActorGold } from "./runtime/characters/gold";
export {
  evaluatePrerequisites,
  hasTrait,
  hasTalentRank,
  statAtLeast,
  canAcquireTalent,
  getActorTalentsWithParams,
  getTalentParams,
  canAcquireTrait,
} from "./runtime/characters/prerequisites";
export { hasUnlockedAction } from "./runtime/characters/actions";
export { getModifierTotal } from "./runtime/characters/modifiers";
export { getSkillTarget, getSkillTrainingCost } from "./runtime/characters/skills";
export { getRangedDamageBonusFromMightyShot } from "./runtime/characters/mightyShot";
export { getNaturalWeaponProfile } from "./runtime/characters/naturalWeapons";
export {
  getNaturalAbilityProfiles,
  getNaturalAbilityWeapons,
  getNaturalAbilityWeaponMap,
  getNaturalAbilityWeaponById,
} from "./runtime/characters/naturalAbilities";
export { processRegeneration } from "./runtime/characters/regeneration";
export { getCharacteristicBonus, getStatTestTarget } from "./runtime/characters/bonuses";
export { calculateMaxHp, calculateMaxRf, getCurrentHp } from "./runtime/characters/hp";
export { getMagicPower } from "./runtime/magic/pm";
export { canLearnSpell, learnSpell, getLearnedSpells, hasLearnedSpell } from "./runtime/magic/learning";
export { getAllSpells, getSpellById, getEffectById } from "./runtime/magic/catalogs";
export {
  resolveWeaponQualities,
  getWeaponQuality,
  hasWeaponQuality,
  getWeaponQualityRank,
} from "./runtime/weaponQualities";

// Targeting types (legacy + new combat targeting)
export type {
  TargetSpec as LegacyTargetSpec,
  TargetingDefinition,
  TargetResolution,
  Direction9,
  Point,
} from "./runtime/targeting/types";
export { getActorsInRange } from "./runtime/targeting/getActorsInRange";
export type { TargetSpec, TargetSelection, TargetPreview, Direction8 } from "./runtime/combat/targeting/types";
export {
  buildSpellTargetSpec,
  computeTargetPreview,
  getActorAnchorPos,
  getActorsIntersectingCells,
  getCellsInConeSimple,
  getCellsInLine,
  getCellsInRadius,
  getCellsInTouch,
  isWithinRange,
} from "./runtime/combat/targeting/computeTargeting";

// Types
export type * from "./runtime/types";
