import { describe, it, expect } from 'vitest';
import { createNewGame, applyChoice, getCurrentScene } from './engine';
import type { StoryPack, Actor, Party, ActorId, ItemId, Item } from './types';

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
});

