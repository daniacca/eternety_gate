import sigilContent from "../sigil.content.json";
import skillsCatalog from "./catalogs/skills.json";
import talentsCatalog from "./catalogs/talents.json";
import traitsCatalog from "./catalogs/traits.json";
import spellsCatalog from "./catalogs/spells.json";
import effectsCatalog from "./catalogs/effects.json";
import gridsCatalog from "./catalogs/grids.json";
import tilesCatalog from "./catalogs/tiles.json";
import weaponsCatalog from "./catalogs/weapons.json";
import weaponQualitiesCatalog from "./catalogs/weapon_qualities.json";
import armorsCatalog from "./catalogs/armors.json";
import itemsCatalog from "./catalogs/items.json";
import bestiaryCatalog from "./catalogs/bestiary.json";
import type { ContentPack } from "@eg/engine";

export const sigilContentPack: ContentPack = {
  ...sigilContent,
  skills: skillsCatalog,
  talents: talentsCatalog,
  traits: traitsCatalog,
  spells: spellsCatalog,
  effects: effectsCatalog,
  items: itemsCatalog,
  weapons: weaponsCatalog,
  weaponQualities: weaponQualitiesCatalog,
  armors: armorsCatalog,
  grids: gridsCatalog.grids,
  tiles: tilesCatalog.tiles,
};

// Export individual catalogs
export {
  spellsCatalog,
  effectsCatalog,
  skillsCatalog,
  talentsCatalog,
  traitsCatalog,
  gridsCatalog,
  tilesCatalog,
  itemsCatalog,
  weaponsCatalog,
  weaponQualitiesCatalog,
  armorsCatalog,
  bestiaryCatalog,
};

