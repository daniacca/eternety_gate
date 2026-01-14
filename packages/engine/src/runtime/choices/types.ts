import type { Choice, StoryPack, GameSave } from "../types";
import type { IRNG } from "../rng";
import type { ContentPack } from "../../content/types";

/**
 * Choice handler function type
 */
export type ChoiceHandler = (
  choice: Choice,
  choiceId: string,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
  contentPack?: ContentPack
) => GameSave;

/**
 * Inferred choice kind based on content
 */
export type ChoiceKind = "generic" | "check" | "combat";
