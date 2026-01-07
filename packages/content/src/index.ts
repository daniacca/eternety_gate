import sigilContent from "../sigil.content.json";
import skillsCatalog from "./catalogs/skills.json";
import talentsCatalog from "./catalogs/talents.json";
import traitsCatalog from "./catalogs/traits.json";
import type { ContentPack } from "@eg/engine";

export const sigilContentPack: ContentPack = {
  ...sigilContent,
  skills: skillsCatalog,
  talents: talentsCatalog,
  traits: traitsCatalog,
};

