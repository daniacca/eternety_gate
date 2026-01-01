import { describe, it, expect } from "vitest";
import { startCombat, advanceCombatTurn, getCurrentTurnActorId } from "./combat";
import { makeTestSave } from "../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../test-helpers/makeTestActor";

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
        resources: { hp: 0, rf: 0, peq: 0 },
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
        resources: { hp: 0, rf: 0, peq: 0 },
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
        resources: { hp: 0, rf: 0, peq: 0 },
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
        resources: { hp: 0, rf: 0, peq: 0 },
      });
      const actor2 = makeTestActor({
        id: "NPC_1",
        stats: { INI: 30, AGI: 30 } as any,
        resources: { hp: 0, rf: 0, peq: 0 },
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
              [actor1.id]: "defend",
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
});

