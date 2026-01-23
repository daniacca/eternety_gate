import { describe, it, expect } from "vitest";
import { getNaturalWeaponProfile } from "./naturalWeapons";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Trait } from "../../content/catalogs";

describe("naturalWeapons", () => {
  const storyPack = makeTestStoryPack();

  const createCatalogsWithNaturalWeapons: () => CharacterCatalogs = () => {
    const trait: Trait = {
      id: "trait:natural_weapons",
      name: "Natural Weapons",
      grants: [
        {
          type: "modifier",
          key: "combat.hasNaturalWeapons",
          op: "add",
          value: 1,
        },
      ],
    };

    return {
      skills: [],
      talents: [],
      traits: [trait],
    };
  };

  describe("getNaturalWeaponProfile", () => {
    it("should return null when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      expect(getNaturalWeaponProfile(save, catalogs, "NPC_1")).toBeNull();
    });

    it("should return null when actor does not have natural weapons trait", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {},
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      expect(getNaturalWeaponProfile(save, catalogs, "PC_1")).toBeNull();
    });

    it("should return profile for size <= 2", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 1 },
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "fixed", add: 1, bonus: "SB" },
        damageType: "rendering",
        penetration: 0,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should return profile for size <= 4", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 4 },
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "half", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 1,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should return profile for size 5", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 5 },
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "single", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 2,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should return profile for size <= 7", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 7 },
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "double", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 4,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should return profile for size > 7", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 10 },
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "triple", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 6,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should default to size 4 when no size trait is present", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "half", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 1,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should default to size 4 when size trait has invalid structure", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": "invalid" as any,
          "trait:natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile).toEqual({
        id: "weapon:natural:PC_1",
        name: "Natural Weapons",
        kind: "MELEE",
        damage: { tier: "half", add: 0, bonus: "SB" },
        damageType: "rendering",
        penetration: 1,
        handedness: "oneHand",
        qualities: [{ id: "primitive", rank: 7 }],
      });
    });

    it("should omit primitive quality for deadly natural weapons", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": { size: 4 },
          "trait:deadly_natural_weapons": {},
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = createCatalogsWithNaturalWeapons();

      const profile = getNaturalWeaponProfile(save, catalogs, "PC_1");
      expect(profile?.qualities ?? []).toEqual([]);
    });
  });
});
