import type { StoryPack } from "../../../types";
import { loadCharacterCatalogs } from "../../../../content/loadCatalogs";

export function loadCatalogsForAttack(
  storyPack: StoryPack,
): ReturnType<typeof loadCharacterCatalogs> | undefined {
  return storyPack?.skills || storyPack?.talents || storyPack?.traits
    ? loadCharacterCatalogs({
        id: storyPack.id,
        items: storyPack.items || [],
        weapons: storyPack.weapons || [],
        armors: storyPack.armors || [],
        skills: storyPack.skills || [],
        talents: storyPack.talents || [],
        traits: storyPack.traits || [],
      })
    : undefined;
}
