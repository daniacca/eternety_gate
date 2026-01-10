import { describe, it, expect } from "vitest";
import {
  getCharacteristicBonusBase,
  getCharacteristicValue,
  getBonusModifiers,
  getCharacteristicBonus,
  getStatTestTarget,
  getInitiativeBonus,
} from "./bonuses";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Trait } from "../../content/catalogs";

describe("bonuses", () => {
  const storyPack = makeTestStoryPack();

  describe("getCharacteristicBonusBase", () => {
    it("should calculate bonus as floor(value / 10)", () => {
      expect(getCharacteristicBonusBase(0)).toBe(0);
      expect(getCharacteristicBonusBase(9)).toBe(0);
      expect(getCharacteristicBonusBase(10)).toBe(1);
      expect(getCharacteristicBonusBase(19)).toBe(1);
      expect(getCharacteristicBonusBase(20)).toBe(2);
      expect(getCharacteristicBonusBase(50)).toBe(5);
      expect(getCharacteristicBonusBase(99)).toBe(9);
      expect(getCharacteristicBonusBase(100)).toBe(10);
    });
  });

  describe("getCharacteristicValue", () => {
    it("should return stat value for existing actor and stat", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
          AGI: 60,
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(getCharacteristicValue("PC_1", "STR", save)).toBe(50);
      expect(getCharacteristicValue("PC_1", "AGI", save)).toBe(60);
    });

    it("should return 0 for non-existent actor", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      expect(getCharacteristicValue("NPC_1", "STR", save)).toBe(0);
    });

    it("should return 0 for non-existent stat", () => {
      // Create an actor with only STR stat, not TOU
      const actor = makeTestActor({
        id: "PC_1",
      });
      // Override stats to only include STR
      const limitedActor = {
        ...actor,
        stats: {
          STR: 50,
        } as any,
      };
      const save = makeTestSave(storyPack, limitedActor);

      // TOU should return 0 since it's not in the stats object
      expect(getCharacteristicValue("PC_1", "TOU", save)).toBe(0);
    });
  });

  describe("getBonusModifiers", () => {
    it("should return 0 when catalogs not provided", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      expect(getBonusModifiers(save, "PC_1", "STR")).toBe(0);
    });

    it("should return 0 for non-existent actor", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      expect(getBonusModifiers(save, "NPC_1", "STR", catalogs)).toBe(0);
    });

    it("should include unnatural characteristic modifier from traits", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:unnatural_str": {
            stat: "STR",
            bonusX: 2,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const trait: Trait = {
        id: "trait:unnatural_str",
        name: "Unnatural Strength",
        params: {
          stat: { type: "string", required: true },
          bonusX: { type: "number", required: true },
        },
        grants: [
          {
            type: "modifier",
            key: "stat.STR.bonusAdd",
            op: "add",
            value: 0,
            valueRef: "bonusX",
          },
        ],
      };

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [trait],
      };

      // This will use getModifierTotal which resolves valueRef
      const modifier = getBonusModifiers(save, "PC_1", "STR", catalogs);
      expect(modifier).toBe(2);
    });
  });

  describe("getCharacteristicBonus", () => {
    it("should calculate bonus from base value only when no modifiers", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // bonus = 5
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(getCharacteristicBonus(save, "PC_1", "STR")).toBe(5);
    });

    it("should include modifiers when catalogs provided", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50, // base bonus = 5
        },
        traits: {
          "trait:unnatural_str": {
            stat: "STR",
            bonusX: 2,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const trait: Trait = {
        id: "trait:unnatural_str",
        name: "Unnatural Strength",
        params: {
          stat: { type: "string", required: true },
          bonusX: { type: "number", required: true },
        },
        grants: [
          {
            type: "modifier",
            key: "stat.STR.bonusAdd",
            op: "add",
            value: 0,
            valueRef: "bonusX",
          },
        ],
      };

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [trait],
      };

      // Base bonus (5) + modifier (2) = 7
      expect(getCharacteristicBonus(save, "PC_1", "STR", catalogs)).toBe(7);
    });
  });

  describe("getStatTestTarget", () => {
    it("should return base stat value + test modifiers", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          STR: 50,
        },
      });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [],
      };

      expect(getStatTestTarget(save, catalogs, "PC_1", "STR")).toBe(50);
    });

    it("should return 0 for non-existent actor", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [],
      };

      expect(getStatTestTarget(save, catalogs, "NPC_1", "STR")).toBe(0);
    });
  });

  describe("getInitiativeBonus", () => {
    it("should return INI characteristic bonus", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          INI: 50, // bonus = 5
        },
      });
      const save = makeTestSave(storyPack, actor);

      expect(getInitiativeBonus(save, "PC_1")).toBe(5);
    });

    it("should include modifiers when catalogs provided", () => {
      const actor = makeTestActor({
        id: "PC_1",
        stats: {
          INI: 50, // base bonus = 5
        },
        traits: {
          "trait:unnatural_ini": {
            stat: "INI",
            bonusX: 1,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const trait: Trait = {
        id: "trait:unnatural_ini",
        name: "Unnatural Initiative",
        params: {
          stat: { type: "string", required: true },
          bonusX: { type: "number", required: true },
        },
        grants: [
          {
            type: "modifier",
            key: "stat.INI.bonusAdd",
            op: "add",
            value: 0,
            valueRef: "bonusX",
          },
        ],
      };

      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [trait],
      };

      // Base bonus (5) + modifier (1) = 6
      expect(getInitiativeBonus(save, "PC_1", catalogs)).toBe(6);
    });
  });
});
