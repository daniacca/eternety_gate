import type { TargetSelection } from "./combat/targeting/types";

// Runtime Types for Eternity Gate Engine
// This is the single source of truth for all engine types.
// JSON schemas in /schemas/ folder should mirror these types for validation.

/* ---------------------------------- */
/* ID Aliases                         */
/* ---------------------------------- */

export type StoryId = string;
export type StoryVersion = string;

export type SceneId = string;
export type ChoiceId = string;

export type ActorId = string;
export type ItemId = string;
export type WeaponId = string;
export type ArmorId = string;

export type WorldEventId = string;

/* ---------------------------------- */
/* Core Stats / Keys                  */
/* ---------------------------------- */

export type StatKey =
  | "STR" // Strength
  | "TOU" // Toughness
  | "AGI" // Agility
  | "INT" // Intelligence
  | "WIL" // Willpower
  | "CHA" // Charisma
  | "WS" // Weapon Skill
  | "BS" // Ballistic Skill
  | "INI" // Initiative
  | "PER"; // Perception

/**
 * A key can refer to either a StatKey or a Skill/Discipline.
 * Convention:
 * - Stat: "STR" | "TOU" | ...
 * - Skill: "SKILL:<skillId>" e.g. "SKILL:VATES"
 *
 * This avoids typos and ambiguity in the engine.
 */
export type StatOrSkillKey = StatKey | `SKILL:${string}`;

/* ---------------------------------- */
/* Conditions                         */
/* ---------------------------------- */

export type ConditionId =
  | "prone"
  | "stunned"
  | "bleeding"
  | "fatigue"
  | "unconscious"
  | "halvedMovement"
  | "bound"
  | "force_shield"
  | "steel_body"
  | "warp_speed";

export type ConditionInstance = {
  stacks?: number;
  untilTurnCounter?: number;
  source?: string;
};

/* ---------------------------------- */
/* StoryPack Types                    */
/* ---------------------------------- */

export type SceneType = "narration" | "dialogue" | "hub" | "system" | "challenge" | "ending";

/* ---------- Conditions ------------ */

export type Condition =
  | { op: "flag"; path: string; value: boolean }
  | { op: "counterGte"; path: string; value: number }
  | { op: "counterLte"; path: string; value: number }
  | { op: "and"; clauses: Condition[] }
  | { op: "or"; clauses: Condition[] }
  | { op: "not"; clause: Condition };

/* ---------- Effects --------------- */

export type Effect =
  | { op: "setFlag"; path: string; value: boolean }
  | { op: "addCounter"; path: string; value: number }
  | { op: "addItem"; actorId: ActorId; itemId: ItemId; qty?: number }
  | { op: "removeItem"; actorId: ActorId; itemId: ItemId; qty?: number }
  | { op: "goto"; sceneId: SceneId }
  | { op: "conditionalEffects"; cases: Array<{ when: Condition; then: Effect[] }> }
  | { op: "chooseRunVariant"; source: string; strategy: "randomOrDefault" | "random" | "defaultOnly" }
  | { op: "applyVariantStartEffects" }
  | { op: "fireWorldEvents" }
  | {
      op: "combatStart";
      participantIds: ActorId[];
      grid?: Grid;
      gridId?: string;
      placements: Array<{ actorId: ActorId; x: number; y: number }>;
    }
  | { op: "combatMove"; dir: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"; actorId?: ActorId }
  | { op: "combatEndTurn" }
  | { op: "combatDefend" }
  | { op: "combatAim" }
  | { op: "combatAllOut"; targetId: ActorId }
  | {
      op: "combatRequestAttack";
      attackerId: ActorId;
      defenderId: ActorId;
      mode: CombatMode; // "MELEE" | "RANGED"
      weaponId?: string | null;
      modifiers?: CombatAttackCheck["modifiers"]; // riusa tipo esistente se possibile
      defense?: CombatAttackCheck["defense"]; // idem
      onSuccessEffects?: Effect[]; // Effects to apply when attack hits
      onFailureEffects?: Effect[]; // Effects to apply when attack misses (including parry/dodge)
    }
  | {
      op: "addCondition";
      actorId: ActorId;
      condition: ConditionId;
      stacks?: number;
      durationTurns?: number;
      source?: string;
    }
  | {
      op: "removeCondition";
      actorId: ActorId;
      condition: ConditionId;
    }
  | {
      op: "combatKnockdown";
      attackerId: ActorId;
      defenderId: ActorId;
    }
  | {
      op: "combatDisarm";
      attackerId: ActorId;
      defenderId: ActorId;
    }
  | {
      op: "combatSwiftAttack";
      attackerId: ActorId;
      defenderId: ActorId;
      weaponId?: WeaponId | null;
    }
  | {
      op: "combatGetProne";
      actorId: ActorId;
    }
  | {
      op: "combatStandUp";
      actorId: ActorId;
    }
  | {
      op: "combatPickup";
      actorId: ActorId;
    }
  | {
      op: "combatDrop";
      actorId: ActorId;
      itemRef?: ItemRef; // If not provided, drops equipped mainHand
      fromSlot?: "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2" | "inventory";
      inventoryIndex?: number; // If dropping from inventory
    }
  | {
      op: "combatEquipItem";
      actorId: ActorId;
      itemRef: ItemRef;
      slot: "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2";
      inventoryIndex?: number; // Index in inventory if equipping from inventory
    }
  | {
      op: "combatUnequipItem";
      actorId: ActorId;
      slot: "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2";
    }
  | {
      op: "combatChannel";
      actorId: ActorId;
    }
  | {
      op: "combatCastSpell";
      actorId: ActorId;
      spellId: string;
      targetSelection: TargetSelection;
      castOptions?: {
        ignoreWeaverRequirement?: boolean;
        skipRfCost?: boolean;
        noOvercast?: boolean;
      };
    }
  | {
      op: "learnSpell";
      actorId: ActorId;
      spellId: string;
    }
  | {
      op: "acquireTalent";
      actorId: ActorId;
      talentId: string;
      chosenParams?: Record<string, string>; // e.g., { chosenType: "magic" } for Resistance
    }
  | {
      op: "grantXp";
      actorId: ActorId; // XP is per-actor, not global
      amount: number;
    }
  | {
      op: "grantFatePoint";
      actorId: ActorId;
      amount: number;
    }
  | {
      op: "narrativeSpell";
      spellId: string;
      casterId?: ActorId; // Default = party.activeActorId
      targetActorId?: ActorId; // For singleActor targets
    };

/* ---------- ActorRef ---------- */

export type ActorRef =
  | { mode: "active" }
  | { mode: "byId"; actorId: ActorId }
  | { mode: "bestOfParty"; key: StatOrSkillKey }
  | { mode: "askPlayer"; key: StatOrSkillKey };

/* ---------- Checks ---------- */

export type SingleCheck = {
  id: string;
  kind: "single";
  actorRef?: ActorRef;
  key: StatOrSkillKey;
  difficulty: string;
  /** Optional flat modifier to apply to the check target (e.g., -10 for non-Weaver Deny the Witch) */
  modifier?: number;
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type MultiCheck = {
  id: string;
  kind: "multi";
  actorRef?: ActorRef;
  options: Array<{ key: StatOrSkillKey; difficulty: string }>;
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type OpposedCheck = {
  id: string;
  kind: "opposed";
  attacker: { actorRef?: ActorRef; key: StatOrSkillKey; difficulty?: string };
  defender: { actorRef?: ActorRef; key: StatOrSkillKey; difficulty?: string };
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type SequenceCheck = {
  id: string;
  kind: "sequence";
  steps: Check[];
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

/**
 * Magic: CN-only.
 * - magicChannel accumulates DoS (potentially over multiple tests/scenes)
 * - magicEffect requires castingNumberDoS DoS in the casting test (DoS extra => upgrades)
 */
export type MagicChannelCheck = {
  id: string;
  kind: "magicChannel";
  actorRef?: ActorRef;
  /** Optional reference to an effect template / discipline entry */
  effectId?: string;
  key: StatOrSkillKey;
  difficulty?: string;
  targetDoS: number; // must be >= 1
  powerMode?: "CONTROLLED" | "FORCED";
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type MagicEffectCheck = {
  id: string;
  kind: "magicEffect";
  actorRef?: ActorRef;
  /** Optional reference to an effect template / discipline entry */
  effectId?: string;
  key: StatOrSkillKey;
  difficulty?: string;
  castingNumberDoS: number; // must be >= 1
  powerMode?: "CONTROLLED" | "FORCED";
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type CombatMode = "MELEE" | "RANGED";
export type DefenseStrategy = "autoBest" | "preferParry" | "preferDodge";
export type RangeBand = "POINT_BLANK" | "SHORT" | "NORMAL" | "LONG" | "EXTREME";
export type Cover = "NONE" | "LIGHT" | "HEAVY";

export type CombatAttackCheck = {
  id: string;
  kind: "combatAttack";
  attacker: { actorRef?: ActorRef; mode: CombatMode; weaponId?: string | null };
  defender: { actorRef: ActorRef };
  defense: { allowParry?: boolean; allowDodge?: boolean; strategy: DefenseStrategy };
  modifiers?: {
    outnumbering?: number; // >=0
    rangeBand?: RangeBand; // ranged only
    calledShot?: boolean;
    calledShotZone?: "head" | "arms" | "body" | "legs"; // Target body zone for Called Shot
    cover?: Cover; // ranged only
    hitBonus?: number; // bonus/penalty to hit (e.g. +20 for All-Out Attack)
  };
  onSuccess?: Effect[];
  onFailure?: Effect[];
};

export type Check =
  | SingleCheck
  | MultiCheck
  | OpposedCheck
  | SequenceCheck
  | MagicChannelCheck
  | MagicEffectCheck
  | CombatAttackCheck;

/* ---------- Scene/Choice ---------- */

export type Choice = {
  id: ChoiceId;
  label: string;
  conditions?: Condition | Condition[];
  checks?: Check[];
  effects: Effect[];
};

export type TextBlock = {
  conditions: Condition | Condition[];
  text: string[];
};

export type Scene = {
  id: SceneId;
  type: SceneType;
  title: string;
  text: string[];
  textBlocks?: TextBlock[];
  onEnter?: Effect[];
  checks?: Check[];
  choices: Choice[];
  rewards?: any[];
  persistentConsequences?: any[];
};

export type StoryPack = {
  id: StoryId;
  title: string;
  version: StoryVersion;

  meta?: Record<string, any>;

  stateSchema: any;
  initialState: any;

  systems: {
    checks: {
      difficultyBands: Record<string, number>;
      criticals: {
        autoSuccess: number[];
        autoFail: number[];
        epic?: {
          success: number;
          fail: number;
          treatAsDoS: number;
        };
      };
    };
    worldEvents?: Record<
      WorldEventId,
      {
        id: WorldEventId;
        title: string;
        trigger: Condition;
        once: boolean;
        effects: Effect[];
      }
    >;
    runVariants?: Array<{
      id: string;
      tags: string[];
      startEffects?: Effect[];
    }>;
  };

  startSceneId: SceneId;

  cast?: any;
  effectsCatalog?: any;

  // Story-local content (weapons/armors override or extend global content pack)
  items?: ItemDefinition[];
  weapons?: Weapon[];
  armors?: Armor[];
  skills?: any[];
  talents?: any[];
  traits?: any[];
  weaponQualities?: any[];
  grids?: any[];
  tiles?: any;

  scenes: Scene[];
};

/* ---------------------------------- */
/* Runtime: Items / Actors / Party     */
/* ---------------------------------- */

export type WeaponDamageTier = "fixed" | "half" | "single" | "double" | "triple" | "quadfold" | "fivefold";
export type WeaponDamageType = "energy" | "explosive" | "impact" | "rendering" | "piercing";

export type WeaponQualityRef = {
  id: string;
  rank?: number;
};

export type Weapon = {
  id: WeaponId;
  name: string;
  kind: "MELEE" | "RANGED";
  damage: {
    tier: WeaponDamageTier; // fixed (0), half (1d5), single (1d10), double (2d10), triple (3d10), quadfold (4d10), fivefold (5d10)
    add: number; // e.g. +0, +2
    bonus?: "SB"; // melee adds Strength Bonus, ranged doesn't (for now)
  };
  damageType: WeaponDamageType; // energy | explosive | impact | rendering | piercing
  penetration: number; // amount of armor soak ignored by this weapon
  // ranged only
  range?: {
    short: number; // in chebyshev squares, e.g. 4
    long: number; // e.g. 8
  };
  tags?: string[]; // e.g. ["vengeful"] for Righteous Fury, ["vengeful:3"] for best-of-3 rolls
  weight?: number;
  handedness?: "oneHand" | "twoHand";
  ammo?: {
    itemId: ItemId;
    consumedPerAttack: number;
  };
  qualities?: WeaponQualityRef[];
  grants?: ItemGrant[];
};

export type Armor = {
  id: ArmorId;
  name: string;
  soak: number; // flat damage reduction
  agiMax?: number;
  weight: number;
  tags?: string[];
  grants?: ItemGrant[];
};

export type Equipment = {
  weaponId?: WeaponId | null;
  armorId?: ArmorId | null;
};

export type ItemGrant =
  | { type: "modifier"; key: string; op: "add"; value: number; valueRef?: string }
  | { type: "unlockAction"; actionId: string };

export type ItemDefinition = {
  id: ItemId;
  name: string;
  type: "wearable" | "consumable";
  kind?: "wearable" | "consumable";
  slot?: "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring";
  weight: number;
  maxStack?: number;
  tags?: string[];
  grants?: ItemGrant[];
  shield?: {
    soak?: number;
  };
  consumable?: {
    actionId: string;
    consumeOnUse: true;
    spellId?: string;
  };
  use?: {
    actionId: string;
  };
};

// ItemRef uses a simplified ItemKind for inventory/equipment references
export type ItemRefKind = "weapon" | "armor" | "item" | "misc";
export type ItemRef = { kind: ItemRefKind; id: string; qty?: number };

export type Actor = {
  id: ActorId;
  name: string;
  kind: "PC" | "NPC";
  tags?: string[];

  /**
   * Stats are NOT capped at 100. D100 is the resolution die,
   * but having stats > 100 helps overcome huge penalties.
   */
  stats: Record<StatKey, number>;

  derived?: {
    mod?: Partial<Record<StatKey, number>>;
    // Note: hpMax and rfMax are now always calculated dynamically
    // They are kept here for backward compatibility and caching, but should not be relied upon
    // Use calculateMaxHp() and calculateMaxRf() functions instead
    hpMax?: number;
    rfMax?: number;
  };

  resources: {
    wounds: number; // Damage taken (wounds), current HP = maxHp - wounds
    rf: number; // Fatigue (current RF)
    fatePoints?: number; // Fate Points for special abilities like Die Hard
    criticalDamage?: number;
    criticalTierApplied?: number;
    isDead?: boolean;
    xp?: number; // Experience points for this actor (default 0)
  };

  /**
   * Skills/Disciplines are stored without the "SKILL:" prefix here.
   * When referenced in checks, use key = `SKILL:<id>`.
   * Value is the rank (0 = untrained, 1+ = trained ranks).
   */
  skills: Record<string, number>;

  /**
   * Talents: Record of talentId -> rank count (1..maxRank)
   */
  talents: Record<string, number>;

  /**
   * Traits: Record of traitId -> params object (or true for traits without params)
   */
  traits: Record<string, any>;

  /**
   * Learned spells: Record of spellId -> true
   * Spells must be learned before they can be cast
   */
  spells?: Record<string, boolean>;

  equipment: {
    mainHand?: ItemRef | null;
    offHand?: ItemRef | null;
    armor?: ItemRef | null;
    helmet?: ItemRef | null;
    boots?: ItemRef | null;
    cloak?: ItemRef | null;
    necklace?: ItemRef | null;
    ring1?: ItemRef | null;
    ring2?: ItemRef | null;
  };

  // Inventory (slice 6.4+)
  inventory?: ItemRef[];

  /**
   * Conditions persist on Actor and survive leaving combat.
   * Each condition can have stacks, expiration turn counter, and source.
   */
  conditions?: Partial<Record<ConditionId, ConditionInstance>>;

  status: {
    conditions: string[]; // Legacy: kept for backward compatibility
    tempModifiers: Array<{
      id: string;
      scope: "check" | "combat" | "all";
      /**
       * If provided, can target a stat (e.g. "PER") or a skill key (e.g. "SKILL:VATES")
       */
      key?: StatOrSkillKey | null;
      value: number;
      expires?: any;
    }>;
  };
};

export type Party = {
  actors: ActorId[]; // size >= 1
  activeActorId: ActorId;
};

/* ---------------------------------- */
/* GameSave Types                      */
/* ---------------------------------- */

export type SaveVersion = "1.0.0";

export type CheckResult = {
  checkId: string;
  actorId: ActorId;

  roll: number; // 1..100
  target: number; // can be > 100

  success: boolean;

  dos: number;
  dof: number;

  critical: "none" | "autoSuccess" | "autoFail" | "epicSuccess" | "epicFail";

  tags: string[];
} | null;

/**
 * Extended log entry for non-check events (initiative, damage, system messages)
 */
export type RuntimeLogEntry =
  | {
      kind: "initiative";
      actorId: ActorId;
      iniBonus: number;
      iniRoll: number;
      iniScore: number;
      turnCounter?: number;
      resolutionId?: string;
    }
  | {
      kind: "damage";
      attackerId: ActorId;
      defenderId: ActorId;
      weaponId?: string;
      formula?: string;
      rolls?: number[];
      rawDamage: number;
      soak: number;
      touBonus?: number;
      finalDamage: number;
      turnCounter?: number;
      resolutionId?: string;
      tags?: string[];
    }
  | {
      kind: "check";
      check: CheckResult;
      resolutionId?: string;
    }
  | {
      kind: "system";
      message: string;
      turnCounter?: number;
      resolutionId?: string;
      tags?: string[];
    };

export type Grid = { width: number; height: number };
export type Position = { x: number; y: number };

export type CombatState = {
  active: boolean;
  participants: ActorId[];
  currentIndex: number;
  round: number;
  startedBySceneId?: SceneId;

  grid: Grid;
  gridId?: string; // ID of the grid definition from catalogs (defaults to "arena_01")
  positions: Record<ActorId, Position>;

  // economy semplificata "per-turn"
  turn: {
    moveRemaining: number; // steps left this turn
    actionAvailable: boolean; // true until an Action is spent
  };

  // Stances persist across turns until actor's next turn starts
  // Absence of key means "none" stance (only for UI display, not stored in state)
  stancesByActorId?: Record<ActorId, "defend" | "allOut" | "aim">;

  // Turn counter (monotonic, increments at start of each turn)
  turnCounter: number;

  // Parry disabled until turn counter (by actor ID)
  parryDisabledUntilTurnCounterByActorId?: Record<ActorId, number>;

  // Equipped this round (by actor ID) - tracks which round each actor last equipped an item
  equippedThisRoundByActorId?: Record<ActorId, number>;

  // Ground items by position
  groundItemsByPos?: Record<string, ItemRef[]>; // key format: "x,y"

  // Initial HP when combat started (for UI display of max HP)
  initialHpByActorId?: Record<ActorId, number>;

  // Damage tracking since last turn start (used for spiritual instability)
  damageTakenSinceLastTurnByActorId?: Record<ActorId, number>;
  damageDealtSinceLastTurnByActorId?: Record<ActorId, number>;

  // Magic channeling state
  channeling?: {
    actorId: ActorId;
    accumulatedDoS: number;
    lastChannelTurnCounter: number; // Turn counter when channeling was last performed
  };

  // Free spell used this turn (by actor ID)
  freeSpellUsedThisTurn?: Record<ActorId, boolean>;
};

export type GameRuntime = {
  currentSceneId: SceneId;

  rngSeed: number;
  rngCounter?: number;

  history: {
    visitedScenes: SceneId[];
    chosenChoices: ChoiceId[];
  };

  firedWorldEvents: WorldEventId[];

  lastCheck?: CheckResult;
  lastPlayerCheck?: CheckResult | null;

  magic?: {
    accumulatedDoS: number;
  };

  combat?: CombatState;

  combatLog?: string[];
  combatTurnStartIndex?: number;
  combatEndedSceneId?: SceneId;
  combatLogSceneId?: SceneId;
  combatCycleStartIndex?: number;

  /**
   * Extended log entries for initiative, damage rolls, and other combat events
   */
  runtimeLog?: RuntimeLogEntry[];

  /**
   * Monotonic counter for generating deterministic resolutionIds
   * Increments each time a resolutionId is needed for correlating check and damage entries
   */
  runtimeLogSeq?: number;

  gameOver?: {
    reason: "partyDead" | "playerDead";
    sceneId: SceneId;
  };
};

export type GameSave = {
  saveVersion: SaveVersion;

  createdAt?: string;
  updatedAt?: string;

  engineVersion?: string;
  platform?: string;

  story: { id: StoryId; version: StoryVersion };

  meta?: {
    xp?: number;
  };

  state: {
    flags: Record<string, boolean>;
    counters: Record<string, number>;
    runVariant?: any;
  };

  party: Party;

  actorsById: Record<ActorId, Actor>;

  /**
   * Only relevant items are persisted in saves:
   * - equipped items
   * - items in inventory
   * - (future) pending rewards / quest-required items
   */
  itemsById: Record<ItemId, ItemDefinition>;

  /**
   * Weapons and armor catalogs for equipped items
   */
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;

  runtime: GameRuntime;
};
