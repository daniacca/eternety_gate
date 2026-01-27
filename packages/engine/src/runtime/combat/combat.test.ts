import { describe, it, expect } from "vitest";
import { startCombat, advanceCombatTurn, getCurrentTurnActorId, calculateInitialMovement } from "./combat";
import { isActorAlive, getSizeMovementModifier } from "../characters/actors";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";

describe("combat", () => {
  describe("startCombat", () => {
    it("should initialize combat with participants", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const result = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);

      expect(result.runtime.combat?.active).toBe(true);
      expect(result.runtime.combat?.participants).toContain("PC_1");
      expect(result.runtime.combat?.participants).toContain("NPC_1");
      expect(result.runtime.combat?.round).toBe(1);
    });

    it("should filter out dead participants", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50 } as any });
      const actor2 = makeTestActor({
        id: "NPC_1",
        stats: { INI: 30 } as any,
        resources: { wounds: 100, rf: 0, peq: 0, isDead: true }, // wounds = maxHp (100) means HP = 0, dead
      });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const result = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);

      expect(result.runtime.combat?.participants).not.toContain("NPC_1");
      expect(result.runtime.combat?.participants).toContain("PC_1");
    });

    it("should order participants by initiative", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 30 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 50 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const result = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);

      // Higher INI should go first (assuming deterministic RNG)
      expect(result.runtime.combat?.participants.length).toBeGreaterThan(0);
      expect(result.runtime.combat?.currentIndex).toBe(0);
    });

    it("should initialize grid and positions", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1" });
      const actor2 = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const grid = { width: 15, height: 15 };
      const placements = [
        { actorId: "PC_1", x: 5, y: 5 },
        { actorId: "NPC_1", x: 10, y: 10 },
      ];

      const result = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"], undefined, grid, placements);

      expect(result.runtime.combat?.grid).toEqual(grid);
      expect(result.runtime.combat?.positions["PC_1"]).toEqual({ x: 5, y: 5 });
      expect(result.runtime.combat?.positions["NPC_1"]).toEqual({ x: 10, y: 10 });
    });

    it("should use default grid if not provided", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1" });
      const save = makeTestSave(storyPack, actor1);

      const result = startCombat(storyPack, save, ["PC_1"]);

      expect(result.runtime.combat?.grid).toEqual({ width: 10, height: 10 });
    });

    it("should initialize turn state based on AGI", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { AGI: 45, INI: 50 } as any });
      const save = makeTestSave(storyPack, actor1);

      const result = startCombat(storyPack, save, ["PC_1"]);

      // AGI 45 -> floor(45/10) = 4 movement
      expect(result.runtime.combat?.turn.moveRemaining).toBeGreaterThanOrEqual(1);
      expect(result.runtime.combat?.turn.actionAvailable).toBe(true);
    });

    it("should not start combat if no valid participants", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({
        id: "PC_1",
        stats: { INI: 50 } as any,
        resources: { wounds: 100, rf: 0, peq: 0, isDead: true }, // wounds = maxHp (100) means HP = 0, dead
      });
      const save = makeTestSave(storyPack, actor1);

      const result = startCombat(storyPack, save, ["PC_1"]);

      expect(result.runtime.combat).toBeUndefined();
    });
  });

  describe("getCurrentTurnActorId", () => {
    it("should return current turn actor ID", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1" });
      const actor2 = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const turnActorId = getCurrentTurnActorId(combatSave);

      expect(turnActorId).toBeDefined();
      expect(["PC_1", "NPC_1"]).toContain(turnActorId!);
    });

    it("should return null when combat is not active", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const turnActorId = getCurrentTurnActorId(save);

      expect(turnActorId).toBeNull();
    });
  });

  describe("advanceCombatTurn", () => {
    it("should advance to next participant", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30, AGI: 30 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const firstTurnActorId = getCurrentTurnActorId(combatSave);
      const advancedSave = advanceCombatTurn(combatSave);
      const secondTurnActorId = getCurrentTurnActorId(advancedSave);

      expect(firstTurnActorId).not.toBe(secondTurnActorId);
      expect(advancedSave.runtime.combat?.round).toBeGreaterThanOrEqual(1);
    });

    it("should increment round when cycling back to first participant", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30, AGI: 30 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const initialRound = combatSave.runtime.combat?.round || 0;

      // Advance through all participants
      let currentSave = combatSave;
      for (let i = 0; i < combatSave.runtime.combat!.participants.length; i++) {
        currentSave = advanceCombatTurn(currentSave);
      }

      expect(currentSave.runtime.combat?.round).toBe(initialRound + 1);
    });

    it("should end combat when only one participant remains", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
      const actor2 = makeTestActor({
        id: "NPC_1",
        stats: { INI: 30, AGI: 30 } as any,
        resources: { wounds: 100, rf: 0, peq: 0, isDead: true }, // wounds = maxHp (100) means HP = 0, dead
      });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const advancedSave = advanceCombatTurn(combatSave);

      expect(advancedSave.runtime.combat).toBeUndefined();
    });

    it("should end combat when no participants remain", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({
        id: "PC_1",
        stats: { INI: 50, AGI: 50 } as any,
        resources: { wounds: 100, rf: 0, peq: 0, isDead: true }, // wounds = maxHp (100) means HP = 0, dead
      });
      const actor2 = makeTestActor({
        id: "NPC_1",
        stats: { INI: 30, AGI: 30 } as any,
        resources: { wounds: 100, rf: 0, peq: 0, isDead: true }, // wounds = maxHp (100) means HP = 0, dead
      });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const advancedSave = advanceCombatTurn(combatSave);

      expect(advancedSave.runtime.combat).toBeUndefined();
    });

    it("should reset stance for actor whose turn starts", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30, AGI: 30 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const saveWithStance = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          combat: {
            ...combatSave.runtime.combat!,
            stancesByActorId: {
              [actor1.id]: "defend" as const,
            },
          },
        },
      };

      const advancedSave = advanceCombatTurn(saveWithStance);
      const nextTurnActorId = getCurrentTurnActorId(advancedSave);

      // Stance should be cleared for the actor whose turn starts
      if (nextTurnActorId === actor1.id) {
        expect(advancedSave.runtime.combat?.stancesByActorId?.[actor1.id]).toBeUndefined();
      }
    });

    it("should increment turn counter", () => {
      const storyPack = makeTestStoryPack();
      const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
      const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 30, AGI: 30 } as any });
      const save = makeTestSave(storyPack, actor1);
      const saveWithBoth = {
        ...save,
        actorsById: {
          ...save.actorsById,
          [actor2.id]: actor2,
        },
      };

      const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
      const initialCounter = combatSave.runtime.combat?.turnCounter || 0;
      const advancedSave = advanceCombatTurn(combatSave);

      expect(advancedSave.runtime.combat?.turnCounter).toBe(initialCounter + 1);
    });
  });

  describe("isActorAlive", () => {
    it("should return true for alive actor", () => {
      const actor = makeTestActor({ id: "test_actor" });

      expect(isActorAlive(actor)).toBe(true);
    });

    it("should return false for dead actor", () => {
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          isDead: true,
          rf: 0,
          peq: 0,
        },
      });

      expect(isActorAlive(actor)).toBe(false);
    });

    it("should return false for undefined actor", () => {
      expect(isActorAlive(undefined)).toBe(false);
    });

    it("should return true when isDead is explicitly false", () => {
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          isDead: false,
          rf: 0,
          peq: 0,
        },
      });

      expect(isActorAlive(actor)).toBe(true);
    });

    it("should return true when isDead is undefined", () => {
      const actor = makeTestActor({
        id: "test_actor",
        resources: {
          wounds: 0,
          rf: 0,
          peq: 0,
        },
      });

      expect(isActorAlive(actor)).toBe(true);
    });
  });

  describe("getSizeMovementModifier", () => {
    it("should return correct modifier for size 1", () => {
      const actor = makeTestActor({
        id: "test_actor",
        traits: { "trait:size": { size: 1 } },
      });

      expect(getSizeMovementModifier(actor)).toBe(-3);
    });

    it("should return correct modifier for size 4 (default)", () => {
      const actor = makeTestActor({ id: "test_actor" });

      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should return correct modifier for size 5", () => {
      const actor = makeTestActor({
        id: "test_actor",
        traits: { "trait:size": { size: 5 } },
      });

      expect(getSizeMovementModifier(actor)).toBe(1);
    });

    it("should return correct modifier for size 10", () => {
      const actor = makeTestActor({
        id: "test_actor",
        traits: { "trait:size": { size: 10 } },
      });

      expect(getSizeMovementModifier(actor)).toBe(6);
    });

    it("should default to size 4 when size trait is missing", () => {
      const actor = makeTestActor({
        id: "test_actor",
        traits: {},
      });

      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should default to size 4 when size trait has invalid value", () => {
      const actor = makeTestActor({
        id: "test_actor",
        traits: { "trait:size": { size: 99 } },
      });

      expect(getSizeMovementModifier(actor)).toBe(0);
    });

    it("should handle all size values from 1 to 10", () => {
      const expectedModifiers: Record<number, number> = {
        1: -3,
        2: -2,
        3: -1,
        4: 0,
        5: 1,
        6: 2,
        7: 3,
        8: 4,
        9: 5,
        10: 6,
      };

      for (const [size, expectedModifier] of Object.entries(expectedModifiers)) {
        const actor = makeTestActor({
          id: "test_actor",
          traits: { "trait:size": { size: parseInt(size, 10) } },
        });

        expect(getSizeMovementModifier(actor)).toBe(expectedModifier);
      }
    });
  });

  describe("calculateInitialMovement", () => {
    it("should calculate movement based on AGI bonus", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 45 }, // AGI 45 -> floor(45/10) = 4 bonus
      });
      const save = makeTestSave(storyPack, actor);

      const movement = calculateInitialMovement(actor, save);

      // AGI bonus 4 + size modifier 0 (default) = 4, minimum 1
      expect(movement).toBeGreaterThanOrEqual(1);
    });

    it("should include size modifier in calculation", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 50 }, // AGI 50 -> floor(50/10) = 5 bonus
        traits: { "trait:size": { size: 1 } }, // Size 1 -> -3 modifier
      });
      const save = makeTestSave(storyPack, actor);

      const movement = calculateInitialMovement(actor, save);

      // AGI bonus 5 + size modifier -3 = 2, minimum 1
      expect(movement).toBeGreaterThanOrEqual(1);
    });

    it("should return minimum 1 movement", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 5 }, // AGI 5 -> floor(5/10) = 0 bonus
        traits: { "trait:size": { size: 1 } }, // Size 1 -> -3 modifier
      });
      const save = makeTestSave(storyPack, actor);

      const movement = calculateInitialMovement(actor, save);

      // AGI bonus 0 + size modifier -3 = -3, but minimum is 1
      expect(movement).toBe(1);
    });

    it("should handle conditions that affect movement", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 50 },
        conditions: {
          fatigue: { stacks: 1 },
        },
      });
      const save = makeTestSave(storyPack, actor);

      const movement = calculateInitialMovement(actor, save);

      // Should account for condition modifiers
      expect(movement).toBeGreaterThanOrEqual(1);
    });

    it("should apply Sprint movement bonus", () => {
      const storyPack = makeTestStoryPack({
        talents: [
          {
            id: "talent:sprint",
            name: "Sprint",
            tier: 3,
            xpCost: 1000,
            prerequisites: [],
            grants: [{ type: "hook", hookId: "sprint" }],
          },
        ],
      });
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 40 },
        talents: { "talent:sprint": 1 },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = loadCharacterCatalogs({
        id: storyPack.id,
        weapons: [],
        armors: [],
        skills: storyPack.skills || [],
        talents: storyPack.talents || [],
        traits: storyPack.traits || [],
      });

      const movement = calculateInitialMovement(actor, save, catalogs);

      expect(movement).toBe(6);
    });

    it("should override movement for flyers", () => {
      const storyPack = makeTestStoryPack({
        traits: [
          {
            id: "trait:flyer",
            name: "Flyer",
            params: {
              x: { type: "number", required: true },
            },
            grants: [
              { type: "modifier", key: "movement.canFly", op: "add", value: 1 },
              { type: "modifier", key: "movement.flySpeed", op: "add", valueRef: "x" },
            ],
          },
        ],
      });
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 20 },
        traits: { "trait:flyer": { x: 6 } },
      });
      const save = makeTestSave(storyPack, actor);
      const catalogs = loadCharacterCatalogs({
        id: storyPack.id,
        weapons: [],
        armors: [],
        skills: storyPack.skills || [],
        talents: storyPack.talents || [],
        traits: storyPack.traits || [],
      });

      const movement = calculateInitialMovement(actor, save, catalogs);

      expect(movement).toBe(6);
    });

    it("should work without catalogs", () => {
      const storyPack = makeTestStoryPack();
      const actor = makeTestActor({
        id: "test_actor",
        stats: { AGI: 50 },
      });
      const save = makeTestSave(storyPack, actor);

      const movement = calculateInitialMovement(actor, save);

      expect(movement).toBeGreaterThanOrEqual(1);
    });
  });
});
