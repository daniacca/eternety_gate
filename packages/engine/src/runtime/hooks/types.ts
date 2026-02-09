import type { Actor, Check, CheckResult, ConditionId, Effect, GameSave, StoryPack, StatOrSkillKey, Weapon } from "../types";
import type { IRNG } from "../rng";
import type { CharacterCatalogs } from "../../content/catalogs";

export type HookType =
  | "pre-check"
  | "post-check"
  | "pre-damage"
  | "pre-reduction"
  | "post-damage"
  | "pre-apply-damage"
  | "turn-start"
  | "turn-end";

export type HookValue = string | number | boolean | null;

export type HookPredicate = {
  fact: string;
  op?: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "notIn" | "truthy" | "falsy";
  value?: HookValue | HookValue[];
};

export type HookWhen = {
  all?: HookPredicate[];
  any?: HookPredicate[];
  none?: HookPredicate[];
};

export type HookEffect =
  | { op: "addCheckTargetMod"; value?: number; valueRef?: string }
  | { op: "addDamageMod"; value?: number; valueRef?: string }
  | { op: "addSoakMod"; value?: number; valueRef?: string }
  | { op: "addPenetrationMod"; value?: number; valueRef?: string }
  | { op: "addTouBonusMod"; value?: number; valueRef?: string }
  | { op: "addFinalDamageMod"; value?: number; valueRef?: string }
  | { op: "scaleDamage"; value: number }
  | { op: "scaleSoak"; value: number }
  | { op: "scalePenetration"; value: number }
  | { op: "scaleFinalDamage"; value: number }
  | { op: "addDamageExtraDice"; value?: number; valueRef?: string }
  | { op: "setDamageRollMode"; mode: "best" | "worst" | "normal" }
  | { op: "setDamageRerollOnes"; enabled: boolean }
  | { op: "enableDamageReroll"; threshold?: number }
  | { op: "blockCheck"; reason?: string }
  | { op: "blockDamage"; reason?: string }
  | { op: "addTag"; tag?: string; tagRef?: string }
  | { op: "logMessage"; message?: string; messageRef?: string }
  | { op: "emitEffect"; effect: Effect }
  | { op: "setRollMode"; mode: "best" | "worst" | "normal" }
  | { op: "setTurnState"; moveRemaining?: number; actionAvailable?: boolean }
  | { op: "resetCombatDamageTracking"; actor: "attacker" | "defender" }
  | { op: "removeExpiredConditions"; actor: "attacker" | "defender" }
  | {
      op: "gateCheck";
      actor: "attacker" | "defender";
      key: StatOrSkillKey;
      modifierRef?: string;
      failTag?: string;
      failLog?: string;
    }
  | { op: "consumeFateProtection"; actor: "attacker" | "defender" }
  | {
      op: "checkAndRemoveCondition";
      actor: "attacker" | "defender";
      key: StatOrSkillKey;
      difficulty?: string;
      modifierRef?: string;
      checkIdRef?: string;
      condition: ConditionId;
      onSuccessLogRef?: string;
      onFailureLogRef?: string;
    }
  | {
      op: "addCondition";
      actor: "attacker" | "defender";
      condition: ConditionId;
      stacks?: number;
      stacksRef?: string;
      durationTurns?: number;
      durationTurnsRef?: string;
      source?: string;
    }
  | {
      op: "applyDirectDamage";
      actor: "attacker" | "defender";
      amount?: number;
      amountRef?: string;
      rollMin?: number;
      rollMax?: number;
      logMessageRef?: string;
      trackSelfDamage?: boolean;
    }
  | {
      op: "checkAndDamage";
      actor: "attacker" | "defender";
      key: StatOrSkillKey;
      modifierRef?: string;
      difficulty?: string;
      checkIdRef?: string;
      onSuccessLogRef?: string;
      onFailureLogRef?: string;
      damageBase?: number;
      damageBaseRef?: string;
      damageRollMin?: number;
      damageRollMax?: number;
      addDof?: boolean;
      damageLogRef?: string;
      runtimeLogMessageRef?: string;
      runtimeLogTags?: string[];
      runtimeLogTagRef?: string;
      includeDamageTag?: boolean;
    };

export type HookDefinition = {
  id: string;
  type: HookType;
  ref?: {
    type: "condition" | "talent" | "trait" | "spell" | "weaponQuality" | "effect" | "system";
    id: string;
  };
  priority?: number;
  when?: HookWhen;
  effects: HookEffect[];
};

export type HookContext = {
  save: GameSave;
  storyPack?: StoryPack;
  catalogs?: CharacterCatalogs;
  rng?: IRNG;
  check?: Check;
  result?: CheckResult | null;
  attacker?: Actor;
  defender?: Actor;
  weapon?: Weapon | null;
  weaponForHitEffects?: Weapon | null;
  weaponQualityCatalog?: Record<string, { hooks?: HookDefinition[] }>;
  spellId?: string;
  effectId?: string;
  rawDamage?: number;
  finalDamage?: number;
  soak?: number;
  penetration?: number;
  facts?: Record<string, HookValue>;
  turnCounter?: number;
  didApplyDamage?: boolean;
  isUnarmed?: boolean;
  isNaturalWeaponAttack?: boolean;
  resultDos?: number;
  resolutionId?: string;
  effects?: Effect[];
};

export type HookRunResult = {
  save: GameSave;
  blocked?: boolean;
  blockReason?: string;
  checkResult?: CheckResult | null;
  rollMode?: "best" | "worst" | "normal";
  checkTargetMod: number;
  damageMod: number;
  damageMultiplier: number;
  damageExtraDice: number;
  damageRollMode?: "best" | "worst" | "normal";
  damageRerollOnes: boolean;
  damageRerollThreshold?: number;
  allowDamageReroll: boolean;
  soakMod: number;
  soakMultiplier: number;
  penetrationMod: number;
  penetrationMultiplier: number;
  touBonusMod: number;
  finalDamageMod: number;
  finalDamageMultiplier: number;
  tags: string[];
  effects: Effect[];
  logs: string[];
  actorDied?: boolean;
  turnStateOverride?: {
    moveRemaining?: number;
    actionAvailable?: boolean;
  };
};
