import { describe, it, expect } from 'vitest';
import { createNewGame, applyChoice, getCurrentScene } from './engine';
import { rollD100, RNG } from './rng';
import { performCheck } from './checks';
import { evaluateCondition } from './conditions';
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

