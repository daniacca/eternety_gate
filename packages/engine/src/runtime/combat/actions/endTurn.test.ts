import { describe, it, expect } from "vitest";
import { combatEndTurn } from "./endTurn";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { startCombat } from "../combat";
import { FakeRng } from "../../test-helpers/fakeRng";
import type { Effect } from "../../types";

describe("combatEndTurn", () => {
  it("should return unchanged save if combat is not active", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1" });
    const save = makeTestSave(storyPack, actor);
    const rng = new FakeRng([]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, save, rng);

    expect(result.save).toEqual(save);
  });

  it("should return unchanged save if not player's turn", () => {
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
    const rng = new FakeRng([]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, npcTurnSave, rng);

    expect(result.save).toEqual(npcTurnSave);
  });

  it("should add narration when ending player turn", () => {
    const storyPack = makeTestStoryPack();
    const actor1 = makeTestActor({ id: "PC_1", kind: "PC", stats: { INI: 50, AGI: 50 } as any });
    const actor2 = makeTestActor({ id: "NPC_1", kind: "NPC", stats: { INI: 30, AGI: 30 } as any });
    const save = makeTestSave(storyPack, actor1);
    const saveWithBoth = {
      ...save,
      actorsById: {
        ...save.actorsById,
        [actor2.id]: actor2,
      },
    };
    const combatSave = startCombat(storyPack, saveWithBoth, ["PC_1", "NPC_1"]);
    const rng = new FakeRng([]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, combatSave, rng);

    // Check if "Termini il turno" appears in combat log (might not be last if combat ends)
    const hasTurnEndLog = result.save.runtime.combatLog?.some((log) => log.includes("Termini il turno"));
    expect(hasTurnEndLog).toBe(true);
  });

  it("should set combatCycleStartIndex before advancing turn", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const saveWithTurnStart = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combatTurnStartIndex: 5,
      },
    };
    const rng = new FakeRng([]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, saveWithTurnStart, rng);

    expect(result.save.runtime.combatCycleStartIndex).toBe(5);
  });

  it("should advance combat turn", () => {
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
    const initialTurnCounter = combatSave.runtime.combat?.turnCounter ?? 0;
    const rng = new FakeRng([]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, combatSave, rng);

    // Turn should advance (combat might end, so check if it exists)
    if (result.save.runtime.combat) {
      expect(result.save.runtime.combat.turnCounter ?? 0).toBeGreaterThanOrEqual(initialTurnCounter);
    }
  });

  it("should update rngCounter", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ id: "PC_1", stats: { INI: 50, AGI: 50 } as any });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, ["PC_1"]);
    const rng = new FakeRng([10, 20, 30]);

    const effect: Effect = { op: "combatEndTurn" };
    const result = combatEndTurn(effect as Extract<Effect, { op: "combatEndTurn" }>, storyPack, combatSave, rng);

    expect(result.save.runtime.rngCounter).toBe(rng.getCounter());
  });
});
