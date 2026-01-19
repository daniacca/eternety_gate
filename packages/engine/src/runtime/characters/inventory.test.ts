import { describe, it, expect } from "vitest";
import { getActorInventory, getEquippedWeaponId, getEquippedArmorId, getInventoryItemQty, removeInventoryItemQty } from "./inventory";
import { makeTestActor } from "../test-helpers/makeTestActor";

describe("inventory", () => {
  describe("getActorInventory", () => {
    it("should return empty array when inventory is undefined", () => {
      const actor = makeTestActor({
        inventory: undefined,
      });
      expect(getActorInventory(actor)).toEqual([]);
    });

    it("should return empty array when inventory is empty", () => {
      const actor = makeTestActor({
        inventory: [],
      });
      expect(getActorInventory(actor)).toEqual([]);
    });

    it("should return inventory items when present", () => {
      const actor = makeTestActor({
        inventory: [
          { id: "item1", kind: "item" },
          { id: "item2", kind: "item" },
        ],
      });
      const inventory = getActorInventory(actor);
      expect(inventory).toHaveLength(2);
      expect(inventory[0]).toEqual({ id: "item1", kind: "item" });
      expect(inventory[1]).toEqual({ id: "item2", kind: "item" });
    });
  });

  describe("inventory quantities", () => {
    it("should sum quantities across stacks", () => {
      const inventory = [
        { id: "ammo:arrow", kind: "item", qty: 5 },
        { id: "ammo:arrow", kind: "item", qty: 3 },
        { id: "item:other", kind: "item" },
      ];
      expect(getInventoryItemQty(inventory, "ammo:arrow")).toBe(8);
    });

    it("should remove quantity across stacks", () => {
      const inventory = [
        { id: "ammo:arrow", kind: "item", qty: 2 },
        { id: "ammo:arrow", kind: "item", qty: 3 },
      ];
      const { updatedInventory, removedQty } = removeInventoryItemQty(inventory, "ammo:arrow", 4);
      expect(removedQty).toBe(4);
      expect(getInventoryItemQty(updatedInventory, "ammo:arrow")).toBe(1);
    });
  });

  describe("getEquippedWeaponId", () => {
    it("should return null when no weapon is equipped", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: null,
          offHand: null,
          armor: null,
        },
      });
      expect(getEquippedWeaponId(actor)).toBeNull();
    });

    it("should return weapon ID when weapon is equipped in mainHand", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: {
            kind: "weapon",
            id: "weapon:sword",
          },
          offHand: null,
          armor: null,
        },
      });
      expect(getEquippedWeaponId(actor)).toBe("weapon:sword");
    });

    it("should return null when mainHand is not a weapon", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: {
            kind: "misc",
            id: "item:shield",
          },
          offHand: null,
          armor: null,
        },
      });
      expect(getEquippedWeaponId(actor)).toBeNull();
    });

    it("should ignore offHand weapon", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: null,
          offHand: {
            kind: "weapon",
            id: "weapon:dagger",
          },
          armor: null,
        },
      });
      expect(getEquippedWeaponId(actor)).toBeNull();
    });
  });

  describe("getEquippedArmorId", () => {
    it("should return null when no armor is equipped", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: null,
          offHand: null,
          armor: null,
        },
      });
      expect(getEquippedArmorId(actor)).toBeNull();
    });

    it("should return armor ID when armor is equipped", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: null,
          offHand: null,
          armor: {
            kind: "armor",
            id: "armor:leather",
          },
        },
      });
      expect(getEquippedArmorId(actor)).toBe("armor:leather");
    });

    it("should return null when armor slot is not armor type", () => {
      const actor = makeTestActor({
        equipment: {
          mainHand: null,
          offHand: null,
          armor: {
            kind: "misc",
            id: "item:something",
          },
        },
      });
      expect(getEquippedArmorId(actor)).toBeNull();
    });
  });
});
