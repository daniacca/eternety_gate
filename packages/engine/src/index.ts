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
} from './runtime/engine';

// Utilities
export { evaluateCondition, evaluateConditions } from './runtime/conditions';
export { applyEffect, applyEffects } from './runtime/effects';
export { performCheck, resolveActor, getStatOrSkillValue } from './runtime/checks';
export { RNG } from './runtime/rng';

// Types
export type * from './runtime/types';

