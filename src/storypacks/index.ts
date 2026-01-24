import type { StoryPack } from "@eg/engine";
import brunholt from "../../stories/brunholt.story.json";
import sigilHub from "../../stories/sigil_hub.story.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";
import gridsCatalog from "@eg/content/src/catalogs/grids.json";
import tilesCatalog from "@eg/content/src/catalogs/tiles.json";

export const STORY_PACKS: Record<string, StoryPack> = {
  [sigilHub.id]: sigilHub as StoryPack,
  [brunholt.id]: brunholt as StoryPack,
};

export const getStoryPackById = (storyId: string): StoryPack | null => {
  return STORY_PACKS[storyId] ?? null;
};

export const withCatalogs = (storyPack: StoryPack): StoryPack => ({
  ...(storyPack as StoryPack),
  skills: skillsCatalog as any,
  talents: talentsCatalog as any,
  traits: traitsCatalog as any,
  grids: gridsCatalog.grids as any,
  tiles: tilesCatalog.tiles as any,
});
