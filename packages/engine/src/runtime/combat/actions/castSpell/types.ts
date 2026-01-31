import type { ActorId, GameSave, StoryPack } from "../../../types";
import type { CharacterCatalogs } from "../../../../content/catalogs";
import type { IRNG } from "../../../rng";
import type { TargetSelection, TargetPreview, TargetSpec } from "../../targeting/types";
import type { ContentPack } from "../../../../content/types";
import type { getSpellById, getEffectById } from "../../../magic/catalogs";

type SpellDef = NonNullable<ReturnType<typeof getSpellById>>;
type EffectDef = NonNullable<ReturnType<typeof getEffectById>>;

export type TargetResolutionParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: SpellDef;
  effectDef: EffectDef;
  cnBase: number;
  effectiveDoS: number;
  overcast: number;
  resolutionId: string;
  effectStatBonus: number;
  targetSelection: TargetSelection;
  phenomenaResult?: { save: GameSave; kind: string; description: string } | null;
  skipPhenomenaTargetRandomization?: boolean;
};

export type TargetResolutionResult =
  | {
      handled: true;
      save: GameSave;
    }
  | {
      handled: false;
      save: GameSave;
      targetSelection: TargetSelection;
      targetPreview: TargetPreview;
      targetActors: Array<{ actorId: ActorId; actor: GameSave["actorsById"][string] }>;
      validTargetActors: Array<{ actorId: ActorId; actor: GameSave["actorsById"][string] }>;
      targetOvercastById: Map<ActorId, number>;
      getOvercastForTarget: (actorId: ActorId) => number;
      terrainContentPack?: ContentPack;
      spellTargetSpec: TargetSpec;
    };

export type SpecialOpParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: SpellDef;
  effectDef: EffectDef;
  cnBase: number;
  effectiveDoS: number;
  overcast: number;
  effectStatBonus: number;
  targetSelection: TargetSelection;
  validTargetActors: Array<{ actorId: ActorId; actor: GameSave["actorsById"][string] }>;
  getOvercastForTarget: (actorId: ActorId) => number;
  terrainContentPack?: ContentPack;
};

export type SpecialOpResult = {
  handled: boolean;
  save: GameSave;
};

export type SpellDamageParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: SpellDef;
  effectDef: EffectDef;
  cnBase: number;
  effectiveDoS: number;
  resolutionId: string;
  effectStatBonus: number;
  validTargetActors: Array<{ actorId: ActorId; actor: GameSave["actorsById"][string] }>;
  getOvercastForTarget: (actorId: ActorId) => number;
  getMagicRollMode: (actor: GameSave["actorsById"][string]) => "best" | "worst" | "normal";
  applyFatigue: (save: GameSave, actorId: ActorId, amount: number, catalogs?: CharacterCatalogs) => GameSave;
};

export type SpellConditionParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: SpellDef;
  effectDef: EffectDef;
  resolutionId: string;
  effectStatBonus: number;
  effectiveDoS: number;
  validTargetActors: Array<{ actorId: ActorId; actor: GameSave["actorsById"][string] }>;
  getOvercastForTarget: (actorId: ActorId) => number;
  terrainContentPack?: ContentPack;
  getMagicRollMode: (actor: GameSave["actorsById"][string] | undefined) => "best" | "worst" | "normal";
};
