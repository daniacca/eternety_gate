import type { Effect, GameSave, StoryPack } from "../types";

export function getCombatOutcomeFromTags(tags?: string[]): "victory" | "defeat" | null {
  if (!tags) return null;
  const tag = tags.find((entry) => entry.startsWith("combat:outcome="));
  if (!tag) return null;
  const [, outcome] = tag.split("=");
  if (outcome === "victory" || outcome === "defeat") {
    return outcome;
  }
  return null;
}

export function getCombatEndEffects(storyPack: StoryPack, save: GameSave): Effect[] {
  const endedSceneId = save.runtime.combatEndedSceneId;
  if (!endedSceneId) return [];

  const scene = storyPack.scenes.find((entry) => entry.id === endedSceneId);
  if (!scene?.combatEnd) return [];

  const outcome = getCombatOutcomeFromTags(save.runtime.lastCheck?.tags);
  const hooks = scene.combatEnd;

  return [
    ...(hooks.onAny ?? []),
    ...(outcome === "victory" ? hooks.onVictory ?? [] : []),
    ...(outcome === "defeat" ? hooks.onDefeat ?? [] : []),
  ];
}
