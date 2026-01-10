import { describe, it, expect } from "vitest";
import { applyGrants, resolveGrantValueRef } from "./grants";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import type { CharacterCatalogs, Grant, Trait } from "../../content/catalogs";

describe("grants", () => {
  const storyPack = makeTestStoryPack();

  describe("applyGrants", () => {
    it("should return save unchanged (placeholder implementation)", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };
      const grants: Grant[] = [];

      const result = applyGrants(save, catalogs, "PC_1", grants);
      expect(result).toBe(save);
    });
  });

  describe("resolveGrantValueRef", () => {
    it("should return 0 when actor not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:test",
            name: "Test Trait",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "NPC_1", save, "trait:test", "value")).toBe(0);
    });

    it("should return 0 when trait not found", () => {
      const actor = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = { skills: [], talents: [], traits: [] };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:test", "value")).toBe(0);
    });

    it("should return 0 when trait params is not an object", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:test": "invalid" as any,
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:test",
            name: "Test Trait",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:test", "value")).toBe(0);
    });

    it("should resolve simple value reference", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:test": {
            value: 5,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:test",
            name: "Test Trait",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:test", "value")).toBe(5);
    });

    it("should resolve nested value reference", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:size": {
            size: {
              toHitMod: 2,
            },
          },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:size",
            name: "Size",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:size", "size.toHitMod")).toBe(2);
    });

    it("should return 0 when nested path does not exist", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:test": {
            value: 5,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:test",
            name: "Test Trait",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:test", "value.nested")).toBe(0);
    });

    it("should return 0 when value is not a number", () => {
      const actor = makeTestActor({
        id: "PC_1",
        traits: {
          "trait:test": {
            value: "not a number" as any,
          },
        },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs: CharacterCatalogs = {
        skills: [],
        talents: [],
        traits: [
          {
            id: "trait:test",
            name: "Test Trait",
            grants: [],
          },
        ],
      };

      expect(resolveGrantValueRef(catalogs, "PC_1", save, "trait:test", "value")).toBe(0);
    });
  });
});
