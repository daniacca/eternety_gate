import type { StatKey } from "../runtime/types";

export type SkillId = string;
export type TalentId = string;
export type TraitId = string;
export type WeaponQualityId = string;

export type Skill = {
  id: SkillId;
  name: string;
  baseStat: StatKey;
  trainedOnly?: boolean;
  alternateStats?: StatKey[];
};

export type ResistanceType = "poison" | "magic" | "disease" | "fear";
export type MagicDiscipline = "PYRA" | "KINESIS" | "MENTIS" | "VATES" | "CORPUS";

export type Prerequisite =
  | { type: "statAtLeast"; stat: StatKey; value: number }
  | { type: "hasTalent"; talentId: TalentId }
  | { type: "hasTalentRank"; talentId: TalentId; minRank: number }
  | { type: "hasTrait"; traitId: TraitId }
  | { type: "hasSpell"; spellId: string }
  | { type: "notHasTalentWithParam"; talentId: TalentId; paramKey: string; paramValue: string };

export type Grant =
  | { type: "modifier"; key: string; op: "add"; value: number; valueRef?: string }
  | { type: "unlockAction"; actionId: string }
  | { type: "skillRank"; skillId: SkillId; value: number }
  | { type: "hpMaxFlat"; value: number }
  | { type: "hook"; hookId: string; params?: Record<string, any> };

export type TalentChosenParam = {
  paramKey: string;
  options: string[];
  label?: string;
};

export type Talent = {
  id: TalentId;
  name: string;
  description?: string;
  tier: 1 | 2 | 3;
  xpCost: number;
  prerequisites: Prerequisite[];
  grants: Grant[];
  maxRank?: number; // default 1
  // For talents that require choosing a type (e.g. Resistance, Casting Specialization)
  chosenParam?: TalentChosenParam;
  // Unique key to prevent stacking same choices (e.g., "resistance:<type>")
  uniquenessKey?: string;
};

export type TraitParams = Record<string, any>;

export type Trait = {
  id: TraitId;
  name: string;
  grants: Grant[];
  params?: Record<string, { type: string; required?: boolean; min?: number; max?: number }>;
};

export type WeaponQuality = {
  id: WeaponQualityId;
  name: string;
  description: string;
  paramsSchema?: Record<string, { type: string; required?: boolean; min?: number; max?: number }>;
  hooks?: string[];
};

export type CharacterCatalogs = {
  skills: Skill[];
  talents: Talent[];
  traits: Trait[];
};

export type GridDefinition = {
  id: string;
  width: number;
  height: number;
  defaults: {
    walkable: boolean;
    cover: "none" | "light" | "heavy";
    tileId: string;
  };
  cells?: Record<string, {
    walkable?: boolean;
    cover?: "none" | "light" | "heavy";
    tileId?: string;
  }>;
};

export type TileDefinition = {
  image?: string; // Single image (legacy support)
  images?: string[]; // Multiple variants for deterministic variation
};

export type TerrainCatalogs = {
  gridsById: Record<string, GridDefinition>;
  tilesById: Record<string, TileDefinition>;
};
