import type { StatKey, CastMode } from "../types";
import type { HookDefinition } from "../hooks/types";
import type { Prerequisite } from "../../content/catalogs";

/**
 * Magic disciplines
 */
export type Discipline = "PYRA" | "KINESIS" | "MENTIS" | "VATES" | "CORPUS" | "SANTIC" | "DAEMONOLOGY";

/**
 * Spell casting time (action economy)
 */
export type SpellCastTime = "free" | "standard" | "fullRound";

/**
 * Target shape for spell effects
 */
export type TargetShape = "self" | "touch" | "single" | "line" | "cone" | "radius";

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
  hooks?: HookDefinition[];
};

/**
 * Effect definition from catalog
 */
export type EffectDefinition = {
  id: string;
  discipline: Discipline;
  castingStat: StatKey; // Stat used for casting check (WIS, INT, RES, etc.)
  effectStat?: StatKey; // Stat used for effect scaling (defaults to castingStat)
  kind: "damage" | "heal" | "fatigue" | "blessing" | "malediction"; // Semantic kind of effect
  baseDamageDice?: {
    dice: number; // Number of dice
    sides: number; // Sides per die (e.g. 10 for d10)
  };
  baseDamageFlat?: number; // Flat damage bonus (default 0)
  damageType?: string; // Optional damage type
  moveTarget?: {
    mode: "awayFromCaster";
    distance: number | "radius";
  };
  radiusFromEffectStat?: boolean;
  centerOnCaster?: boolean;
  applyConditions?: Array<{
    conditionId: string;
    durationRounds?: number;
    value?: number;
    trigger?: {
      overcast?: number;
    };
  }>;
  specialFatigue?: number; // Extra RF always applied on success
  rfOnSuccess?: number; // RF applied on successful cast (in addition to other RF rules)
  healFatigueRatio?: number; // Ratio of healed wounds converted into Fatigue for caster
  damageQualities?: string[]; // Weapon-like qualities (e.g. sanctified, unholy)
  aura?: {
    applyToAllies?: boolean;
    radiusFromEffectStat?: boolean;
    radiusSquares?: number;
    includeCaster?: boolean;
  };
  opposed?: boolean; // If true, requires opposed check
  opposedStat?: StatKey; // Stat for defender's opposed check (defaults to same as castingStat)
  opposedDifficulty?: string; // Difficulty for defender's opposed check (defaults to "Challenging")
  applyFatigueDice?: {
    dice: number;
    sides: number;
  }; // Roll fatigue dice and apply to target
  tempModifier?: {
    scope: "check" | "all";
    value: number;
    durationRounds: number;
    fixedDurationRounds?: number;
  }; // Temporary modifier with duration
  specialOp?: string; // Special operation (e.g., "combatDisarmAtRange")
  description?: string;
  hooks?: HookDefinition[];
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

/* ---------------------------------- */
/* Narrative Magic Types              */
/* ---------------------------------- */

/**
 * Narrative operation types - deterministic, safe operations for narrative spell effects
 */
export type NarrativeOp =
  | { op: "setFlag"; key: string; value: boolean }
  | { op: "incFlag"; key: string; by: number | "@dos"; scaleBy?: "dos"; max?: number }
  | {
      op: "addCondition";
      actorId: string | "active";
      condition: string;
      stacks?: number | "@dos";
      durationTurns?: number;
    }
  | { op: "removeCondition"; actorId: string | "active"; condition: string }
  | {
      op: "modifyResource";
      actorId: string | "active";
      resource: "rf" | "wounds" | "criticalDamage";
      delta: number | "@dos";
      scaleBy?: "dos";
      max?: number;
    }
  | { op: "grantXP"; actorId: string | "active"; amount: number | "@dos"; scaleBy?: "dos"; max?: number }
  | { op: "addItem"; actorId: string | "active"; itemId: string; qty?: number }
  | { op: "removeItem"; actorId: string | "active"; itemId: string; qty?: number };

/**
 * Narrative target types for non-combat spell usage
 */
export type NarrativeTarget = "self" | "singleActor" | "scene" | "none";

/**
 * Narrative spell configuration - optional extension to SpellDefinition
 */
export type NarrativeSpellConfig = {
  target: NarrativeTarget;
  requiresCheck?: boolean; // Default true
  minDoSToSucceed?: number; // Default 0 (any success)
  onSuccess?: NarrativeOp[];
  onFailure?: NarrativeOp[];
};

/**
 * Usage flags for spell - determines where a spell can be used
 */
export type SpellUsage = {
  combat?: boolean; // Default true
  narrative?: boolean; // Default false
};

/**
 * Extended spell definition with narrative support
 */
export type SpellDefinitionExtended = SpellDefinition & {
  usage?: SpellUsage;
  narrative?: NarrativeSpellConfig;
};

/**
 * Effect definition with narrative defaults
 */
export type EffectDefinitionExtended = EffectDefinition & {
  narrativeDefaults?: {
    onSuccess?: NarrativeOp[];
    onFailure?: NarrativeOp[];
  };
};

/**
 * Request for casting a spell in narrative context
 */
export type NarrativeSpellRequest = {
  spellId: string;
  casterId?: string; // Default = party.activeActorId
  targetActorId?: string; // For singleActor target
  options?: {
    skipRfCost?: boolean;
    castMode?: CastMode;
    /** When true (e.g. scroll): no MC consumed, overcast = 0. */
    fromScroll?: boolean;
  };
  context?: {
    sceneId?: string;
    choiceId?: string;
  };
};

/**
 * Phenomena result for narrative casting
 */
export type NarrativePhenomenaResult = {
  triggered: boolean;
  severity: "none" | "minor" | "major";
  roll?: number;
  effectDescription?: string;
};

/**
 * Result of a narrative spell cast
 */
export type NarrativeSpellResult = {
  ok: boolean; // Cast performed (spell exists, learnable, usage allowed)
  success: boolean; // Check result (true if passed)
  check?: {
    checkId: string;
    actorId: string;
    roll: number;
    target: number;
    success: boolean;
    dos: number;
    dof: number;
    critical: "none" | "autoSuccess" | "autoFail" | "epicSuccess" | "epicFail";
    tags: string[];
  } | null;
  phenomena?: NarrativePhenomenaResult;
  appliedOps: NarrativeOp[];
  logs: string[]; // Narrative-friendly lines
  tags: string[]; // For debugging
};
