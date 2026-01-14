import type { Weapon, Armor } from "../runtime/types";
import type { Skill, Talent, Trait, GridDefinition, TileDefinition } from "./catalogs";

/**
 * Content Pack: defines base weapons, armors, and other content
 */
export type ContentPack = {
  id: string;
  weapons?: Weapon[];
  armors?: Armor[];
  skills?: Skill[];
  talents?: Talent[];
  traits?: Trait[];
  grids?: GridDefinition[];
  tiles?: Record<string, TileDefinition>;
};

