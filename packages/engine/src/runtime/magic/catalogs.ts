import type { SpellDefinition, EffectDefinition } from "./types";

// Import catalogs directly (MVP approach)
// In production, these would be loaded from StoryPack or ContentPack
// Using require for compatibility with build system
const spellsCatalog = require("../../../../content/src/catalogs/spells.json");
const effectsCatalog = require("../../../../content/src/catalogs/effects.json");

/**
 * Gets a spell definition by ID
 */
export function getSpellById(spellId: string): SpellDefinition | undefined {
  return (spellsCatalog as SpellDefinition[]).find((s) => s.id === spellId);
}

/**
 * Gets an effect definition by ID
 */
export function getEffectById(effectId: string): EffectDefinition | undefined {
  return (effectsCatalog as EffectDefinition[]).find((e) => e.id === effectId);
}

/**
 * Gets all spells (for UI display)
 */
export function getAllSpells(): SpellDefinition[] {
  return spellsCatalog as SpellDefinition[];
}

