import type { StoryPack, Actor, Party, GameSave, ActorId, ItemId, Item } from '../types';
import { createNewGame } from '../engine';

/**
 * Creates a test GameSave with party, actorsById, and runtime seed/counter initialized
 */
export function makeTestSave(
  storyPack: StoryPack,
  actor: Actor,
  seed: number = 123456,
  counter: number = 0
): GameSave {
  const party: Party = {
    actors: [actor.id],
    activeActorId: actor.id,
  };

  const actorsById: Record<ActorId, Actor> = {
    [actor.id]: actor,
  };

  const save = createNewGame(storyPack, seed, party, actorsById, {});

  // Override counter if specified
  if (counter !== 0) {
    save.runtime.rngCounter = counter;
  }

  return save;
}

