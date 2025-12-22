import { evaluateConditions } from "./conditions";
import type { StoryPack, GameSave, Scene } from "./types";

/**
 * Gets the current scene and resolved text blocks
 */

export function getCurrentScene(storyPack: StoryPack, save: GameSave): { scene: Scene; text: string[] } {
  const scene = storyPack.scenes.find((s) => s.id === save.runtime.currentSceneId);
  if (!scene) {
    throw new Error(`Scene not found: ${save.runtime.currentSceneId}`);
  }

  // Start with base text
  const text: string[] = [...scene.text];

  // Add conditional text blocks
  if (scene.textBlocks) {
    for (const block of scene.textBlocks) {
      if (evaluateConditions(block.conditions, save)) {
        text.push(...block.text);
      }
    }
  }

  return { scene, text };
}
