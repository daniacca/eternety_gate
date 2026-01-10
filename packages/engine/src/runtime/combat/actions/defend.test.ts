import { describe, it, expect } from "vitest";
import { combatDefend } from "./defend";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { startCombat } from "../combat";
import type { Effect } from "../../types";

describe("combatDefend", () => {
  it("should set defend stance and consume action", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, combatSave);

    expect(result.save.runtime.combat?.stancesByActorId?.["PC_1"]).toBe("defend");
    expect(result.save.runtime.combat?.turn.actionAvailable).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:defend=1");
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:stance=defend");
    expect(result.save.runtime.combatLog).toBeDefined();
    expect(result.save.runtime.combatLog?.length).toBeGreaterThan(0);
  });

  it("should return unchanged save if combat is not active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1" });
    const save = makeTestSave(storyPack, actor);

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, save);

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
    // Advance turn so NPC goes first
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

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, npcTurnSave);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=notYourTurn");
    expect(result.save.runtime.combat?.stancesByActorId?.["PC_1"]).toBeUndefined();
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

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, saveWithActionSpent);

    expect(result.save.runtime.lastCheck?.success).toBe(false);
    expect(result.save.runtime.lastCheck?.tags).toContain("combat:blocked=noAction");
    expect(result.save.runtime.combat?.turn.actionAvailable).toBe(false);
  });

  it("should reset channeling when defending", () => {
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

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, saveWithChanneling);

    expect(result.save.runtime.combat?.channeling).toBeUndefined();
  });

  it("should add narration for PC actor", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", kind: "PC", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, combatSave);

    const lastLog = result.save.runtime.combatLog?.[result.save.runtime.combatLog.length - 1];
    expect(lastLog).toContain("Assumi una posizione difensiva");
  });

  it("should add narration for NPC actor", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "NPC_1", kind: "NPC", name: "Enemy", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const saveWithNPC = {
      ...save,
      party: {
        ...save.party,
        activeActorId: "NPC_1",
      },
    };
    const combatSave = startCombat(storyPack, saveWithNPC, ["NPC_1"]);

    const effect: Effect = { op: "combatDefend" };
    const result = combatDefend(effect as Extract<Effect, { op: "combatDefend" }>, combatSave);

    const lastLog = result.save.runtime.combatLog?.[result.save.runtime.combatLog.length - 1];
    expect(lastLog).toContain("Enemy");
    expect(lastLog).toContain("assume una posizione difensiva");
  });
});
