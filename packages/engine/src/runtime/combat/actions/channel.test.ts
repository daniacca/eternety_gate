import { describe, it, expect } from "vitest";
import { combatChannel } from "./channel";
import { startCombat } from "../combat";
import { FakeRng } from "../../test-helpers/fakeRng";
import { makeTestStoryPack } from "../../test-helpers/makeTestStoryPack";
import { makeTestActor } from "../../test-helpers/makeTestActor";
import { makeTestSave } from "../../test-helpers/makeTestSave";

describe("combatChannel", () => {
  it("accumulates at least 1 DoS on success", () => {
    const storyPack = makeTestStoryPack({
      skills: [
        {
          id: "skill:channeling",
          name: "Channeling",
          baseStat: "WIL",
        },
      ],
    });
    const actor = makeTestActor({ stats: { WIL: 30 } as any, skills: { "skill:channeling": 1 } });
    const save = makeTestSave(storyPack, actor);
    const combatSave = startCombat(storyPack, save, [actor.id], save.runtime.currentSceneId);

    const rng = new FakeRng([30]);
    const result = combatChannel({ op: "combatChannel", actorId: actor.id }, storyPack, combatSave, rng);

    expect(result.save.runtime.combat?.channeling?.accumulatedDoS).toBe(1);
  });
});
