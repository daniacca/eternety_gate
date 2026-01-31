import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG } from "../rng";

export function applyChooseRunVariant(
  effect: Extract<Effect, { op: "chooseRunVariant" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const variants = storyPack.systems.runVariants || [];
  if (variants.length === 0) {
    return { save };
  }

  let selectedVariant: (typeof variants)[0] | null = null;

  switch (effect.strategy) {
    case "randomOrDefault": {
      const defaultVariant = variants.find((v) => v.id === "VAR_DEFAULT");
      if (defaultVariant) {
        selectedVariant = defaultVariant;
      } else if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case "random": {
      if (variants.length > 0) {
        selectedVariant = variants[rng.nextInt(0, variants.length - 1)];
      }
      break;
    }

    case "defaultOnly": {
      selectedVariant = variants.find((v) => v.id === "VAR_DEFAULT") || null;
      break;
    }
  }

  if (selectedVariant) {
    const newState = {
      ...save.state,
      runVariant: {
        id: selectedVariant.id,
        tags: selectedVariant.tags || [],
      },
    };

    return {
      save: {
        ...save,
        state: newState,
      },
    };
  }

  return { save };
}

export function applyVariantStartEffects(
  storyPack: StoryPack,
  save: GameSave,
  _rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const variantId = save.state.runVariant?.id;
  if (!variantId) {
    return { save };
  }

  const variants = storyPack.systems.runVariants || [];
  const variant = variants.find((v) => v.id === variantId);
  if (!variant || !variant.startEffects) {
    return { save };
  }

  return { save, emittedEffects: variant.startEffects };
}

