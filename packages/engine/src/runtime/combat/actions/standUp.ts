import type { Effect, GameSave, StoryPack } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { hasLeapUpTalent } from "../../characters/talentModifiers";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";

/**
 * Stand Up: consumes all movement, removes prone condition
 * With Leap Up talent: Stand Up is a Free Action and does not consume movement
 */
export function combatStandUp(
  effect: Extract<Effect, { op: "combatStandUp" }>,
  save: GameSave,
  storyPack?: StoryPack
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  // Load catalogs to check for Leap Up talent
  const catalogs: CharacterCatalogs | undefined =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Check for Leap Up talent (stand up as free action without consuming movement)
  const hasLeapUp = catalogs && hasLeapUpTalent(save, catalogs, effect.actorId);

  // Without Leap Up: need movement remaining to stand up
  if (!hasLeapUp && combat.turn.moveRemaining <= 0) {
    return { save };
  }

  // Consume movement only if NOT using Leap Up
  const updatedCombat = hasLeapUp
    ? combat // Leap Up: don't consume movement
    : {
        ...combat,
        turn: {
          ...combat.turn,
          moveRemaining: 0, // Without Leap Up: consume all movement
        },
      };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  const emittedEffects: Effect[] = [
    {
      op: "removeCondition",
      actorId: effect.actorId,
      condition: "prone",
    },
  ];

  // Log message varies based on Leap Up usage
  let logEntry: string;
  if (hasLeapUp) {
    logEntry = actor.kind === "PC"
      ? `Ti alzi in piedi con uno scatto! (Scatto)`
      : `${actor.name || effect.actorId} si alza in piedi con uno scatto! (Scatto)`;
  } else {
    logEntry = actor.kind === "PC"
      ? `Ti alzi in piedi.`
      : `${actor.name || effect.actorId} si alza in piedi.`;
  }
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave, emittedEffects };
}

