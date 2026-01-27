import { describe, it, expect } from "vitest";
import { combatFrenzy } from "./frenzy";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { makeTestSave } from "../../test-helpers/makeTestSave";
import { startCombat } from "../combat";
import { FakeRng } from "../../test-helpers/fakeRng";
import type { Effect } from "../../types";

describe("combatFrenzy", () => {
  it("should apply frenzy condition and temp modifiers", () => {
    const storyPack = makeTestStoryPack({
      talents: [
        {
          id: "talent:frenzy",
          name: "Frenzy",
          tier: 1,
          xpCost: 250,
          prerequisites: [],
          grants: [{ type: "unlockAction", actionId: "combat:frenzy" }],
        },
      ],
    });
    const actor = makeTestActor({
      id: "PC_1",
      stats: { TOU: 40 } as any,
      talents: { "talent:frenzy": 1 },
    });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, [actor.id]);
    const combat = combatSave.runtime.combat!;
    const saveWithTurn = {
      ...combatSave,
      runtime: {
        ...combatSave.runtime,
        combat: {
          ...combat,
          currentIndex: combat.participants.indexOf(actor.id),
          turn: {
            ...combat.turn,
            actionAvailable: true,
          },
        },
      },
    };

    const effect: Effect = {
      op: "combatFrenzy",
      actorId: actor.id,
    };

    const result = combatFrenzy(effect as Extract<Effect, { op: "combatFrenzy" }>, storyPack, saveWithTurn, new FakeRng([]));
    const updatedActor = result.save.actorsById[actor.id];

    expect(updatedActor.conditions?.frenzy).toBeDefined();
    expect(updatedActor.status.tempModifiers.some((mod) => mod.id.startsWith(`frenzy:${actor.id}:`))).toBe(true);
  });
});
