// Magic system exports

// Types
export type {
  Discipline,
  SpellCastTime,
  TargetShape,
  RangeMode,
  SpellDefinition,
  EffectDefinition,
  SpellTargetSpec,
  // Narrative types
  NarrativeOp,
  NarrativeTarget,
  NarrativeSpellConfig,
  SpellUsage,
  SpellDefinitionExtended,
  EffectDefinitionExtended,
  NarrativeSpellRequest,
  NarrativePhenomenaResult,
  NarrativeSpellResult,
} from "./types";

// Catalogs
export { getSpellById, getEffectById, getAllSpells } from "./catalogs";

// Learning
export { canLearnSpell, learnSpell, getLearnedSpells, hasLearnedSpell } from "./learning";

// Power Magic
export { getMagicPower } from "./pm";

// Od reserve (MC)
export { getMcMax, getMcCurrent, setMcCurrent, ensureMcReserve, migrateSaveMcReserve } from "./od";

// Cast modes
export { getMcSpentForMode, getCastModifierForMode, getOvercastLevel } from "./castModes";

// Magic density
export { getMagicDensity, channelDoSToMc } from "./density";

// Phenomena
export {
  shouldTriggerPhenomena,
  getPhenomenaTrigger,
  getPhenomenaSeverityFromDof,
  getPhenomenaSeverity,
  rollPhenomena,
  normalizeD100,
  isDoublesRoll,
} from "./phenomena";

// Scaling
export { scaleDamage, scaleCondition, scaleHeal } from "./scaling";

// Narrative casting
export { runNarrativeSpell, applyNarrativeOps } from "./castSpellNarrative";
export type { NarrativeOpsContext } from "./applyNarrativeOps";
