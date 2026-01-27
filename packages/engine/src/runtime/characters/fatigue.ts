import type { GameSave, ActorId, Actor } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import { calculateMaxHp, calculateMaxRf } from "./hp";
import { addConditionToActor, removeConditionFromActor, hasCondition } from "../conditions";

/**
 * Gets the maximum RF (Fatigue Reserve) for an actor
 * RFMax = 3 * HP
 */
export function getFatigueMax(save: GameSave, actor: Actor, catalogs?: CharacterCatalogs): number {
  return calculateMaxRf(save, actor, catalogs);
}

/**
 * Applies fatigue (RF) to an actor and handles threshold conditions
 *
 * Thresholds:
 * - RF <= HP: ok
 * - RF > HP: -10 all tests (apply tempModifier)
 * - RF > 2*HP: -20 all tests, movement halved (apply tempModifier + condition)
 * - RF >= 2.5*HP: unconscious (apply condition)
 * - RF >= 3*HP: dead by collapse (set isDead true)
 *
 * @param save - The game save
 * @param actorId - The actor ID
 * @param amount - Amount of RF to add
 * @param catalogs - Optional character catalogs (for maxHp calculation)
 * @returns Updated save
 */
export function applyFatigue(save: GameSave, actorId: ActorId, amount: number, catalogs?: CharacterCatalogs): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) {
    return save;
  }
  if (hasCondition(actor, "frenzy")) {
    return save;
  }

  const currentRF = actor.resources.rf ?? 0;
  const newRF = currentRF + amount;
  const maxHp = catalogs ? calculateMaxHp(save, actor, catalogs) : actor.derived?.hpMax ?? 100;

  // Update actor with new RF
  let updatedActor: Actor = {
    ...actor,
    resources: {
      ...actor.resources,
      rf: newRF,
    },
    status: {
      ...actor.status,
      tempModifiers: actor.status?.tempModifiers || [],
    },
  };

  // Apply threshold conditions
  // RF > HP: -10 all tests
  if (newRF > maxHp && currentRF <= maxHp) {
    // Just crossed threshold - add tempModifier
    updatedActor = {
      ...updatedActor,
      status: {
        ...updatedActor.status,
        tempModifiers: [
          ...(updatedActor.status.tempModifiers || []),
          {
            id: `fatigue:${actorId}`,
            scope: "all",
            value: -10,
          },
        ],
      },
    };
  }

  // RF > 2*HP: -20 all tests, movement halved
  if (newRF > 2 * maxHp && currentRF <= 2 * maxHp) {
    // Just crossed threshold - update tempModifier to -20
    updatedActor = {
      ...updatedActor,
      status: {
        ...updatedActor.status,
        tempModifiers: (updatedActor.status.tempModifiers || []).map((mod) =>
          mod.id === `fatigue:${actorId}` ? { ...mod, value: -20 } : mod
        ),
      },
    };
    // Also apply movement halved via condition (we'll use fatigue condition with special handling)
    // For MVP, we can track this via a tag or just handle in movement calculation
  }

  // RF >= 2.5*HP: unconscious
  if (newRF >= 2.5 * maxHp && currentRF < 2.5 * maxHp) {
    // Just crossed threshold - add unconscious condition
    const combat = save.runtime.combat;
    const currentTurnCounter = combat?.turnCounter ?? 0;
    updatedActor = addConditionToActor(
      updatedActor,
      "unconscious",
      1,
      currentTurnCounter + 999, // Lasts until removed (effectively permanent until RF decreases)
      "fatigue"
    );
  }

  // RF >= 3*HP: dead by collapse
  if (newRF >= 3 * maxHp) {
    updatedActor = {
      ...updatedActor,
      resources: {
        ...updatedActor.resources,
        isDead: true,
      },
    };
  }

  // Remove/downgrade conditions if RF decreases below thresholds
  const fatigueModifierIndex = (updatedActor.status.tempModifiers || []).findIndex(
    (mod) => mod.id === `fatigue:${actorId}`
  );

  if (newRF <= maxHp) {
    // RF <= HP: remove fatigue modifier completely
    if (fatigueModifierIndex >= 0) {
      updatedActor = {
        ...updatedActor,
        status: {
          ...updatedActor.status,
          tempModifiers: (updatedActor.status.tempModifiers || []).filter((mod) => mod.id !== `fatigue:${actorId}`),
        },
      };
    }
  } else if (newRF <= 2 * maxHp && currentRF > 2 * maxHp) {
    // RF <= 2*HP but still > HP: downgrade -20 to -10
    if (fatigueModifierIndex >= 0) {
      updatedActor = {
        ...updatedActor,
        status: {
          ...updatedActor.status,
          tempModifiers: (updatedActor.status.tempModifiers || []).map((mod) =>
            mod.id === `fatigue:${actorId}` ? { ...mod, value: -10 } : mod
          ),
        },
      };
    }
  }

  // RF < 2.5*HP: remove unconscious IF it was caused by fatigue
  if (newRF < 2.5 * maxHp && hasCondition(updatedActor, "unconscious")) {
    const unconsciousCondition = updatedActor.conditions?.unconscious;
    if (unconsciousCondition?.source === "fatigue") {
      updatedActor = removeConditionFromActor(updatedActor, "unconscious");
    }
  }

  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}
