import type { Effect, GameSave, StoryPack } from "../types";
import { IRNG } from "../rng";
import { evaluateCondition } from "../conditions";

export function applyFireWorldEvents(
  storyPack: StoryPack,
  save: GameSave,
  _rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const worldEvents = storyPack.systems.worldEvents || {};
  let currentSave = save;
  const emittedEffects: Effect[] = [];

  for (const [eventId, event] of Object.entries(worldEvents)) {
    // Skip if already fired and it's a once event
    if (event.once && currentSave.runtime.firedWorldEvents.includes(eventId)) {
      continue;
    }

    // Check trigger condition
    if (evaluateCondition(event.trigger, currentSave)) {
      // Collect effects to emit
      emittedEffects.push(...event.effects);

      // Mark as fired
      const newFiredEvents = [...currentSave.runtime.firedWorldEvents, eventId];
      currentSave = {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          firedWorldEvents: newFiredEvents,
        },
      };
    }
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}
