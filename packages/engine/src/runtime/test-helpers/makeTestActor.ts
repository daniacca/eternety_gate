import type { Actor, StatKey } from '../types';

/**
 * Override type that allows partial stats
 */
type TestActorOverrides = Omit<Partial<Actor>, 'stats'> & {
  stats?: Partial<Record<StatKey, number>>;
};

/**
 * Creates a test actor with sensible defaults
 */
export function makeTestActor(overrides?: TestActorOverrides): Actor {
  const defaultActor: Actor = {
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
    resources: { wounds: 0, rf: 0, peq: 100, gold: 10, mcMax: 15, mcCurrent: 15 },
    skills: {},
    talents: {},
    traits: {},
    equipment: {
      mainHand: null,
      offHand: null,
      armor: null,
      helmet: null,
      boots: null,
      cloak: null,
      necklace: null,
      ring1: null,
      ring2: null,
    },
    status: {
      conditions: [],
      tempModifiers: [],
    },
  };

  return {
    ...defaultActor,
    ...overrides,
    stats: {
      ...defaultActor.stats,
      ...(overrides?.stats || {}),
    },
    resources: {
      ...defaultActor.resources,
      ...(overrides?.resources || {}),
    },
    skills: {
      ...defaultActor.skills,
      ...(overrides?.skills || {}),
    },
    equipment: {
      mainHand: null,
      offHand: null,
      armor: null,
      helmet: null,
      boots: null,
      cloak: null,
      necklace: null,
      ring1: null,
      ring2: null,
      ...defaultActor.equipment,
      ...(overrides?.equipment || {}),
    },
    status: {
      ...defaultActor.status,
      ...(overrides?.status || {}),
      tempModifiers: overrides?.status?.tempModifiers || defaultActor.status.tempModifiers,
    },
  };
}

