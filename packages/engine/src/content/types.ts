import type { Weapon, Armor } from "../runtime/types";

/**
 * Content Pack: defines base weapons, armors, and other content
 * Can be extended later with talents, traits, skills, items, etc.
 */
export type ContentPack = {
  id: string;
  weapons?: Weapon[];
  armors?: Armor[];
  // Future: talents?: Talent[];
  // Future: traits?: Trait[];
  // Future: skills?: Skill[];
  // Future: items?: Item[];
};

