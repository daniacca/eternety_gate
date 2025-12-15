import type { Actor } from '../types';

/**
 * Creates a test actor with sensible defaults
 */
export function makeTestActor(overrides?: Partial<Actor>): Actor {
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
      ...defaultActor.equipment,
      ...(overrides?.equipment || {}),
      equipped: {
        ...defaultActor.equipment.equipped,
        ...(overrides?.equipment?.equipped || {}),
      },
    },
    status: {
      ...defaultActor.status,
      ...(overrides?.status || {}),
      tempModifiers: overrides?.status?.tempModifiers || defaultActor.status.tempModifiers,
    },
  };
}

