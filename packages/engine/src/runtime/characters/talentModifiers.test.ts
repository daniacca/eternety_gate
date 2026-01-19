import { describe, it, expect } from "vitest";
import type { GameSave, Actor } from "../types";
import type { CharacterCatalogs, Talent } from "../../content/catalogs";
import {
  hasTalentHook,
  getShieldMasteryParryBonus,
  getCrushingBlowDamageBonus,
  getDeathdealerDamageBonus,
  hasMarksmanTalent,
  hasDeadeyeTalent,
  getFatiguePenaltyReduction,
  getResistanceBonus,
  getCastingSpecializationBonus,
  getMeleeDamageBonusFromTalents,
  getRangedDamageBonusFromTalents,
} from "./talentModifiers";

// Helper to create minimal actor
function createActor(id: string, talents: Record<string, number> = {}, stats: Partial<Record<string, number>> = {}): Actor {
  return {
    id,
    name: `Test Actor ${id}`,
    kind: "PC",
    stats: {
      STR: stats.STR ?? 40,
      TOU: stats.TOU ?? 40,
      AGI: stats.AGI ?? 40,
      INT: stats.INT ?? 40,
      WIL: stats.WIL ?? 40,
      CHA: stats.CHA ?? 40,
      WS: stats.WS ?? 40,
      BS: stats.BS ?? 40,
      INI: stats.INI ?? 40,
      PER: stats.PER ?? 40,
    },
    resources: {
      wounds: 0,
      rf: 0,
    },
    skills: {},
    talents,
    traits: {},
    equipment: {},
    status: {
      conditions: [],
      tempModifiers: [],
    },
  };
}

// Helper to create minimal save
function createSave(actors: Actor[]): GameSave {
  const actorsById: Record<string, Actor> = {};
  actors.forEach(a => actorsById[a.id] = a);
  
  return {
    saveVersion: "1.0.0",
    story: { id: "test", version: "1.0.0" },
    state: { flags: {}, counters: {} },
    party: { actors: actors.map(a => a.id), activeActorId: actors[0]?.id || "" },
    actorsById,
    itemsById: {},
    weaponsById: {},
    armorsById: {},
    runtime: {
      currentSceneId: "test",
      rngSeed: 12345,
      history: { visitedScenes: [], chosenChoices: [] },
      firedWorldEvents: [],
    },
  };
}

// Helper to create catalogs with specific talents
function createCatalogs(talents: Talent[]): CharacterCatalogs {
  return {
    skills: [],
    talents,
    traits: [],
  };
}

// Test talents
const shieldMasteryTalent: Talent = {
  id: "talent:shield_mastery",
  name: "Shield Mastery",
  tier: 1,
  xpCost: 500,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.shieldMasteryParryBonus", op: "add", value: 10 }],
  maxRank: 2,
};

const combatMasterTalent: Talent = {
  id: "talent:combat_master",
  name: "Combat Master",
  tier: 2,
  xpCost: 1000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.meleeToBeHitPenalty", op: "add", value: -20 }],
  maxRank: 1,
};

const crushingBlowTalent: Talent = {
  id: "talent:crushing_blow",
  name: "Crushing Blow",
  tier: 3,
  xpCost: 2000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.crushingBlowDamageBonus", op: "add", value: 1 }],
  maxRank: 1,
};

const deathdealerTalent: Talent = {
  id: "talent:deathdealer",
  name: "Deathdealer",
  tier: 3,
  xpCost: 2000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.deathdealerDamageBonus", op: "add", value: 1 }],
  maxRank: 1,
};

const marksmanTalent: Talent = {
  id: "talent:marksman",
  name: "Marksman",
  tier: 2,
  xpCost: 1000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.marksmanIgnoreDistance", op: "add", value: 1 }],
  maxRank: 1,
};

const deadeyeTalent: Talent = {
  id: "talent:deadeye",
  name: "Deadeye",
  tier: 3,
  xpCost: 2000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.deadeyeIgnoreCover", op: "add", value: 1 }],
  maxRank: 1,
};

const relentlessTalent: Talent = {
  id: "talent:relentless",
  name: "Relentless",
  tier: 1,
  xpCost: 500,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.fatiguePenaltyReduction", op: "add", value: 1 }],
  maxRank: 1,
};

const leapUpTalent: Talent = {
  id: "talent:leap_up",
  name: "Leap Up",
  tier: 1,
  xpCost: 500,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.leapUp", op: "add", value: 1 }],
  maxRank: 1,
};

const resistanceTalent: Talent = {
  id: "talent:resistance",
  name: "Resistance",
  tier: 1,
  xpCost: 500,
  prerequisites: [],
  grants: [{ type: "modifier", key: "combat.resistance.<chosenType>", op: "add", value: 10 }],
  maxRank: 1,
  chosenParam: { paramKey: "chosenType", options: ["poison", "magic", "disease", "fear"] },
  uniquenessKey: "resistance:<chosenType>",
};

const channellingFocusTalent: Talent = {
  id: "talent:channelling_focus",
  name: "Channelling Focus",
  tier: 1,
  xpCost: 500,
  prerequisites: [],
  grants: [{ type: "modifier", key: "magic.channelBonus", op: "add", value: 10 }],
  maxRank: 1,
};

const castingSpecTalent: Talent = {
  id: "talent:casting_specialization",
  name: "Casting Specialization",
  tier: 2,
  xpCost: 1000,
  prerequisites: [],
  grants: [{ type: "modifier", key: "magic.castBonus.<chosenDiscipline>", op: "add", value: 10 }],
  maxRank: 1,
  chosenParam: { paramKey: "chosenDiscipline", options: ["PYRA", "KINESIS", "MENTIS", "VATES", "CORPUS"] },
  uniquenessKey: "castingSpec:<chosenDiscipline>",
};

const dieHardTalent: Talent = {
  id: "talent:die_hard",
  name: "Die Hard",
  tier: 2,
  xpCost: 1000,
  prerequisites: [],
  grants: [{ type: "hook", hookId: "dieHard" }],
  maxRank: 1,
};

describe("Shield Mastery", () => {
  it("should return +10 parry per rank when shield equipped", () => {
    const actor = createActor("PC_1", { "talent:shield_mastery": 1 });
    // Add shield to off-hand
    actor.equipment = { offHand: { kind: "item", id: "shield:basic" } };

    const save = {
      ...createSave([actor]),
      itemsById: {
        "shield:basic": {
          id: "shield:basic",
          name: "Basic Shield",
          type: "wearable" as const,
          slot: "offHand" as const,
          weight: 2,
          tags: ["shield"],
          shield: { soak: 1 },
        },
      },
    };
    const catalogs = createCatalogs([shieldMasteryTalent]);
    
    const bonus = getShieldMasteryParryBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(10);
  });

  it("should return +20 parry at rank 2", () => {
    const actor = createActor("PC_1", { "talent:shield_mastery": 2 });
    actor.equipment = { offHand: { kind: "item", id: "shield:basic" } };

    const save = {
      ...createSave([actor]),
      itemsById: {
        "shield:basic": {
          id: "shield:basic",
          name: "Basic Shield",
          type: "wearable" as const,
          slot: "offHand" as const,
          weight: 2,
          tags: ["shield"],
          shield: { soak: 1 },
        },
      },
    };
    const catalogs = createCatalogs([shieldMasteryTalent]);
    
    const bonus = getShieldMasteryParryBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(20);
  });

  it("should return 0 without shield equipped", () => {
    const actor = createActor("PC_1", { "talent:shield_mastery": 1 });
    // No shield equipped
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([shieldMasteryTalent]);
    
    const bonus = getShieldMasteryParryBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(0);
  });
});

describe("Crushing Blow", () => {
  it("should add ceil(WSB/2) to melee damage", () => {
    // WS 40 = WSB 4, so ceil(4/2) = 2
    const actor = createActor("PC_1", { "talent:crushing_blow": 1 }, { WS: 40 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([crushingBlowTalent]);
    
    const bonus = getCrushingBlowDamageBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(2); // ceil(4/2)
  });

  it("should round up for odd WSB", () => {
    // WS 50 = WSB 5, so ceil(5/2) = 3
    const actor = createActor("PC_1", { "talent:crushing_blow": 1 }, { WS: 50 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([crushingBlowTalent]);
    
    const bonus = getCrushingBlowDamageBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(3); // ceil(5/2)
  });

  it("should return 0 without talent", () => {
    const actor = createActor("PC_1", {}, { WS: 40 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([crushingBlowTalent]);
    
    const bonus = getCrushingBlowDamageBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(0);
  });
});

describe("Deathdealer", () => {
  it("should add PER bonus to damage", () => {
    // PER 40 = PER bonus 4
    const actor = createActor("PC_1", { "talent:deathdealer": 1 }, { PER: 40 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([deathdealerTalent]);
    
    const bonus = getDeathdealerDamageBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(4);
  });

  it("should return 0 without talent", () => {
    const actor = createActor("PC_1", {}, { PER: 40 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([deathdealerTalent]);
    
    const bonus = getDeathdealerDamageBonus(save, catalogs, "PC_1");
    expect(bonus).toBe(0);
  });
});

describe("Marksman", () => {
  it("should return true when actor has Marksman talent", () => {
    const actor = createActor("PC_1", { "talent:marksman": 1 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([marksmanTalent]);
    
    const has = hasMarksmanTalent(save, catalogs, "PC_1");
    expect(has).toBe(true);
  });

  it("should return false without talent", () => {
    const actor = createActor("PC_1", {});
    const save = createSave([actor]);
    const catalogs = createCatalogs([marksmanTalent]);
    
    const has = hasMarksmanTalent(save, catalogs, "PC_1");
    expect(has).toBe(false);
  });
});

describe("Deadeye", () => {
  it("should return true when actor has Deadeye talent", () => {
    const actor = createActor("PC_1", { "talent:deadeye": 1 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([deadeyeTalent]);
    
    const has = hasDeadeyeTalent(save, catalogs, "PC_1");
    expect(has).toBe(true);
  });
});

describe("Relentless", () => {
  it("should reduce fatigue penalty tier by 1", () => {
    const actor = createActor("PC_1", { "talent:relentless": 1 });
    const save = createSave([actor]);
    const catalogs = createCatalogs([relentlessTalent]);
    
    const reduction = getFatiguePenaltyReduction(save, catalogs, "PC_1");
    expect(reduction).toBe(1);
  });

  it("should return 0 without talent", () => {
    const actor = createActor("PC_1", {});
    const save = createSave([actor]);
    const catalogs = createCatalogs([relentlessTalent]);
    
    const reduction = getFatiguePenaltyReduction(save, catalogs, "PC_1");
    expect(reduction).toBe(0);
  });
});

describe("Resistance", () => {
  it("should apply +10 to resistance checks for chosen type", () => {
    const actor = createActor("PC_1", { "talent:resistance": 1 });
    // Add talent params for poison resistance
    (actor as any).talentParams = { "talent:resistance": { chosenType: "poison" } };
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([resistanceTalent]);
    
    const bonus = getResistanceBonus(save, catalogs, "PC_1", "poison");
    expect(bonus).toBe(10);
  });

  it("should return 0 for different resistance type", () => {
    const actor = createActor("PC_1", { "talent:resistance": 1 });
    (actor as any).talentParams = { "talent:resistance": { chosenType: "poison" } };
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([resistanceTalent]);
    
    // Check magic resistance when we have poison resistance
    const bonus = getResistanceBonus(save, catalogs, "PC_1", "magic");
    expect(bonus).toBe(0);
  });
});

describe("Casting Specialization", () => {
  it("should apply +10 to cast checks for chosen discipline", () => {
    const actor = createActor("PC_1", { "talent:casting_specialization": 1 });
    (actor as any).talentParams = { "talent:casting_specialization": { chosenDiscipline: "PYRA" } };
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([castingSpecTalent]);
    
    const bonus = getCastingSpecializationBonus(save, catalogs, "PC_1", "PYRA");
    expect(bonus).toBe(10);
  });

  it("should return 0 for different discipline", () => {
    const actor = createActor("PC_1", { "talent:casting_specialization": 1 });
    (actor as any).talentParams = { "talent:casting_specialization": { chosenDiscipline: "PYRA" } };
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([castingSpecTalent]);
    
    const bonus = getCastingSpecializationBonus(save, catalogs, "PC_1", "KINESIS");
    expect(bonus).toBe(0);
  });
});

describe("hasTalentHook", () => {
  it("should return true when actor has Die Hard talent", () => {
    const actor = createActor("PC_1", { "talent:die_hard": 1 });
    const catalogs = createCatalogs([dieHardTalent]);
    
    const has = hasTalentHook(actor, catalogs, "dieHard");
    expect(has).toBe(true);
  });

  it("should return false without talent", () => {
    const actor = createActor("PC_1", {});
    const catalogs = createCatalogs([dieHardTalent]);
    
    const has = hasTalentHook(actor, catalogs, "dieHard");
    expect(has).toBe(false);
  });
});

describe("getMeleeDamageBonusFromTalents", () => {
  it("should combine Crushing Blow and Deathdealer bonuses", () => {
    // WS 40 = WSB 4, PER 60 = PER bonus 6
    // Crushing Blow: ceil(4/2) = 2
    // Deathdealer: 6
    // Total: 8
    const actor = createActor("PC_1", { 
      "talent:crushing_blow": 1, 
      "talent:deathdealer": 1 
    }, { WS: 40, PER: 60 });
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([crushingBlowTalent, deathdealerTalent]);
    
    const bonus = getMeleeDamageBonusFromTalents(save, catalogs, "PC_1");
    expect(bonus).toBe(8); // 2 + 6
  });
});

describe("getRangedDamageBonusFromTalents", () => {
  it("should only include Deathdealer for ranged", () => {
    // PER 60 = PER bonus 6
    // Only Deathdealer applies to ranged (Crushing Blow is melee only)
    const actor = createActor("PC_1", { 
      "talent:crushing_blow": 1, 
      "talent:deathdealer": 1 
    }, { WS: 40, PER: 60 });
    
    const save = createSave([actor]);
    const catalogs = createCatalogs([crushingBlowTalent, deathdealerTalent]);
    
    const bonus = getRangedDamageBonusFromTalents(save, catalogs, "PC_1");
    expect(bonus).toBe(6); // Only Deathdealer
  });
});
