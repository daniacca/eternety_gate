import type { StoryPack } from '../types';

/**
 * Creates a minimal test StoryPack with systems.checks.difficultyBands present
 */
export function makeTestStoryPack(overrides?: Partial<StoryPack>): StoryPack {
  const defaultStoryPack: StoryPack = {
    id: 'test_story',
    title: 'Test Story',
    version: '1.0.0',
    startSceneId: 'scene1',
    stateSchema: {},
    initialState: {
      flags: {},
      counters: {},
    },
    systems: {
      checks: {
        difficultyBands: {
          NORMAL: 0,
          HARD: -20,
          VERY_HARD: -40,
        },
        criticals: {
          autoSuccess: [1, 2, 3],
          autoFail: [98, 99, 100],
        },
      },
    },
    skills: [
      {
        id: 'skill:parry',
        name: 'Parry',
        baseStat: 'WS',
      },
      {
        id: 'skill:dodge',
        name: 'Dodge',
        baseStat: 'AGI',
      },
    ],
    scenes: [],
  };

  return {
    ...defaultStoryPack,
    ...overrides,
    systems: {
      ...defaultStoryPack.systems,
      ...(overrides?.systems || {}),
      checks: {
        ...defaultStoryPack.systems.checks,
        ...(overrides?.systems?.checks || {}),
        difficultyBands: {
          ...defaultStoryPack.systems.checks.difficultyBands,
          ...(overrides?.systems?.checks?.difficultyBands || {}),
        },
      },
    },
    skills: overrides?.skills ?? defaultStoryPack.skills,
    initialState: {
      ...defaultStoryPack.initialState,
      ...(overrides?.initialState || {}),
    },
  };
}

