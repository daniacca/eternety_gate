import type { Choice, StoryPack, GameSave, ActorId } from "../types";
import type { IRNG } from "../rng";
import type { ContentPack } from "../../content/types";
import type { NarrativeOp } from "../magic/types";

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
export type ChoiceKind = "generic" | "check" | "combat" | "magic";

/**
 * Magic choice target specification
 */
export type MagicChoiceTarget = {
  type: "self" | "singleActor" | "scene";
  actorId?: ActorId; // For singleActor target
};

/**
 * Extended choice with magic properties
 */
export type MagicChoice = Choice & {
  spellId: string;
  magicTarget?: MagicChoiceTarget;
  minDoS?: number; // Minimum DoS required for "success" branch
  onMagicSuccess?: {
    goto?: string;
    setFlags?: Record<string, boolean>;
    narrativeOps?: NarrativeOp[];
  };
  onMagicFailure?: {
    goto?: string;
    setFlags?: Record<string, boolean>;
    narrativeOps?: NarrativeOp[];
  };
};
