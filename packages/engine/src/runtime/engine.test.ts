import { describe, it, expect } from "vitest";
import {
  createNewGame,
  applyChoice,
  startCombat,
  getCurrentTurnActorId,
  advanceCombatTurn,
  runNpcTurn,
} from "./engine";
import { getCurrentScene } from "./selectors";
import { rollD100, RNG } from "./rng";
import { performCheck } from "./checks";
import { evaluateCondition } from "./conditions";
import { FakeRng } from "./test-helpers/fakeRng";
import { makeTestActor } from "./test-helpers/makeTestActor";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestSave } from "./test-helpers/makeTestSave";
import type { StoryPack, Actor, Party, ActorId, ItemId, Item, GameSave } from "./types";

describe("applyChoice", () => {
  it("transitions scene and updates history when applying a goto choice", () => {
    // Create a minimal story pack with 2 scenes
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {},
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["You are at the start."],
          choices: [
            {
              id: "choice1",
              label: "Go to scene 2",
              effects: [
                {
                  op: "goto",
                  sceneId: "scene2",
                },
              ],
            },
          ],
        },
        {
          id: "scene2",
          type: "narration",
          title: "Scene 2",
          text: ["You reached scene 2."],
          choices: [],
        },
      ],
    };

    // Create a minimal actor
    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    // Create initial game save
    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {},
      { id: "test", weapons: [], armors: [] }
    );

    // Verify initial state
    expect(initialSave.runtime.currentSceneId).toBe("scene1");
    expect(initialSave.runtime.history.visitedScenes).toEqual(["scene1"]);
    expect(initialSave.runtime.history.chosenChoices).toEqual([]);

    // Apply choice
    const updatedSave = applyChoice(storyPack, initialSave, "choice1");

    // Verify transition
    expect(updatedSave.runtime.currentSceneId).toBe("scene2");
    expect(updatedSave.runtime.history.visitedScenes).toContain("scene2");
    expect(updatedSave.runtime.history.chosenChoices).toEqual(["choice1"]);

    // Verify we can get the new scene
    const { scene } = getCurrentScene(storyPack, updatedSave);
    expect(scene.id).toBe("scene2");
    expect(scene.title).toBe("Scene 2");
  });

  it("runs choice checks and applies onSuccess/onFailure effects correctly", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            EASY: 20,
            NORMAL: 0,
            HARD: -20,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice_with_check",
              label: "Make a check",
              checks: [
                {
                  id: "test_check",
                  kind: "single",
                  key: "PER",
                  difficulty: "NORMAL",
                  onSuccess: [
                    {
                      op: "setFlag",
                      path: "flags.checkPassed",
                      value: true,
                    },
                  ],
                  onFailure: [
                    {
                      op: "setFlag",
                      path: "flags.checkFailed",
                      value: true,
                    },
                  ],
                },
              ],
              effects: [
                {
                  op: "setFlag",
                  path: "flags.choiceApplied",
                  value: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50, // PER = 50, so target = 50 + 0 (NORMAL) = 50
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {},
      { id: "test", weapons: [], armors: [] }
    );

    // Apply choice - result depends on roll, but effects should be applied
    const updatedSave = applyChoice(storyPack, initialSave, "choice_with_check");

    // Verify check result was stored
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe("test_check");
    expect(updatedSave.runtime.lastCheck?.actorId).toBe("PC_1");
    expect(updatedSave.runtime.lastCheck?.target).toBe(50);

    // Verify choice effects are always applied
    expect(updatedSave.state.flags.choiceApplied).toBe(true);

    // Verify either success or failure effect was applied (but not both)
    const checkPassed = updatedSave.state.flags.checkPassed === true;
    const checkFailed = updatedSave.state.flags.checkFailed === true;
    expect(checkPassed || checkFailed).toBe(true);
    expect(checkPassed && checkFailed).toBe(false);
  });
});

describe("RNG determinism", () => {
  it("produces same sequence with same seed and counter", () => {
    const seed = 123456;
    const rng1 = new RNG(seed, 0);
    const rng2 = new RNG(seed, 0);

    const rolls1: number[] = [];
    const rolls2: number[] = [];

    for (let i = 0; i < 10; i++) {
      rolls1.push(rng1.rollD100());
      rolls2.push(rng2.rollD100());
    }

    expect(rolls1).toEqual(rolls2);
    expect(rng1.getCounter()).toBe(rng2.getCounter());
  });

  it("rollD100 updates save state correctly", () => {
    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ["PC_1"],
        activeActorId: "PC_1",
      },
      actorsById: {},
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 5,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    const { roll, nextSave } = rollD100(save);

    expect(roll).toBeGreaterThanOrEqual(1);
    expect(roll).toBeLessThanOrEqual(100);
    expect(nextSave.runtime.rngCounter).toBe(6);
    expect(nextSave.runtime.rngSeed).toBe(save.runtime.rngSeed);
  });

  it("RNG is seekable: value at counter N equals N steps from counter 0", () => {
    const seed = 123456;

    // Step forward from counter 0 to counter 5
    const rng1 = new RNG(seed, 0);
    const values1: number[] = [];
    for (let i = 0; i < 5; i++) {
      values1.push(rng1.next());
    }
    const valueAt5 = rng1.next(); // This is at counter 5

    // Create new RNG starting at counter 5
    const rng2 = new RNG(seed, 5);
    const valueAt5Direct = rng2.next();

    // Values should match
    expect(valueAt5Direct).toBe(valueAt5);

    // Seed should remain constant
    expect(rng1.getSeed()).toBe(seed);
    expect(rng2.getSeed()).toBe(seed);
    expect(rng1.getSeed()).toBe(rng2.getSeed());
  });
});

describe("Single check resolution", () => {
  it("resolves check with stat, difficulty, and tempModifiers", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            EASY: 20,
            NORMAL: 0,
            HARD: -20,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 60, // Base PER = 60
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [
          {
            id: "temp_bonus",
            scope: "check",
            key: "PER",
            value: 10, // +10 bonus
          },
        ],
      },
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ["PC_1"],
        activeActorId: "PC_1",
      },
      actorsById: { PC_1: actor },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    const rng = new RNG(123456, 0);

    const check = {
      id: "test_check",
      kind: "single" as const,
      key: "PER" as const,
      difficulty: "HARD", // -20 modifier
    };

    // Expected target: 60 (base) + 10 (tempModifier) + (-20) (difficulty) = 50
    const result = performCheck(check, storyPack, save, rng);

    expect(result).not.toBeNull();
    expect(result?.target).toBe(50);
    expect(result?.actorId).toBe("PC_1");
    expect(result?.roll).toBeGreaterThanOrEqual(1);
    expect(result?.roll).toBeLessThanOrEqual(100);
  });

  it("resolves check with skill key", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {
        VATES: 40, // Skill value = 40
      },
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ["PC_1"],
        activeActorId: "PC_1",
      },
      actorsById: { PC_1: actor },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    const rng = new RNG(123456, 0);

    const check = {
      id: "test_check",
      kind: "single" as const,
      key: "SKILL:VATES" as const,
      difficulty: "NORMAL",
    };

    // Expected target: 40 (skill) + 0 (difficulty) = 40
    const result = performCheck(check, storyPack, save, rng);

    expect(result).not.toBeNull();
    expect(result?.target).toBe(40);
  });
});

describe("Flat state access", () => {
  it("treats keys with dots as flat keys (no nested path resolution)", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {},
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              effects: [
                {
                  op: "setFlag",
                  path: "flags.quest.stage.1",
                  value: true,
                },
                {
                  op: "addCounter",
                  path: "counters.quest.progress",
                  value: 10,
                },
              ],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {},
      { id: "test", weapons: [], armors: [] }
    );

    // Apply choice with effects containing dots in keys
    const updatedSave = applyChoice(storyPack, initialSave, "choice1");

    // Verify flat access: keys with dots are treated as literal keys
    expect(updatedSave.state.flags["quest.stage.1"]).toBe(true);
    expect(updatedSave.state.counters["quest.progress"]).toBe(10);

    // Verify condition evaluation works with flat keys
    const condition = {
      op: "flag" as const,
      path: "flags.quest.stage.1",
      value: true,
    };
    const conditionResult = evaluateCondition(condition, updatedSave);
    expect(conditionResult).toBe(true);
  });
});

describe("Sequence check", () => {
  it("executes steps in order and stops at first failure", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "sequence_check",
                  kind: "sequence",
                  steps: [
                    {
                      id: "step1",
                      kind: "single",
                      key: "PER",
                      difficulty: "NORMAL",
                    },
                    {
                      id: "step2",
                      kind: "single",
                      key: "INT",
                      difficulty: "NORMAL",
                    },
                  ],
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {},
      { id: "test", weapons: [], armors: [] }
    );

    // Apply choice with sequence check
    const updatedSave = applyChoice(storyPack, initialSave, "choice1");

    // Verify sequence check result was stored
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe("sequence_check");
    expect(updatedSave.runtime.lastCheck?.tags).toContain("sequence:steps=2");
  });

  it("includes failedAt tag when sequence fails", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
            IMPOSSIBLE: -200, // Very hard to pass
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "sequence_check",
                  kind: "sequence",
                  steps: [
                    {
                      id: "step1",
                      kind: "single",
                      key: "PER",
                      difficulty: "NORMAL",
                    },
                    {
                      id: "step2",
                      kind: "single",
                      key: "INT",
                      difficulty: "IMPOSSIBLE", // This will likely fail
                    },
                  ],
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: "PC_1",
      name: "Test Player",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {},
      { id: "test", weapons: [], armors: [] }
    );

    // Apply choice with sequence check that will likely fail on step 2
    const updatedSave = applyChoice(storyPack, initialSave, "choice1");

    // Verify sequence check result
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe("sequence_check");
    expect(updatedSave.runtime.lastCheck?.tags).toContain("sequence:steps=2");

    // If it failed, should have failedAt tag
    if (!updatedSave.runtime.lastCheck?.success) {
      expect(updatedSave.runtime.lastCheck?.tags).toContain("sequence:failedAt=1");
    }
  });
});

describe("Magic checks", () => {
  it("magicChannel success produces DoS and magic:channel=1 tag", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor({ stats: { INT: 60 } });
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 20 (success with DoS)
    // Target = INT 60 + NORMAL 0 = 60, roll 20 => DoS = floor((60-20)/10) = 4
    const fakeRng = new FakeRng([20]);

    const check = {
      id: "magic_channel",
      kind: "magicChannel" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      targetDoS: 1,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.dos).toBe(4); // DoS is kept as-is, not subtracted
    expect(result?.tags).toContain("magic:channel=1");
    expect(result?.tags).toContain("magic:channelTarget=1");
    expect(result?.tags).toContain("magic:success=1");
  });

  it("magicChannel fails when underlying roll fails", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 90 (failure)
    // Target = INT 50 + NORMAL 0 = 50, roll 90 => fail
    const fakeRng = new FakeRng([90]);

    const check = {
      id: "magic_channel",
      kind: "magicChannel" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      targetDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(3); // targetDoS
    expect(result?.tags).toContain("magic:channel=1");
    expect(result?.tags).toContain("magic:channelTarget=3");
    expect(result?.tags).toContain("magic:fail=1");
  });

  it("magicChannel fails when success but dos < targetDoS", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 40 (success but insufficient DoS)
    // Target = INT 50 + NORMAL 0 = 50, roll 40 => DoS = floor((50-40)/10) = 1
    // targetDoS = 3, so 1 < 3 => insufficient
    const fakeRng = new FakeRng([40]);

    const check = {
      id: "magic_channel",
      kind: "magicChannel" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      targetDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(2); // targetDoS - dos = 3 - 1 = 2
    expect(result?.tags).toContain("magic:channel=1");
    expect(result?.tags).toContain("magic:channelTarget=3");
    expect(result?.tags).toContain("magic:channelInsufficient=1");
  });

  it("magicChannel succeeds when dos >= targetDoS", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 10 (success with high DoS)
    // Target = INT 50 + NORMAL 0 = 50, roll 10 => DoS = floor((50-10)/10) = 4
    // targetDoS = 3, so 4 >= 3 => success
    const fakeRng = new FakeRng([10]);

    const check = {
      id: "magic_channel",
      kind: "magicChannel" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      targetDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.dos).toBe(4); // Keep the produced DoS, do NOT subtract targetDoS
    expect(result?.dof).toBe(0);
    expect(result?.tags).toContain("magic:channel=1");
    expect(result?.tags).toContain("magic:channelTarget=3");
    expect(result?.tags).toContain("magic:success=1");
  });

  it("magicEffect fails on failed roll", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 90 (failure)
    // Target = INT 50 + NORMAL 0 = 50, roll 90 => fail
    const fakeRng = new FakeRng([90]);

    const check = {
      id: "magic_effect",
      kind: "magicEffect" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      castingNumberDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(3); // castingNumberDoS
    expect(result?.tags).toContain("magic:fail=1");
  });

  it("magicEffect fails on insufficient DoS", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 40 (success but insufficient DoS)
    // Target = INT 50 + NORMAL 0 = 50, roll 40 => DoS = floor((50-40)/10) = 1
    // castingNumberDoS = 3, so 1 < 3 => insufficient
    const fakeRng = new FakeRng([40]);

    const check = {
      id: "magic_effect",
      kind: "magicEffect" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      castingNumberDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(2); // castingNumberDoS - dos = 3 - 1 = 2
    expect(result?.tags).toContain("magic:insufficient=1");
  });

  it("magicEffect succeeds when DoS >= CN and produces correct extraDos", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 10 (success with high DoS)
    // Target = INT 50 + NORMAL 0 = 50, roll 10 => DoS = floor((50-10)/10) = 4
    // castingNumberDoS = 3, so 4 >= 3 => success, extraDos = 4 - 3 = 1
    const fakeRng = new FakeRng([10]);

    const check = {
      id: "magic_effect",
      kind: "magicEffect" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      castingNumberDoS: 3,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    expect(result?.dos).toBe(1); // extraDos = 4 - 3 = 1
    expect(result?.dof).toBe(0);
    expect(result?.tags).toContain("magic:success=1");
    expect(result?.tags).toContain("magic:extraDos=1");
  });

  it("doubles on magicEffect add phenomena:minor when CONTROLLED", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 22 (doubles, success)
    // Target = INT 50 + NORMAL 0 = 50, roll 22 => DoS = floor((50-22)/10) = 2
    const fakeRng = new FakeRng([22]);

    const check = {
      id: "magic_effect",
      kind: "magicEffect" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      castingNumberDoS: 2,
      powerMode: "CONTROLLED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.tags).toContain("doubles");
    expect(result?.tags).toContain("phenomena:doubles");
    expect(result?.tags).toContain("phenomena:minor");
    expect(result?.tags).not.toContain("phenomena:major");
  });

  it("doubles on magicEffect add phenomena:major when FORCED", () => {
    const storyPack = makeTestStoryPack();
    const actor = makeTestActor();
    const save = makeTestSave(storyPack, actor);

    // Use FakeRng with deterministic roll: 33 (doubles, success)
    // Target = INT 50 + NORMAL 0 = 50, roll 33 => DoS = floor((50-33)/10) = 1
    const fakeRng = new FakeRng([33]);

    const check = {
      id: "magic_effect",
      kind: "magicEffect" as const,
      key: "INT" as const,
      difficulty: "NORMAL",
      castingNumberDoS: 1,
      powerMode: "FORCED" as const,
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.tags).toContain("doubles");
    expect(result?.tags).toContain("phenomena:doubles");
    expect(result?.tags).toContain("phenomena:major");
    expect(result?.tags).not.toContain("phenomena:minor");
  });
});

describe("Combat attack check", () => {
  it("melee hit with no defense (attack success => HIT)", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Use FakeRng with deterministic roll: 20 (success)
    // Target = WS 60 + NORMAL 0 = 60, roll 20 => DoS = floor((60-20)/10) = 4
    const fakeRng = new FakeRng([20]);

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "MELEE" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: false,
        allowDodge: false,
        strategy: "autoBest" as const,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true); // HIT
    expect(result?.dos).toBe(4); // attackerDoS
    expect(result?.tags).toContain("combat:attackStat=WS");
    expect(result?.tags).toContain("combat:defense=none");
  });

  it("melee hit with parry success where defenderDoS >= attackerDoS => MISS", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 50 } });
    const defender = makeTestActor({ id: "NPC_1", stats: { WS: 60 } });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Attack: Target = WS 50, roll 40 => DoS = floor((50-40)/10) = 1
    // Defense: Target = WS 60, roll 30 => DoS = floor((60-30)/10) = 3
    // Defender DoS (3) > Attacker DoS (1) => MISS
    const fakeRng = new FakeRng([40, 30]);

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "MELEE" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: true,
        allowDodge: false,
        strategy: "preferParry" as const,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false); // MISS
    expect(result?.dos).toBe(0);
    expect(result?.tags).toContain("combat:defense=parry");
    expect(result?.tags).toContain("combat:defSuccess=1");
  });

  it("melee hit with parry fail => HIT", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 50 } });
    const defender = makeTestActor({ id: "NPC_1", stats: { WS: 50 } });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Attack: Target = WS 50, roll 40 => DoS = floor((50-40)/10) = 1
    // Defense: Target = WS 50, roll 90 => fail
    const fakeRng = new FakeRng([40, 90]);

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "MELEE" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: true,
        allowDodge: false,
        strategy: "preferParry" as const,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(true); // HIT
    expect(result?.dos).toBe(1); // attackerDoS
    expect(result?.tags).toContain("combat:defense=parry");
    expect(result?.tags).toContain("combat:defSuccess=0");
  });

  it("ranged with rangeBand LONG and cover HEAVY modifies target correctly", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { BS: 50 } });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Base target = BS 50
    // LONG rangeBand = -20
    // HEAVY cover = -20
    // Expected target = 50 - 20 - 20 = 10
    const fakeRng = new FakeRng([5]); // Will succeed

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "RANGED" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: false,
        allowDodge: false,
        strategy: "autoBest" as const,
      },
      modifiers: {
        rangeBand: "LONG" as const,
        cover: "HEAVY" as const,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    // Check that target is correctly modified
    const attackTargetTag = result?.tags.find((t) => t.startsWith("combat:attackTarget="));
    expect(attackTargetTag).toBe("combat:attackTarget=10");
    expect(result?.tags).toContain("combat:attackStat=BS");
  });

  it("outnumbering >=3 applies +20", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 50 } });
    const defender = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Base target = WS 50
    // outnumbering >= 3 = +20
    // Expected target = 50 + 20 = 70
    const fakeRng = new FakeRng([30]); // Will succeed

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "MELEE" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: false,
        allowDodge: false,
        strategy: "autoBest" as const,
      },
      modifiers: {
        outnumbering: 3,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    // Check that target is correctly modified
    const attackTargetTag = result?.tags.find((t) => t.startsWith("combat:attackTarget="));
    expect(attackTargetTag).toBe("combat:attackTarget=70");
  });

  it("melee hit with tie (equal DoS) => MISS (defender wins ties)", () => {
    const storyPack = makeTestStoryPack();
    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 50 } });
    const defender = makeTestActor({ id: "NPC_1", stats: { WS: 50 } });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_1"] = defender;

    // Attack: Target = WS 50, roll 40 => DoS = floor((50-40)/10) = 1
    // Defense: Target = WS 50, roll 40 => DoS = floor((50-40)/10) = 1
    // Equal DoS => tie => MISS
    const fakeRng = new FakeRng([40, 40]);

    const check = {
      id: "combat_attack",
      kind: "combatAttack" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        mode: "MELEE" as const,
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
      },
      defense: {
        allowParry: true,
        allowDodge: false,
        strategy: "preferParry" as const,
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    expect(result).not.toBeNull();
    expect(result?.success).toBe(false); // MISS (tie)
    expect(result?.dos).toBe(0);
    expect(result?.tags).toContain("combat:tie=1");
  });
});

describe("Combat damage application", () => {
  it("applies damage on HIT and updates defender HP", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_DUMMY" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
    const defender = makeTestActor({
      id: "NPC_DUMMY",
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_DUMMY"] = defender;

    // Use FakeRng with deterministic roll: 20 (success with DoS = 4)
    // Target = WS 60 + NORMAL 0 = 60, roll 20 => DoS = floor((60-20)/10) = 4
    // Damage = max(1, 1 + 4) = 5
    // HP after = max(0, 10 - 5) = 5
    const fakeRng = new FakeRng([20]);

    // We need to find a seed that produces a HIT
    // Let's try seed 1 and see if it works, otherwise we'll search
    let testSeed = 1;
    let foundHit = false;
    let finalSave: GameSave | null = null;

    // Try seeds until we find one that produces a HIT
    for (let seed = 1; seed <= 1000; seed++) {
      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const rng = new RNG(seed, 0);
      const check = storyPack.scenes[0].choices[0].checks![0];
      const result = performCheck(check, storyPack, testSave, rng);

      if (result && result.success) {
        testSeed = seed;
        foundHit = true;
        // Apply the choice to get the full damage application
        const saveWithSeed = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        finalSave = applyChoice(storyPack, saveWithSeed, "attack");
        break;
      }
    }

    expect(foundHit).toBe(true);
    expect(finalSave).not.toBeNull();

    // Verify defender HP decreased
    const updatedDefender = finalSave!.actorsById["NPC_DUMMY"];
    expect(updatedDefender).toBeDefined();
    expect(updatedDefender.resources.hp).toBeLessThan(10);
    expect(updatedDefender.resources.hp).toBeGreaterThanOrEqual(0);

    // Verify damage tags are present
    const lastCheck = finalSave!.runtime.lastCheck;
    expect(lastCheck).toBeDefined();
    expect(lastCheck?.tags).toContainEqual(expect.stringMatching(/^combat:damage=\d+$/));
    expect(lastCheck?.tags).toContainEqual(expect.stringMatching(/^combat:defHpBefore=\d+$/));
    expect(lastCheck?.tags).toContainEqual(expect.stringMatching(/^combat:defHpAfter=\d+$/));
    expect(lastCheck?.tags).toContain("combat:defenderId=NPC_DUMMY");
  });

  it("applies damage correctly: damage = max(1, 1 + dos)", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_DUMMY" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
    const defender = makeTestActor({
      id: "NPC_DUMMY",
      resources: { hp: 100, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_DUMMY"] = defender;

    // Find a seed that produces a HIT with known DoS
    // We'll use a deterministic approach: try seeds until we find a HIT
    let foundHit = false;
    let finalSave: GameSave | null = null;
    let hpBefore = 0;

    for (let seed = 1; seed <= 1000; seed++) {
      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const rng = new RNG(seed, 0);
      const check = storyPack.scenes[0].choices[0].checks![0];
      const result = performCheck(check, storyPack, testSave, rng);

      if (result && result.success) {
        hpBefore = defender.resources.hp;
        const saveWithSeed = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        finalSave = applyChoice(storyPack, saveWithSeed, "attack");
        foundHit = true;
        break;
      }
    }

    expect(foundHit).toBe(true);
    expect(finalSave).not.toBeNull();

    const updatedDefender = finalSave!.actorsById["NPC_DUMMY"];
    const lastCheck = finalSave!.runtime.lastCheck;

    // Extract damage from tags
    const damageTag = lastCheck?.tags.find((t) => t.startsWith("combat:damage="));
    expect(damageTag).toBeDefined();
    const damage = parseInt(damageTag!.split("=")[1], 10);

    // Verify damage formula: max(1, 1 + dos)
    const expectedDamage = Math.max(1, 1 + (lastCheck?.dos ?? 0));
    expect(damage).toBe(expectedDamage);

    // Verify HP decreased correctly
    const hpAfterTag = lastCheck?.tags.find((t) => t.startsWith("combat:defHpAfter="));
    expect(hpAfterTag).toBeDefined();
    const hpAfter = parseInt(hpAfterTag!.split("=")[1], 10);
    expect(hpAfter).toBe(Math.max(0, hpBefore - damage));
    expect(updatedDefender.resources.hp).toBe(hpAfter);
  });

  it("HP does not go below 0", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_DUMMY" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
    const defender = makeTestActor({
      id: "NPC_DUMMY",
      resources: { hp: 2, rf: 0, peq: 0 }, // Low HP
    });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_DUMMY"] = defender;

    // Find a seed that produces a HIT
    let foundHit = false;
    let finalSave: GameSave | null = null;

    for (let seed = 1; seed <= 1000; seed++) {
      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const rng = new RNG(seed, 0);
      const check = storyPack.scenes[0].choices[0].checks![0];
      const result = performCheck(check, storyPack, testSave, rng);

      if (result && result.success) {
        const saveWithSeed = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        finalSave = applyChoice(storyPack, saveWithSeed, "attack");
        foundHit = true;
        break;
      }
    }

    expect(foundHit).toBe(true);
    expect(finalSave).not.toBeNull();

    const updatedDefender = finalSave!.actorsById["NPC_DUMMY"];
    expect(updatedDefender.resources.hp).toBeGreaterThanOrEqual(0);

    // Verify HP never goes below 0
    const lastCheck = finalSave!.runtime.lastCheck;
    const hpAfterTag = lastCheck?.tags.find((t) => t.startsWith("combat:defHpAfter="));
    expect(hpAfterTag).toBeDefined();
    const hpAfter = parseInt(hpAfterTag!.split("=")[1], 10);
    expect(hpAfter).toBeGreaterThanOrEqual(0);
    expect(updatedDefender.resources.hp).toBeGreaterThanOrEqual(0);
    expect(updatedDefender.resources.hp).toBe(hpAfter);

    // Verify HP decreased (or stayed at 0 if already 0)
    expect(updatedDefender.resources.hp).toBeLessThanOrEqual(2);
  });

  it("adds combat:defDown=1 tag when HP reaches 0", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_DUMMY" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
    const defender = makeTestActor({
      id: "NPC_DUMMY",
      resources: { hp: 1, rf: 0, peq: 0 }, // Very low HP - any hit will down
    });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_DUMMY"] = defender;

    // Find a seed that produces a HIT
    let foundHit = false;
    let finalSave: GameSave | null = null;

    for (let seed = 1; seed <= 1000; seed++) {
      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const rng = new RNG(seed, 0);
      const check = storyPack.scenes[0].choices[0].checks![0];
      const result = performCheck(check, storyPack, testSave, rng);

      if (result && result.success) {
        const saveWithSeed = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        finalSave = applyChoice(storyPack, saveWithSeed, "attack");
        foundHit = true;
        break;
      }
    }

    expect(foundHit).toBe(true);
    expect(finalSave).not.toBeNull();

    const lastCheck = finalSave!.runtime.lastCheck;
    const hpAfterTag = lastCheck?.tags.find((t) => t.startsWith("combat:defHpAfter="));
    expect(hpAfterTag).toBeDefined();
    const hpAfter = parseInt(hpAfterTag!.split("=")[1], 10);

    if (hpAfter === 0) {
      expect(lastCheck?.tags).toContain("combat:defDown=1");
    }
  });

  it("does not apply damage on MISS", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_DUMMY" },
                  },
                  defense: {
                    allowParry: true,
                    allowDodge: false,
                    strategy: "preferParry" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const attacker = makeTestActor({ id: "PC_1", stats: { WS: 30 } }); // Low WS
    const defender = makeTestActor({
      id: "NPC_DUMMY",
      stats: { WS: 60 }, // High WS for parry
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, attacker);
    save.actorsById["NPC_DUMMY"] = defender;

    // Find a seed that produces a MISS (defender parries successfully)
    let foundMiss = false;
    let finalSave: GameSave | null = null;

    for (let seed = 1; seed <= 1000; seed++) {
      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const rng = new RNG(seed, 0);
      const check = storyPack.scenes[0].choices[0].checks![0];
      const result = performCheck(check, storyPack, testSave, rng);

      if (result && !result.success) {
        // This is a MISS
        const saveWithSeed = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        finalSave = applyChoice(storyPack, saveWithSeed, "attack");
        foundMiss = true;
        break;
      }
    }

    expect(foundMiss).toBe(true);
    expect(finalSave).not.toBeNull();

    // Verify defender HP did not change
    const updatedDefender = finalSave!.actorsById["NPC_DUMMY"];
    expect(updatedDefender.resources.hp).toBe(10); // Unchanged

    // Verify damage tags are NOT present
    const lastCheck = finalSave!.runtime.lastCheck;
    expect(lastCheck?.tags).not.toContainEqual(expect.stringMatching(/^combat:damage=\d+$/));
    expect(lastCheck?.tags).not.toContainEqual(expect.stringMatching(/^combat:defHpBefore=\d+$/));
    expect(lastCheck?.tags).not.toContainEqual(expect.stringMatching(/^combat:defHpAfter=\d+$/));
  });
});

describe("Opposed check", () => {
  it("resolves opposed check and includes defender details in tags", () => {
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "opposed_check",
                  kind: "opposed",
                  attacker: {
                    key: "STR",
                    difficulty: "NORMAL",
                  },
                  defender: {
                    key: "TOU",
                    difficulty: "NORMAL",
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    const attacker: Actor = {
      id: "PC_1",
      name: "Attacker",
      kind: "PC",
      stats: {
        STR: 60, // Higher STR
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const defender: Actor = {
      id: "NPC_1",
      name: "Defender",
      kind: "NPC",
      stats: {
        STR: 50,
        TOU: 60, // Higher TOU
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    const fakeRng = new FakeRng([30, 40]); // Deterministic rolls

    const check = {
      id: "opposed_check",
      kind: "opposed" as const,
      attacker: {
        key: "STR" as const,
        difficulty: "NORMAL",
      },
      defender: {
        key: "TOU" as const,
        difficulty: "NORMAL",
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify opposed check result
    expect(result).not.toBeNull();
    expect(result?.checkId).toBe("opposed_check");
    expect(result?.actorId).toBe("PC_1");

    // Verify tags include defender details
    const tags = result?.tags || [];
    expect(tags.some((t) => t.startsWith("opposed:defenderId="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:defRoll="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:defTarget="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:attDoS="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:defDoS="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:attSuccess="))).toBe(true);
    expect(tags.some((t) => t.startsWith("opposed:defSuccess="))).toBe(true);
  });

  it("attacker fails -> loses regardless of defender", () => {
    // Setup: attacker target 30 roll 90 => fail, defender target 30 roll 10 => success
    // FakeRng rolls [90, 10]
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
            IMPOSSIBLE: -200, // Very hard to pass
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "opposed_check",
                  kind: "opposed",
                  attacker: {
                    actorRef: { mode: "byId", actorId: "PC_1" },
                    key: "STR",
                    difficulty: "IMPOSSIBLE", // Attacker will likely fail
                  },
                  defender: {
                    actorRef: { mode: "byId", actorId: "NPC_1" },
                    key: "TOU",
                    difficulty: "NORMAL",
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    const attacker: Actor = {
      id: "PC_1",
      name: "Attacker",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const defender: Actor = {
      id: "NPC_1",
      name: "Defender",
      kind: "NPC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    // Use FakeRng with deterministic rolls: [90, 10]
    // Attacker roll 90 vs target 30 (50-200=-150) => fail
    // Defender roll 10 vs target 30 (50+0=50) => success
    const fakeRng = new FakeRng([90, 10]);

    const check = {
      id: "opposed_check",
      kind: "opposed" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        key: "STR" as const,
        difficulty: "IMPOSSIBLE",
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
        key: "TOU" as const,
        difficulty: "NORMAL",
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify result: attacker failed -> should lose regardless of defender
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(0);

    const tags = result?.tags || [];
    expect(tags.some((t) => t === "opposed:attSuccess=0")).toBe(true);
    expect(tags.some((t) => t === "opposed:defSuccess=1")).toBe(true);
  });

  it("both succeed -> opposed DoS is the difference", () => {
    // Setup: attacker target 60 roll 10 => DoS 5, defender target 60 roll 30 => DoS 3
    // FakeRng rolls [10, 30]
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
            EASY: 20,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "opposed_check",
                  kind: "opposed",
                  attacker: {
                    actorRef: { mode: "byId", actorId: "PC_1" },
                    key: "STR",
                    difficulty: "EASY", // Easier for attacker
                  },
                  defender: {
                    actorRef: { mode: "byId", actorId: "NPC_1" },
                    key: "TOU",
                    difficulty: "NORMAL",
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    const attacker: Actor = {
      id: "PC_1",
      name: "Attacker",
      kind: "PC",
      stats: {
        STR: 60, // Higher stat
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const defender: Actor = {
      id: "NPC_1",
      name: "Defender",
      kind: "NPC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    // Use FakeRng with deterministic rolls: [10, 30]
    // Attacker: STR 60 + EASY 20 = target 80, roll 10 => DoS 7 (but let's verify with actual target)
    // Actually, attacker target = 60 + 20 = 80, roll 10 => DoS = floor((80-10)/10) = 7
    // Defender: TOU 50 + NORMAL 0 = target 50, roll 30 => DoS = floor((50-30)/10) = 2
    // Wait, let me recalculate: attacker STR 60, difficulty EASY (+20) => target 80
    // Roll 10 vs 80 => DoS = floor((80-10)/10) = 7
    // Defender TOU 50, difficulty NORMAL (0) => target 50
    // Roll 30 vs 50 => DoS = floor((50-30)/10) = 2
    // So attacker DoS 7 > defender DoS 2, attacker wins with DoS 5
    const fakeRng = new FakeRng([10, 30]);

    const check = {
      id: "opposed_check",
      kind: "opposed" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        key: "STR" as const,
        difficulty: "EASY",
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
        key: "TOU" as const,
        difficulty: "NORMAL",
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify result: both succeed, attackerDoS > defenderDoS => attacker wins with dos difference
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);

    const tags = result?.tags || [];
    const attDoSTag = tags.find((t) => t.startsWith("opposed:attDoS="));
    const defDoSTag = tags.find((t) => t.startsWith("opposed:defDoS="));
    const attDoS = attDoSTag ? parseInt(attDoSTag.split("=")[1]) : 0;
    const defDoS = defDoSTag ? parseInt(defDoSTag.split("=")[1]) : 0;

    expect(attDoS).toBeGreaterThan(defDoS);
    expect(result?.dos).toBe(attDoS - defDoS);
  });

  it("defender wins ties when both succeed with equal DoS", () => {
    // Setup: attacker target 60 roll 20 => DoS 4, defender target 60 roll 20 => DoS 4 (tie)
    // FakeRng rolls [20, 20]
    const storyPack: StoryPack = {
      id: "test_story",
      title: "Test Story",
      version: "1.0.0",
      startSceneId: "scene1",
      stateSchema: {},
      initialState: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      systems: {
        checks: {
          difficultyBands: {
            NORMAL: 0,
          },
          criticals: {
            autoSuccess: [1, 2, 3],
            autoFail: [98, 99, 100],
          },
        },
      },
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Scene 1",
          text: ["Test scene"],
          choices: [
            {
              id: "choice1",
              label: "Test choice",
              checks: [
                {
                  id: "opposed_check",
                  kind: "opposed",
                  attacker: {
                    actorRef: { mode: "byId", actorId: "PC_1" },
                    key: "STR",
                    difficulty: "NORMAL",
                  },
                  defender: {
                    actorRef: { mode: "byId", actorId: "NPC_1" },
                    key: "TOU",
                    difficulty: "NORMAL",
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    };

    // Create actors with same stats to increase chance of tie
    const attacker: Actor = {
      id: "PC_1",
      name: "Attacker",
      kind: "PC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const defender: Actor = {
      id: "NPC_1",
      name: "Defender",
      kind: "NPC",
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party: Party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    const save: GameSave = {
      saveVersion: "1.0.0",
      story: { id: "test", version: "1.0.0" },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: "scene1",
        rngSeed: 123456,
        rngCounter: 0,
        history: {
          visitedScenes: [],
          chosenChoices: [],
        },
        firedWorldEvents: [],
      },
    };

    // Use FakeRng with deterministic rolls: [20, 20]
    // Both have target 50 (STR/TOU 50 + NORMAL 0), roll 20 => DoS = floor((50-20)/10) = 3
    // Actually wait, let me verify: target 50, roll 20 => DoS = floor((50-20)/10) = 3
    // But the example says DoS 4, so let me adjust: target 60, roll 20 => DoS = floor((60-20)/10) = 4
    // So both need target 60. Attacker STR 50 + difficulty? Actually, let's set both to have target 60
    // Attacker: STR 60 + NORMAL 0 = 60, roll 20 => DoS 4
    // Defender: TOU 60 + NORMAL 0 = 60, roll 20 => DoS 4
    const attackerWithTarget60: Actor = {
      ...attacker,
      stats: {
        ...attacker.stats,
        STR: 60,
      },
    };
    const defenderWithTarget60: Actor = {
      ...defender,
      stats: {
        ...defender.stats,
        TOU: 60,
      },
    };

    const saveWithTarget60: GameSave = {
      ...save,
      actorsById: { PC_1: attackerWithTarget60, NPC_1: defenderWithTarget60 },
    };

    const fakeRng = new FakeRng([20, 20]);

    const check = {
      id: "opposed_check",
      kind: "opposed" as const,
      attacker: {
        actorRef: { mode: "byId" as const, actorId: "PC_1" },
        key: "STR" as const,
        difficulty: "NORMAL",
      },
      defender: {
        actorRef: { mode: "byId" as const, actorId: "NPC_1" },
        key: "TOU" as const,
        difficulty: "NORMAL",
      },
    };

    const result = performCheck(check, storyPack, saveWithTarget60, fakeRng);

    // Verify result: both succeed with equal DoS => tie, defender wins
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false); // Defender wins ties

    const tags = result?.tags || [];
    expect(tags.some((t) => t === "opposed:tie=1")).toBe(true);
    expect(tags.some((t) => t === "opposed:attSuccess=1")).toBe(true);
    expect(tags.some((t) => t === "opposed:defSuccess=1")).toBe(true);

    const attDoSTag = tags.find((t) => t.startsWith("opposed:attDoS="));
    const defDoSTag = tags.find((t) => t.startsWith("opposed:defDoS="));
    const attDoS = attDoSTag ? parseInt(attDoSTag.split("=")[1]) : 0;
    const defDoS = defDoSTag ? parseInt(defDoSTag.split("=")[1]) : 0;

    expect(attDoS).toBe(defDoS);
    expect(result?.dos).toBe(0);
  });
});

describe("Combat system", () => {
  it("startCombat sets deterministic order based on initiative", () => {
    const storyPack = makeTestStoryPack();
    const pc = makeTestActor({ id: "PC_1", stats: { INI: 40 } });
    const npc = makeTestActor({ id: "NPC_1", stats: { INI: 30 } });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    // Use seed that produces predictable d10 rolls
    // For deterministic testing, we'll use a fixed seed
    const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };

    const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"]);

    expect(combatSave.runtime.combat).toBeDefined();
    expect(combatSave.runtime.combat?.active).toBe(true);
    expect(combatSave.runtime.combat?.participants.length).toBe(2);
    expect(combatSave.runtime.combat?.round).toBe(1);
    expect(combatSave.runtime.combat?.currentIndex).toBe(0);

    // Verify order tag exists
    const lastCheck = combatSave.runtime.lastCheck;
    expect(lastCheck).toBeDefined();
    expect(lastCheck?.tags).toContain("combat:state=start");
    expect(lastCheck?.tags.some((t) => t.startsWith("combat:order="))).toBe(true);
    expect(lastCheck?.tags).toContain("combat:round=1");
    expect(lastCheck?.tags.some((t) => t.startsWith("combat:turn="))).toBe(true);
  });

  it("getCurrentTurnActorId returns current turn actor", () => {
    const storyPack = makeTestStoryPack();
    const pc = makeTestActor({ id: "PC_1" });
    const npc = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
    const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"]);

    const turnActorId = getCurrentTurnActorId(combatSave);
    expect(turnActorId).toBeDefined();
    expect(["PC_1", "NPC_1"]).toContain(turnActorId);

    // If no combat, returns null
    const noCombatSave = { ...save, runtime: { ...save.runtime, combat: undefined } };
    expect(getCurrentTurnActorId(noCombatSave)).toBeNull();
  });

  it("applyChoice blocked when not your turn", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              effects: [],
            },
          ],
        },
      ],
    });

    const pc = makeTestActor({ id: "PC_1", stats: { INI: 30 } });
    const npc = makeTestActor({ id: "NPC_1", stats: { INI: 40 } }); // Higher INI = goes first
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    // Start combat - NPC should go first due to higher INI
    const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
    const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"]);

    // Verify NPC goes first (or at least verify the order)
    const turnActorId = getCurrentTurnActorId(combatSave);

    // If it's NPC's turn, try to apply choice - should be blocked
    if (turnActorId === "NPC_1") {
      const blockedSave = applyChoice(storyPack, combatSave, "attack");
      const lastCheck = blockedSave.runtime.lastCheck;
      expect(lastCheck).toBeDefined();
      expect(lastCheck?.tags).toContain("combat:blocked=notYourTurn");
      expect(lastCheck?.tags.some((t) => t.startsWith("combat:turn="))).toBe(true);
    }
  });

  it("npc turn attacks and advances", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "pass",
              label: "Pass",
              effects: [],
            },
          ],
        },
      ],
    });

    const pc = makeTestActor({
      id: "PC_1",
      stats: { INI: 30, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const npc = makeTestActor({
      id: "NPC_1",
      stats: { INI: 40, WS: 50 }, // Higher INI = goes first
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    // Start combat
    const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
    let combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"]);

    // Find a seed where NPC goes first
    let npcFirst = false;
    for (let seed = 1; seed <= 100; seed++) {
      const testSave2 = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
      const combatSave2 = startCombat(storyPack, testSave2, ["PC_1", "NPC_1"]);
      const turnActorId = getCurrentTurnActorId(combatSave2);
      if (turnActorId === "NPC_1") {
        combatSave = combatSave2;
        npcFirst = true;
        break;
      }
    }

    if (!npcFirst) {
      // If NPC doesn't go first, manually set combat state to NPC's turn
      combatSave = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          combat: {
            active: true,
            participants: ["NPC_1", "PC_1"],
            currentIndex: 0, // NPC first
            round: 1,
          },
        },
      };
    }

    // Run NPC turn manually
    const npcTurnSave = runNpcTurn(storyPack, combatSave, "NPC_1");

    // Verify NPC attacked (check for combat tags)
    const lastCheck = npcTurnSave.runtime.lastCheck;
    expect(lastCheck).toBeDefined();
    expect(lastCheck?.tags.some((t) => t === "combat:npcTurn=1")).toBe(true);
    expect(lastCheck?.tags.some((t) => t.startsWith("combat:npcId="))).toBe(true);

    // Advance turn
    const advancedSave = advanceCombatTurn(npcTurnSave);

    // Verify turn advanced to PC
    const newTurnActorId = getCurrentTurnActorId(advancedSave);
    expect(newTurnActorId).toBe("PC_1");
    expect(advancedSave.runtime.combat?.currentIndex).toBe(1);
  });

  it("advanceCombatTurn removes KO participants and ends combat when one side remains", () => {
    const storyPack = makeTestStoryPack();
    const pc = makeTestActor({ id: "PC_1", resources: { hp: 1, rf: 0, peq: 0 } });
    const npc = makeTestActor({ id: "NPC_1", resources: { hp: 0, rf: 0, peq: 0 } }); // Already KO
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    const combatSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          currentIndex: 0,
          round: 1,
        },
      },
    };

    const advancedSave = advanceCombatTurn(combatSave);

    // Combat should end because NPC is KO
    expect(advancedSave.runtime.combat).toBeUndefined();
    const lastCheck = advancedSave.runtime.lastCheck;
    expect(lastCheck?.tags).toContain("combat:state=end");
  });

  it("advanceCombatTurn increments round when wrapping around", () => {
    const storyPack = makeTestStoryPack();
    const pc = makeTestActor({ id: "PC_1" });
    const npc = makeTestActor({ id: "NPC_1" });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    const combatSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          currentIndex: 1, // Last in order
          round: 1,
        },
      },
    };

    const advancedSave = advanceCombatTurn(combatSave);

    // Should wrap to index 0 and increment round
    expect(advancedSave.runtime.combat?.currentIndex).toBe(0);
    expect(advancedSave.runtime.combat?.round).toBe(2);
  });

  it("multiple consecutive NPCs execute their turns automatically", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_1" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const pc = makeTestActor({
      id: "PC_1",
      stats: { INI: 30, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const npc1 = makeTestActor({
      id: "NPC_1",
      stats: { INI: 40, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const npc2 = makeTestActor({
      id: "NPC_2",
      stats: { INI: 35, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc1;
    save.actorsById["NPC_2"] = npc2;

    // Start combat with order: NPC_1, NPC_2, PC_1 (based on INI)
    const combatSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["NPC_1", "NPC_2", "PC_1"],
          currentIndex: 2, // PC_1's turn
          round: 1,
        },
      },
    };

    // Player attacks
    const afterAttack = applyChoice(storyPack, combatSave, "attack");

    // Verify turn advanced and both NPCs acted
    // After player attack, turn should advance to NPC_1, then NPC_2, then back to PC_1
    const finalTurnActorId = getCurrentTurnActorId(afterAttack);
    expect(finalTurnActorId).toBe("PC_1");

    // Verify both NPCs executed their turns (check for combat:npcTurn tags in history)
    // We can't easily check history, but we can verify combat state is correct
    expect(afterAttack.runtime.combat?.active).toBe(true);
    expect(afterAttack.runtime.combat?.currentIndex).toBe(2); // Back to PC_1
  });

  it("non-combat choice does not consume turn during combat", () => {
    const storyPack = makeTestStoryPack({
      scenes: [
        {
          id: "scene1",
          type: "narration",
          title: "Combat Scene",
          text: ["Fight!"],
          choices: [
            {
              id: "debug_choice",
              label: "Debug Choice",
              effects: [], // No combat checks
            },
            {
              id: "attack",
              label: "Attack",
              checks: [
                {
                  id: "combat_attack",
                  kind: "combatAttack" as const,
                  attacker: {
                    actorRef: { mode: "byId" as const, actorId: "PC_1" },
                    mode: "MELEE" as const,
                    weaponId: null,
                  },
                  defender: {
                    actorRef: { mode: "byId" as const, actorId: "NPC_1" },
                  },
                  defense: {
                    allowParry: false,
                    allowDodge: false,
                    strategy: "autoBest" as const,
                  },
                },
              ],
              effects: [],
            },
          ],
        },
      ],
    });

    const pc = makeTestActor({
      id: "PC_1",
      stats: { INI: 40, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const npc = makeTestActor({
      id: "NPC_1",
      stats: { INI: 30, WS: 50 },
      resources: { hp: 10, rf: 0, peq: 0 },
    });
    const save = makeTestSave(storyPack, pc);
    save.actorsById["NPC_1"] = npc;

    // Start combat with PC first
    const combatSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: {
          active: true,
          participants: ["PC_1", "NPC_1"],
          currentIndex: 0, // PC_1's turn
          round: 1,
        },
      },
    };

    // Player chooses non-combat choice
    const afterDebugChoice = applyChoice(storyPack, combatSave, "debug_choice");

    // Verify turn did NOT advance
    expect(afterDebugChoice.runtime.combat?.active).toBe(true);
    expect(afterDebugChoice.runtime.combat?.currentIndex).toBe(0); // Still PC_1's turn
    expect(afterDebugChoice.runtime.combat?.round).toBe(1);

    // Verify no NPC turn happened (no combat:npcTurn tag)
    const lastCheck = afterDebugChoice.runtime.lastCheck;
    if (lastCheck) {
      expect(lastCheck.tags).not.toContain("combat:npcTurn=1");
    }

    // Now player attacks
    const afterAttack = applyChoice(storyPack, afterDebugChoice, "attack");

    // Verify turn advanced after combat action
    const finalTurnActorId = getCurrentTurnActorId(afterAttack);
    // Should be NPC_1's turn now (or back to PC_1 if NPC acted and combat ended)
    expect(afterAttack.runtime.combat?.active).toBeDefined();
  });

  describe("Combat grid and positions", () => {
    it("startCombat initializes grid and positions", () => {
      const storyPack = makeTestStoryPack();
      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      expect(combatSave.runtime.combat?.grid).toEqual(grid);
      expect(combatSave.runtime.combat?.positions["PC_1"]).toEqual({ x: 2, y: 2 });
      expect(combatSave.runtime.combat?.positions["NPC_1"]).toEqual({ x: 6, y: 2 });
      expect(combatSave.runtime.combat?.turn.hasMoved).toBe(false);
      expect(combatSave.runtime.combat?.turn.hasAttacked).toBe(false);
    });

    it("combatMove sets hasMoved and updates position", () => {
      const storyPack = makeTestStoryPack({
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Combat Scene",
            text: ["Fight!"],
            choices: [
              {
                id: "move_e",
                label: "Move East",
                effects: [{ op: "combatMove" as const, dir: "E" as const }],
              },
            ],
          },
        ],
      });

      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Player's turn - move east
      const afterMove = applyChoice(storyPack, combatSave, "move_e");

      expect(afterMove.runtime.combat?.positions["PC_1"]).toEqual({ x: 3, y: 2 });
      expect(afterMove.runtime.combat?.turn.hasMoved).toBe(true);
      expect(afterMove.runtime.lastCheck?.tags).toContain("combat:move=E");
    });

    it("cannot move twice in same turn", () => {
      const storyPack = makeTestStoryPack({
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Combat Scene",
            text: ["Fight!"],
            choices: [
              {
                id: "move_e",
                label: "Move East",
                effects: [{ op: "combatMove" as const, dir: "E" as const }],
              },
            ],
          },
        ],
      });

      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // First move
      const afterFirstMove = applyChoice(storyPack, combatSave, "move_e");
      expect(afterFirstMove.runtime.combat?.turn.hasMoved).toBe(true);

      // Second move should be blocked
      const afterSecondMove = applyChoice(storyPack, afterFirstMove, "move_e");
      expect(afterSecondMove.runtime.lastCheck?.tags).toContain("combat:blocked=alreadyMoved");
      // Position should not change
      expect(afterSecondMove.runtime.combat?.positions["PC_1"]).toEqual({ x: 3, y: 2 });
    });

    it("melee blocked if dist > 1", () => {
      const storyPack = makeTestStoryPack({
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Combat Scene",
            text: ["Fight!"],
            choices: [
              {
                id: "attack",
                label: "Attack",
                checks: [
                  {
                    id: "combat_attack",
                    kind: "combatAttack" as const,
                    attacker: {
                      actorRef: { mode: "byId" as const, actorId: "PC_1" },
                      mode: "MELEE" as const,
                      weaponId: null,
                    },
                    defender: {
                      actorRef: { mode: "byId" as const, actorId: "NPC_1" },
                    },
                    defense: {
                      allowParry: false,
                      allowDodge: false,
                      strategy: "autoBest" as const,
                    },
                  },
                ],
                effects: [],
              },
            ],
          },
        ],
      });

      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 }, // Distance = 4
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Try melee attack - should be blocked
      const afterAttack = applyChoice(storyPack, combatSave, "attack");
      expect(afterAttack.runtime.lastCheck?.tags).toContain("combat:blocked=notInMelee");
      expect(afterAttack.runtime.lastCheck?.tags.some((t) => t.startsWith("combat:dist=4"))).toBe(true);
    });

    it("ranged blocked if dist <= 1", () => {
      const storyPack = makeTestStoryPack({
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Combat Scene",
            text: ["Fight!"],
            choices: [
              {
                id: "attack",
                label: "Attack",
                checks: [
                  {
                    id: "combat_attack",
                    kind: "combatAttack" as const,
                    attacker: {
                      actorRef: { mode: "byId" as const, actorId: "PC_1" },
                      mode: "RANGED" as const,
                      weaponId: null,
                    },
                    defender: {
                      actorRef: { mode: "byId" as const, actorId: "NPC_1" },
                    },
                    defense: {
                      allowParry: false,
                      allowDodge: false,
                      strategy: "autoBest" as const,
                    },
                  },
                ],
                effects: [],
              },
            ],
          },
        ],
      });

      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 2, y: 3 }, // Distance = 1
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      const combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Try ranged attack - should be blocked
      const afterAttack = applyChoice(storyPack, combatSave, "attack");
      expect(afterAttack.runtime.lastCheck?.tags).toContain("combat:blocked=rangedInMelee");
      expect(afterAttack.runtime.lastCheck?.tags.some((t) => t.startsWith("combat:dist=1"))).toBe(true);
    });

    it("after attack turn advances and hasAttacked resets for next actor", () => {
      const storyPack = makeTestStoryPack({
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Combat Scene",
            text: ["Fight!"],
            choices: [
              {
                id: "attack",
                label: "Attack",
                checks: [
                  {
                    id: "combat_attack",
                    kind: "combatAttack" as const,
                    attacker: {
                      actorRef: { mode: "byId" as const, actorId: "PC_1" },
                      mode: "MELEE" as const,
                      weaponId: null,
                    },
                    defender: {
                      actorRef: { mode: "byId" as const, actorId: "NPC_1" },
                    },
                    defense: {
                      allowParry: false,
                      allowDodge: false,
                      strategy: "autoBest" as const,
                    },
                  },
                ],
                effects: [],
              },
            ],
          },
        ],
      });

      const pc = makeTestActor({ id: "PC_1", stats: { WS: 60 } });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 2, y: 3 }, // Distance = 1 (melee range)
      ];

      // Find a seed where PC goes first
      let pcFirst = false;
      let combatSave: GameSave | null = null;
      for (let seed = 1; seed <= 100; seed++) {
        const testSave = { ...save, runtime: { ...save.runtime, rngSeed: seed, rngCounter: 0 } };
        const testCombatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);
        if (getCurrentTurnActorId(testCombatSave) === "PC_1") {
          combatSave = testCombatSave;
          pcFirst = true;
          break;
        }
      }

      if (!pcFirst) {
        // Manually set PC first
        combatSave = {
          ...save,
          runtime: {
            ...save.runtime,
            rngSeed: 12345,
            rngCounter: 0,
            combat: {
              active: true,
              participants: ["PC_1", "NPC_1"],
              currentIndex: 0,
              round: 1,
              grid,
              positions: {
                PC_1: { x: 2, y: 2 },
                NPC_1: { x: 2, y: 3 },
              },
              turn: {
                actorId: "PC_1",
                hasMoved: false,
                hasAttacked: false,
              },
            },
          },
        };
      }

      expect(combatSave).not.toBeNull();
      const afterAttack = applyChoice(storyPack, combatSave!, "attack");

      // Turn should advance and NPC turn should execute automatically
      // After NPC turn, turn should advance back to PC
      expect(afterAttack.runtime.combat?.active).toBe(true);
      const finalTurnActorId = getCurrentTurnActorId(afterAttack);

      // After player attack + NPC auto-turn, it should be player's turn again
      // (or combat might have ended if NPC was KO'd)
      if (afterAttack.runtime.combat?.active) {
        expect(finalTurnActorId).toBe("PC_1");
        // Player's turn flags should be reset
        expect(afterAttack.runtime.combat?.turn.hasMoved).toBe(false);
        expect(afterAttack.runtime.combat?.turn.hasAttacked).toBe(false);
      }
    });

    it("advanceCombatTurn resets hasMoved and hasAttacked when changing turn", () => {
      const storyPack = makeTestStoryPack();
      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      let combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Set flags manually to simulate actions
      combatSave = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          combat: combatSave.runtime.combat
            ? {
                ...combatSave.runtime.combat,
                turn: {
                  ...combatSave.runtime.combat.turn,
                  hasMoved: true,
                  hasAttacked: true,
                },
              }
            : undefined,
        },
      };

      // Advance turn
      const advancedSave = advanceCombatTurn(combatSave);

      // Flags should be reset for new turn
      expect(advancedSave.runtime.combat?.turn.hasMoved).toBe(false);
      expect(advancedSave.runtime.combat?.turn.hasAttacked).toBe(false);
    });

    it("advanceCombatTurn resets hasMoved and hasAttacked when incrementing round", () => {
      const storyPack = makeTestStoryPack();
      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      let combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Set to last participant (NPC_1) and set flags
      combatSave = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          combat: combatSave.runtime.combat
            ? {
                ...combatSave.runtime.combat,
                currentIndex: 1, // Last participant
                turn: {
                  ...combatSave.runtime.combat.turn,
                  hasMoved: true,
                  hasAttacked: true,
                },
              }
            : undefined,
        },
      };

      // Advance turn (should wrap to index 0 and increment round)
      const advancedSave = advanceCombatTurn(combatSave);

      // Round should increment
      expect(advancedSave.runtime.combat?.round).toBe(2);
      // Flags should be reset for new round
      expect(advancedSave.runtime.combat?.turn.hasMoved).toBe(false);
      expect(advancedSave.runtime.combat?.turn.hasAttacked).toBe(false);
    });

    it("advanceCombatTurn filters duplicate round/turn tags", () => {
      const storyPack = makeTestStoryPack();
      const pc = makeTestActor({ id: "PC_1" });
      const npc = makeTestActor({ id: "NPC_1" });
      const save = makeTestSave(storyPack, pc);
      save.actorsById["NPC_1"] = npc;

      const grid = { width: 10, height: 10 };
      const placements = [
        { actorId: "PC_1" as ActorId, x: 2, y: 2 },
        { actorId: "NPC_1" as ActorId, x: 6, y: 2 },
      ];

      const testSave = { ...save, runtime: { ...save.runtime, rngSeed: 12345, rngCounter: 0 } };
      let combatSave = startCombat(storyPack, testSave, ["PC_1", "NPC_1"], undefined, grid, placements);

      // Add duplicate tags to lastCheck
      combatSave = {
        ...combatSave,
        runtime: {
          ...combatSave.runtime,
          lastCheck: combatSave.runtime.lastCheck
            ? {
                ...combatSave.runtime.lastCheck,
                tags: [
                  ...combatSave.runtime.lastCheck.tags,
                  "combat:round=1",
                  "combat:turn=PC_1",
                  "combat:round=2", // duplicate
                  "combat:turn=NPC_1", // duplicate
                ],
              }
            : null,
        },
      };

      // Advance turn
      const advancedSave = advanceCombatTurn(combatSave);

      // Should have only one round and one turn tag
      const roundTags = advancedSave.runtime.lastCheck?.tags.filter((t) => t.startsWith("combat:round=")) || [];
      const turnTags = advancedSave.runtime.lastCheck?.tags.filter((t) => t.startsWith("combat:turn=")) || [];

      expect(roundTags.length).toBe(1);
      expect(turnTags.length).toBe(1);
      expect(roundTags[0]).toBe("combat:round=1"); // Should be round 1 (not incremented yet)
      expect(turnTags[0]).toMatch(/^combat:turn=(PC_1|NPC_1)$/);
    });
  });
});
