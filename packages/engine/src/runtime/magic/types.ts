import type { StatKey } from "../types";
import type { Prerequisite } from "../../content/catalogs";

/**
 * Magic disciplines
 */
export type Discipline = "PYRA" | "KINESIS" | "MENTIS" | "VATES" | "CORPUS";

/**
 * Spell casting time (action economy)
 */
export type SpellCastTime = "free" | "standard" | "fullRound";

/**
 * Target shape for spell effects
 */
export type TargetShape = "self" | "single" | "line" | "cone" | "radius";

/**
 * Range mode for spells
 */
export type RangeMode = "self" | "touch" | "short" | "medium" | "long";

/**
 * Spell definition from catalog
 */
export type SpellDefinition = {
  id: string;
  name: string;
  discipline: Discipline;
  castTime: SpellCastTime;
  effectId: string;
  baseCN: number; // Base Casting Number
  rangeMode: RangeMode;
  targetShape: TargetShape;
  rangeMultiplier?: number; // Multiplier for range calculation (rangeSquares = cnBase * rangeMultiplier)
  rangeSquares?: number; // Explicit range in squares (overrides rangeMultiplier if present)
  radiusSquares?: number; // For radius spells: AoE radius (default 2)
  notes?: string;
  xpCost: number; // XP cost to learn this spell
  prerequisites?: Prerequisite[]; // Prerequisites to learn this spell
};

/**
 * Effect definition from catalog
 */
export type EffectDefinition = {
  id: string;
  discipline: Discipline;
  castingStat: StatKey; // Stat used for casting check (WIS, INT, RES, etc.)
  baseCN: number; // Base Casting Number
  baseDamageDice?: {
    dice: number; // Number of dice
    sides: number; // Sides per die (e.g. 10 for d10)
  };
  baseDamageFlat?: number; // Flat damage bonus (default 0)
  damageType?: string; // Optional damage type
  applyConditions?: Array<{
    conditionId: string;
    durationRounds?: number;
    value?: number;
  }>;
  specialFatigue?: number; // Extra RF always applied on success
  opposed?: boolean; // For later; MVP can ignore
  description?: string;
};

/**
 * Target specification for spell casting
 */
export type SpellTargetSpec = {
  type: "self" | "actor" | "position";
  actorId?: string; // For single target
  position?: { x: number; y: number }; // For area effects
  direction?: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"; // For cone/line
};

