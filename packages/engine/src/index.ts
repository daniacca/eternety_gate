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
} from './runtime/engine';

// Utilities
export { evaluateCondition, evaluateConditions } from './runtime/conditions';
export { applyEffect, applyEffects } from './runtime/effects';
export { performCheck, resolveActor, getStatOrSkillValue } from './runtime/checks';
export { RNG, rollD100 } from './runtime/rng';

// Equipment helpers
export { getActorWeapon, getActorArmor, calculateWeaponDamage } from './runtime/combat/equipment';

// Content pack types and utilities
export type { ContentPack } from './content/types';
export { mergeWeapons, mergeArmors } from './content/merge';

// Types
export type * from './runtime/types';

