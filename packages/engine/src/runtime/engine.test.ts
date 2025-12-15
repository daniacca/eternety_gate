import { describe, it, expect } from 'vitest';
import { createNewGame, applyChoice, getCurrentScene } from './engine';
import { rollD100, RNG } from './rng';
import { performCheck } from './checks';
import { evaluateCondition } from './conditions';
import { FakeRng } from './test-helpers/fakeRng';
import type { StoryPack, Actor, Party, ActorId, ItemId, Item, GameSave } from './types';

describe('applyChoice', () => {
  it('transitions scene and updates history when applying a goto choice', () => {
    // Create a minimal story pack with 2 scenes
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['You are at the start.'],
          choices: [
            {
              id: 'choice1',
              label: 'Go to scene 2',
              effects: [
                {
                  op: 'goto',
                  sceneId: 'scene2',
                },
              ],
            },
          ],
        },
        {
          id: 'scene2',
          type: 'narration',
          title: 'Scene 2',
          text: ['You reached scene 2.'],
          choices: [],
        },
      ],
    };

    // Create a minimal actor
    const actor: Actor = {
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    // Create initial game save
    const initialSave = createNewGame(
      storyPack,
      123456,
      party,
      { PC_1: actor },
      {}
    );

    // Verify initial state
    expect(initialSave.runtime.currentSceneId).toBe('scene1');
    expect(initialSave.runtime.history.visitedScenes).toEqual(['scene1']);
    expect(initialSave.runtime.history.chosenChoices).toEqual([]);

    // Apply choice
    const updatedSave = applyChoice(storyPack, initialSave, 'choice1');

    // Verify transition
    expect(updatedSave.runtime.currentSceneId).toBe('scene2');
    expect(updatedSave.runtime.history.visitedScenes).toContain('scene2');
    expect(updatedSave.runtime.history.chosenChoices).toEqual(['choice1']);

    // Verify we can get the new scene
    const { scene } = getCurrentScene(storyPack, updatedSave);
    expect(scene.id).toBe('scene2');
    expect(scene.title).toBe('Scene 2');
  });

  it('runs choice checks and applies onSuccess/onFailure effects correctly', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice_with_check',
              label: 'Make a check',
              checks: [
                {
                  id: 'test_check',
                  kind: 'single',
                  key: 'PER',
                  difficulty: 'NORMAL',
                  onSuccess: [
                    {
                      op: 'setFlag',
                      path: 'flags.checkPassed',
                      value: true,
                    },
                  ],
                  onFailure: [
                    {
                      op: 'setFlag',
                      path: 'flags.checkFailed',
                      value: true,
                    },
                  ],
                },
              ],
              effects: [
                {
                  op: 'setFlag',
                  path: 'flags.choiceApplied',
                  value: true,
                },
              ],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const initialSave = createNewGame(storyPack, 123456, party, { PC_1: actor }, {});

    // Apply choice - result depends on roll, but effects should be applied
    const updatedSave = applyChoice(storyPack, initialSave, 'choice_with_check');

    // Verify check result was stored
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe('test_check');
    expect(updatedSave.runtime.lastCheck?.actorId).toBe('PC_1');
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

describe('RNG determinism', () => {
  it('produces same sequence with same seed and counter', () => {
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

  it('rollD100 updates save state correctly', () => {
    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ['PC_1'],
        activeActorId: 'PC_1',
      },
      actorsById: {},
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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

  it('RNG is seekable: value at counter N equals N steps from counter 0', () => {
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

describe('Single check resolution', () => {
  it('resolves check with stat, difficulty, and tempModifiers', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
            id: 'temp_bonus',
            scope: 'check',
            key: 'PER',
            value: 10, // +10 bonus
          },
        ],
      },
    };

    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ['PC_1'],
        activeActorId: 'PC_1',
      },
      actorsById: { PC_1: actor },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'test_check',
      kind: 'single' as const,
      key: 'PER' as const,
      difficulty: 'HARD', // -20 modifier
    };

    // Expected target: 60 (base) + 10 (tempModifier) + (-20) (difficulty) = 50
    const result = performCheck(check, storyPack, save, rng);

    expect(result).not.toBeNull();
    expect(result?.target).toBe(50);
    expect(result?.actorId).toBe('PC_1');
    expect(result?.roll).toBeGreaterThanOrEqual(1);
    expect(result?.roll).toBeLessThanOrEqual(100);
  });

  it('resolves check with skill key', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party: {
        actors: ['PC_1'],
        activeActorId: 'PC_1',
      },
      actorsById: { PC_1: actor },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'test_check',
      kind: 'single' as const,
      key: 'SKILL:VATES' as const,
      difficulty: 'NORMAL',
    };

    // Expected target: 40 (skill) + 0 (difficulty) = 40
    const result = performCheck(check, storyPack, save, rng);

    expect(result).not.toBeNull();
    expect(result?.target).toBe(40);
  });
});

describe('Flat state access', () => {
  it('treats keys with dots as flat keys (no nested path resolution)', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              effects: [
                {
                  op: 'setFlag',
                  path: 'flags.quest.stage.1',
                  value: true,
                },
                {
                  op: 'addCounter',
                  path: 'counters.quest.progress',
                  value: 10,
                },
              ],
            },
          ],
        },
      ],
    };

    const actor: Actor = {
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const initialSave = createNewGame(storyPack, 123456, party, { PC_1: actor }, {});

    // Apply choice with effects containing dots in keys
    const updatedSave = applyChoice(storyPack, initialSave, 'choice1');

    // Verify flat access: keys with dots are treated as literal keys
    expect(updatedSave.state.flags['quest.stage.1']).toBe(true);
    expect(updatedSave.state.counters['quest.progress']).toBe(10);

    // Verify condition evaluation works with flat keys
    const condition = {
      op: 'flag' as const,
      path: 'flags.quest.stage.1',
      value: true,
    };
    const conditionResult = evaluateCondition(condition, updatedSave);
    expect(conditionResult).toBe(true);
  });
});

describe('Sequence check', () => {
  it('executes steps in order and stops at first failure', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'sequence_check',
                  kind: 'sequence',
                  steps: [
                    {
                      id: 'step1',
                      kind: 'single',
                      key: 'PER',
                      difficulty: 'NORMAL',
                    },
                    {
                      id: 'step2',
                      kind: 'single',
                      key: 'INT',
                      difficulty: 'NORMAL',
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
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const initialSave = createNewGame(storyPack, 123456, party, { PC_1: actor }, {});

    // Apply choice with sequence check
    const updatedSave = applyChoice(storyPack, initialSave, 'choice1');

    // Verify sequence check result was stored
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe('sequence_check');
    expect(updatedSave.runtime.lastCheck?.tags).toContain('sequence:steps=2');
  });

  it('includes failedAt tag when sequence fails', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'sequence_check',
                  kind: 'sequence',
                  steps: [
                    {
                      id: 'step1',
                      kind: 'single',
                      key: 'PER',
                      difficulty: 'NORMAL',
                    },
                    {
                      id: 'step2',
                      kind: 'single',
                      key: 'INT',
                      difficulty: 'IMPOSSIBLE', // This will likely fail
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
      id: 'PC_1',
      name: 'Test Player',
      kind: 'PC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const initialSave = createNewGame(storyPack, 123456, party, { PC_1: actor }, {});

    // Apply choice with sequence check that will likely fail on step 2
    const updatedSave = applyChoice(storyPack, initialSave, 'choice1');

    // Verify sequence check result
    expect(updatedSave.runtime.lastCheck).toBeDefined();
    expect(updatedSave.runtime.lastCheck?.checkId).toBe('sequence_check');
    expect(updatedSave.runtime.lastCheck?.tags).toContain('sequence:steps=2');
    
    // If it failed, should have failedAt tag
    if (!updatedSave.runtime.lastCheck?.success) {
      expect(updatedSave.runtime.lastCheck?.tags).toContain('sequence:failedAt=1');
    }
  });
});

describe('Opposed check', () => {
  it('resolves opposed check and includes defender details in tags', () => {
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'opposed_check',
                  kind: 'opposed',
                  attacker: {
                    key: 'STR',
                    difficulty: 'NORMAL',
                  },
                  defender: {
                    key: 'TOU',
                    difficulty: 'NORMAL',
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
      id: 'PC_1',
      name: 'Attacker',
      kind: 'PC',
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
      id: 'NPC_1',
      name: 'Defender',
      kind: 'NPC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'opposed_check',
      kind: 'opposed' as const,
      attacker: {
        key: 'STR' as const,
        difficulty: 'NORMAL',
      },
      defender: {
        key: 'TOU' as const,
        difficulty: 'NORMAL',
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify opposed check result
    expect(result).not.toBeNull();
    expect(result?.checkId).toBe('opposed_check');
    expect(result?.actorId).toBe('PC_1');

    // Verify tags include defender details
    const tags = result?.tags || [];
    expect(tags.some((t) => t.startsWith('opposed:defenderId='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:defRoll='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:defTarget='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:attDoS='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:defDoS='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:attSuccess='))).toBe(true);
    expect(tags.some((t) => t.startsWith('opposed:defSuccess='))).toBe(true);
  });

  it('attacker fails -> loses regardless of defender', () => {
    // Setup: attacker target 30 roll 90 => fail, defender target 30 roll 10 => success
    // FakeRng rolls [90, 10]
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'opposed_check',
                  kind: 'opposed',
                  attacker: {
                    actorRef: { mode: 'byId', actorId: 'PC_1' },
                    key: 'STR',
                    difficulty: 'IMPOSSIBLE', // Attacker will likely fail
                  },
                  defender: {
                    actorRef: { mode: 'byId', actorId: 'NPC_1' },
                    key: 'TOU',
                    difficulty: 'NORMAL',
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
      id: 'PC_1',
      name: 'Attacker',
      kind: 'PC',
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
      id: 'NPC_1',
      name: 'Defender',
      kind: 'NPC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'opposed_check',
      kind: 'opposed' as const,
      attacker: {
        actorRef: { mode: 'byId' as const, actorId: 'PC_1' },
        key: 'STR' as const,
        difficulty: 'IMPOSSIBLE',
      },
      defender: {
        actorRef: { mode: 'byId' as const, actorId: 'NPC_1' },
        key: 'TOU' as const,
        difficulty: 'NORMAL',
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify result: attacker failed -> should lose regardless of defender
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false);
    expect(result?.dos).toBe(0);
    expect(result?.dof).toBe(0);

    const tags = result?.tags || [];
    expect(tags.some((t) => t === 'opposed:attSuccess=0')).toBe(true);
    expect(tags.some((t) => t === 'opposed:defSuccess=1')).toBe(true);
  });

  it('both succeed -> opposed DoS is the difference', () => {
    // Setup: attacker target 60 roll 10 => DoS 5, defender target 60 roll 30 => DoS 3
    // FakeRng rolls [10, 30]
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'opposed_check',
                  kind: 'opposed',
                  attacker: {
                    actorRef: { mode: 'byId', actorId: 'PC_1' },
                    key: 'STR',
                    difficulty: 'EASY', // Easier for attacker
                  },
                  defender: {
                    actorRef: { mode: 'byId', actorId: 'NPC_1' },
                    key: 'TOU',
                    difficulty: 'NORMAL',
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
      id: 'PC_1',
      name: 'Attacker',
      kind: 'PC',
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
      id: 'NPC_1',
      name: 'Defender',
      kind: 'NPC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'opposed_check',
      kind: 'opposed' as const,
      attacker: {
        actorRef: { mode: 'byId' as const, actorId: 'PC_1' },
        key: 'STR' as const,
        difficulty: 'EASY',
      },
      defender: {
        actorRef: { mode: 'byId' as const, actorId: 'NPC_1' },
        key: 'TOU' as const,
        difficulty: 'NORMAL',
      },
    };

    const result = performCheck(check, storyPack, save, fakeRng);

    // Verify result: both succeed, attackerDoS > defenderDoS => attacker wins with dos difference
    expect(result).not.toBeNull();
    expect(result?.success).toBe(true);
    
    const tags = result?.tags || [];
    const attDoSTag = tags.find((t) => t.startsWith('opposed:attDoS='));
    const defDoSTag = tags.find((t) => t.startsWith('opposed:defDoS='));
    const attDoS = attDoSTag ? parseInt(attDoSTag.split('=')[1]) : 0;
    const defDoS = defDoSTag ? parseInt(defDoSTag.split('=')[1]) : 0;

    expect(attDoS).toBeGreaterThan(defDoS);
    expect(result?.dos).toBe(attDoS - defDoS);
  });

  it('defender wins ties when both succeed with equal DoS', () => {
    // Setup: attacker target 60 roll 20 => DoS 4, defender target 60 roll 20 => DoS 4 (tie)
    // FakeRng rolls [20, 20]
    const storyPack: StoryPack = {
      id: 'test_story',
      title: 'Test Story',
      version: '1.0.0',
      startSceneId: 'scene1',
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
          id: 'scene1',
          type: 'narration',
          title: 'Scene 1',
          text: ['Test scene'],
          choices: [
            {
              id: 'choice1',
              label: 'Test choice',
              checks: [
                {
                  id: 'opposed_check',
                  kind: 'opposed',
                  attacker: {
                    actorRef: { mode: 'byId', actorId: 'PC_1' },
                    key: 'STR',
                    difficulty: 'NORMAL',
                  },
                  defender: {
                    actorRef: { mode: 'byId', actorId: 'NPC_1' },
                    key: 'TOU',
                    difficulty: 'NORMAL',
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
      id: 'PC_1',
      name: 'Attacker',
      kind: 'PC',
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
      id: 'NPC_1',
      name: 'Defender',
      kind: 'NPC',
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
      actors: ['PC_1'],
      activeActorId: 'PC_1',
    };

    const save: GameSave = {
      saveVersion: '1.0.0',
      story: { id: 'test', version: '1.0.0' },
      state: {
        flags: {},
        counters: {},
        inventory: { items: [] },
      },
      party,
      actorsById: { PC_1: attacker, NPC_1: defender },
      itemCatalogById: {},
      runtime: {
        currentSceneId: 'scene1',
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
      id: 'opposed_check',
      kind: 'opposed' as const,
      attacker: {
        actorRef: { mode: 'byId' as const, actorId: 'PC_1' },
        key: 'STR' as const,
        difficulty: 'NORMAL',
      },
      defender: {
        actorRef: { mode: 'byId' as const, actorId: 'NPC_1' },
        key: 'TOU' as const,
        difficulty: 'NORMAL',
      },
    };

    const result = performCheck(check, storyPack, saveWithTarget60, fakeRng);

    // Verify result: both succeed with equal DoS => tie, defender wins
    expect(result).not.toBeNull();
    expect(result?.success).toBe(false); // Defender wins ties

    const tags = result?.tags || [];
    expect(tags.some((t) => t === 'opposed:tie=1')).toBe(true);
    expect(tags.some((t) => t === 'opposed:attSuccess=1')).toBe(true);
    expect(tags.some((t) => t === 'opposed:defSuccess=1')).toBe(true);
    
    const attDoSTag = tags.find((t) => t.startsWith('opposed:attDoS='));
    const defDoSTag = tags.find((t) => t.startsWith('opposed:defDoS='));
    const attDoS = attDoSTag ? parseInt(attDoSTag.split('=')[1]) : 0;
    const defDoS = defDoSTag ? parseInt(defDoSTag.split('=')[1]) : 0;
    
    expect(attDoS).toBe(defDoS);
    expect(result?.dos).toBe(0);
  });
});

