import type { StatKey } from "../runtime/types";

export type SkillId = string;
export type TalentId = string;
export type TraitId = string;

export type Skill = {
  id: SkillId;
  name: string;
  baseStat: StatKey;
  trainedOnly?: boolean;
  alternateStats?: StatKey[];
};

export type Prerequisite =
  | { type: "statAtLeast"; stat: StatKey; value: number }
  | { type: "hasTalent"; talentId: TalentId }
  | { type: "hasTrait"; traitId: TraitId }
  | { type: "hasSpell"; spellId: string };

export type Grant =
  | { type: "modifier"; key: string; op: "add"; value: number; valueRef?: string }
  | { type: "unlockAction"; actionId: string }
  | { type: "skillRank"; skillId: SkillId; value: number }
  | { type: "hpMaxFlat"; value: number };

export type Talent = {
  id: TalentId;
  name: string;
  tier: 1 | 2 | 3;
  xpCost: number;
  prerequisites: Prerequisite[];
  grants: Grant[];
  maxRank?: number; // default 1
};

export type TraitParams = Record<string, any>;

export type Trait = {
  id: TraitId;
  name: string;
  grants: Grant[];
  params?: Record<string, { type: string; required?: boolean; min?: number; max?: number }>;
};

export type CharacterCatalogs = {
  skills: Skill[];
  talents: Talent[];
  traits: Trait[];
};

