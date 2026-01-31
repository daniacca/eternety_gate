import type { GameSave, StoryPack, ActorId } from "../../../types";
import type { IRNG } from "../../../rng";
import type { CharacterCatalogs } from "../../../../content/catalogs";
import type { TargetSelection } from "../../targeting/types";
import { getCharacteristicBonus } from "../../../characters/bonuses";
import { applyFatigue } from "../../../characters/fatigue";
import { hasCondition } from "../../../conditions";
import { getSpellById, getEffectById } from "../../../magic/catalogs";
import { applySpellConditionsAndMovement } from "./conditions";
import { applySpellDamageAndHealing } from "./damage";
import { handleSpecialOp } from "./specialOps";
import { resolveSpellTargets } from "./targeting";

type SpellEffectApplyParams = {
  save: GameSave;
  storyPack: StoryPack;
  rng: IRNG;
  catalogs?: CharacterCatalogs;
  combat: NonNullable<GameSave["runtime"]["combat"]>;
  turnActorId: ActorId;
  spell: ReturnType<typeof getSpellById>;
  effectDef: ReturnType<typeof getEffectById>;
  cnBase: number;
  effectiveDoS: number;
  overcast: number;
  resolutionId: string;
  targetSelection: TargetSelection;
  phenomenaResult?: { save: GameSave; kind: string; description: string } | null;
  skipPhenomenaTargetRandomization?: boolean;
};

export function applySpellEffectsForCast(params: SpellEffectApplyParams): GameSave {
  let updatedSave = params.save;
  const {
    spell,
    effectDef,
  } = params;

  if (!spell || !effectDef) {
    return updatedSave;
  }

  return applySpellEffectsForCastRefactored(params);
}

function applySpellEffectsForCastRefactored(params: SpellEffectApplyParams): GameSave {
  let updatedSave = params.save;
  const {
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    overcast,
    resolutionId,
    phenomenaResult,
    skipPhenomenaTargetRandomization,
  } = params;
  let targetSelection: TargetSelection = params.targetSelection;

  if (!spell || !effectDef) {
    return updatedSave;
  }

  const effectStatKey = effectDef.effectStat ?? effectDef.castingStat;
  const effectStatBonus = getCharacteristicBonus(updatedSave, turnActorId, effectStatKey, catalogs);

  const targetResolution = resolveSpellTargets({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    overcast,
    effectStatBonus,
    targetSelection,
    phenomenaResult,
    skipPhenomenaTargetRandomization,
    resolutionId
  });
  if (targetResolution.handled) {
    return targetResolution.save;
  }

  updatedSave = targetResolution.save;
  targetSelection = targetResolution.targetSelection;

  const { validTargetActors, getOvercastForTarget, terrainContentPack } = targetResolution;

  const specialOpResult = handleSpecialOp({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    overcast,
    effectStatBonus,
    targetSelection,
    validTargetActors,
    getOvercastForTarget,
    terrainContentPack,
  });
  if (specialOpResult.handled) {
    return specialOpResult.save;
  }
  updatedSave = specialOpResult.save;

  updatedSave = applySpellDamageAndHealing({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    effectiveDoS,
    resolutionId,
    effectStatBonus,
    validTargetActors,
    getOvercastForTarget,
    getMagicRollMode,
    applyFatigue,
  });

  updatedSave = applySpellConditionsAndMovement({
    save: updatedSave,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    resolutionId,
    effectStatBonus,
    effectiveDoS,
    validTargetActors,
    getOvercastForTarget,
    terrainContentPack,
    getMagicRollMode,
  });

  return updatedSave;
}

function getMagicRollMode(actor: { conditions?: Partial<Record<string, any>> } | undefined): "best" | "worst" | "normal" {
  if (!actor) return "normal";
  const hasPrecognition = hasCondition(actor as any, "precognition");
  const hasMisfortune = hasCondition(actor as any, "misfortune");
  if (hasPrecognition && !hasMisfortune) return "best";
  if (hasMisfortune && !hasPrecognition) return "worst";
  return "normal";
}
