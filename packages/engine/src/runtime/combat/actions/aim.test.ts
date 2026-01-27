import { describe, it, expect } from "vitest";
import { combatAim } from "./aim";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { startCombat } from "../combat";
import type { Effect } from "../../types";

describe("combatAim", () => {
  it("should set aim stance and consume action and movement", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, combatSave);

    expect(result.save.runtime.combat?.stancesByActorId?.["PC_1"]).toBe("aim");
    expect(result.save.runtime.combat?.turn.actionAvailable).toBe(false);
    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(0);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:aim=1");
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:stance=aim");
    expect(result.save.runtime.combatLog).toBeDefined();
  });

  it("should return unchanged save if combat is not active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1" });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, save);

    expect(result.save).toEqual(save);
    expect(result.save.runtime.combat).toBeUndefined();
  });

  it("should block if not player's turn", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", stats: { INI: 30, AGI: 30 } as any });
    const actor2 = makeTestActor({ id: "NPC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };
    const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
    const npcTurnSave = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          currentIndex: combatSave.runtime.combat!.participants.indexOf("NPC_1"),
        },
      },
    };

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, npcTurnSave);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=notYourTurn");
  });

  it("should block if action already spent", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithActionSpent = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          turn: {
            ...combatSave.runtime.combat!.turn,
            actionAvailable: false,
          },
        },
      },
    };

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, saveWithActionSpent);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=actionSpent");
  });

  it("should block aim when shocked", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({
      id: "PC_1",
      stats: { INI: 50, AGI: 50 } as any,
      conditions: { shock: { stacks: 1 } },
    });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, combatSave);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=shock");
  });

  it("should reset channeling when aiming", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithChanneling = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          channeling: {
            actorId: "PC_1",
            spellId: "test_spell",
            channelingTurns: 1,
          },
        },
      },
    };

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, saveWithChanneling);

    expect(result.save.runtime.combat?.channeling).toBeUndefined();
  });

  it("should consume all movement when aiming", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithMovement = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combatSave.runtime.combat!,
          turn: {
            ...combatSave.runtime.combat!.turn,
            moveRemaining: 5,
          },
        },
      },
    };

    const effect: Effect = { op: "combatAim" };
    const result = combatAim(effect as Extract<Effect, { op: "combatAim" }>, saveWithMovement);

    expect(result.save.runtime.combat?.turn.moveRemaining).toBe(0);
  });
});
