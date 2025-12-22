// Runtime Types for Eternity Gate Engine
// Copied from schemas/schemas.types.ts

/* ---------------------------------- */
/* ID Aliases                          */
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
/* Core Stats / Keys                   */
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
/* StoryPack Types                     */
/* ---------------------------------- */

export type SceneType = "narration" | "dialogue" | "hub" | "system" | "challenge" | "ending";

/* ---------- Conditions ---------- */

export type Condition =
  | { op: "flag"; path: string; value: boolean }
  | { op: "counterGte"; path: string; value: number }
  | { op: "counterLte"; path: string; value: number }
  | { op: "and"; clauses: Condition[] }
  | { op: "or"; clauses: Condition[] }
  | { op: "not"; clause: Condition };

/* ---------- Effects ---------- */

export type Effect =
  | { op: "setFlag"; path: string; value: boolean }
  | { op: "addCounter"; path: string; value: number }
  | { op: "addItem"; itemId: ItemId }
  | { op: "removeItem"; itemId: ItemId }
  | { op: "goto"; sceneId: SceneId }
  | { op: "conditionalEffects"; cases: Array<{ when: Condition; then: Effect[] }> }
  | { op: "chooseRunVariant"; source: string; strategy: "randomOrDefault" | "random" | "defaultOnly" }
  | { op: "applyVariantStartEffects" }
  | { op: "fireWorldEvents" }
  | {
      op: "combatStart";
      participantIds: ActorId[];
      grid: Grid;
      placements: Array<{ actorId: ActorId; x: number; y: number }>;
    }
  | { op: "combatMove"; dir: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" }
  | { op: "combatEndTurn" }
  | { op: "combatDefend" }
  | { op: "combatAim" };

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
    cover?: Cover; // ranged only
  };
  onHit?: Effect[];
  onMiss?: Effect[];
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
  weapons?: Weapon[];
  armors?: Armor[];

  scenes: Scene[];
};

/* ---------------------------------- */
/* Runtime: Items / Actors / Party     */
/* ---------------------------------- */

export type Weapon = {
  id: WeaponId;
  name: string;
  kind: "MELEE" | "RANGED";
  // damage: base d10 + add (we keep it simple)
  damage: {
    die: 10; // fixed 1d10 for now
    add: number; // e.g. +0, +2
    bonus?: "SB"; // melee adds Strength Bonus, ranged doesn't (for now)
  };
  // ranged only
  range?: {
    short: number; // in chebyshev squares, e.g. 4
    long: number; // e.g. 8
  };
  tags?: string[]; // future use
};

export type Armor = {
  id: ArmorId;
  name: string;
  soak: number; // flat damage reduction
  tags?: string[];
};

export type Equipment = {
  weaponId?: WeaponId | null;
  armorId?: ArmorId | null;
};

export type DamageTier = "Half" | "Single" | "Double" | "Triple" | "Fourfold" | "Fivefold";
export type ItemKind = "weapon" | "armor" | "accessory" | "consumable" | "quest";

/**
 * ItemMod:
 * - focus provides step-based (+10) bonuses to magic channeling/casting checks.
 *   (No PM exists in the system.)
 */
export type ItemMod =
  | { type: "focus"; channelBonus?: 10 | 20; castBonus?: 10 | 20 }
  | { type: "bonusStat"; stat: StatKey; value: number }
  | { type: "bonusSkill"; skill: string; value: number }
  | { type: "special"; id: string; value?: number };

export type Item = {
  id: ItemId;
  kind: ItemKind;
  name: string;
  tags: string[];
  mods: ItemMod[];

  // weapons
  damageTier?: DamageTier;

  // armor
  armorValue?: number;
};

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
    hpMax?: number;
    rfMax?: number;
  };

  resources: { hp: number; rf: number; peq: number };

  /**
   * Skills/Disciplines are stored without the "SKILL:" prefix here.
   * When referenced in checks, use key = `SKILL:<id>`.
   */
  skills: Record<string, number>;

  talents: string[];
  traits: string[];

  equipment: {
    // Legacy equipment system (kept for backward compatibility, but not populated for new actors)
    equipped?: {
      weaponMainId: ItemId | null;
      weaponOffId: ItemId | null;
      armorId: ItemId | null;
      accessoryIds: ItemId[];
    };
    // New minimal equipment system (single source of truth)
    weaponId?: WeaponId | null;
    armorId?: ArmorId | null;
  };

  status: {
    conditions: string[];
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

export type Grid = { width: number; height: number };
export type Position = { x: number; y: number };

export type CombatState = {
  active: boolean;
  participants: ActorId[];
  currentIndex: number;
  round: number;
  startedBySceneId?: SceneId;

  grid: Grid;
  positions: Record<ActorId, Position>;

  // economy semplificata "per-turn"
  turn: {
    moveRemaining: number; // steps left this turn
    actionAvailable: boolean; // true until an Action is spent
    stance?: "normal" | "defend"; // optional hook for later
  };
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
};

export type GameSave = {
  saveVersion: SaveVersion;

  createdAt?: string;
  updatedAt?: string;

  engineVersion?: string;
  platform?: string;

  story: { id: StoryId; version: StoryVersion };

  state: {
    flags: Record<string, boolean>;
    counters: Record<string, number>;
    inventory: { items: ItemId[] } & Record<string, any>;
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
  itemCatalogById: Record<ItemId, Item>;

  /**
   * Weapons and armor catalogs for equipped items
   */
  weaponsById: Record<WeaponId, Weapon>;
  armorsById: Record<ArmorId, Armor>;

  runtime: GameRuntime;
};
