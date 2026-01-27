import type { Effect, GameSave, StoryPack } from "../../types";
import type { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../characters/actions";
import { addConditionToActor, hasCondition } from "../../conditions";
import { getCharacteristicBonus } from "../../characters/bonuses";

export function combatFrenzy(
  effect: Extract<Effect, { op: "combatFrenzy" }>,
  storyPack: StoryPack,
  save: GameSave,
  _rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    const blockedCheck = {
      checkId: "combat:frenzy:blocked",
      actorId: effect.actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const actor = save.actorsById[turnActorId];
  if (!actor) {
    return { save };
  }

  if (hasCondition(actor, "frenzy")) {
    return { save };
  }

  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          items: storyPack.items || [],
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  if (catalogs && !hasUnlockedAction(save, catalogs, turnActorId, "combat:frenzy")) {
    const blockedCheck = {
      checkId: "combat:frenzy:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionNotUnlocked"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const touBonus = getCharacteristicBonus(save, actor.id, "TOU", catalogs);
  const durationTurns = Math.max(1, touBonus);
  const expires = (combat.turnCounter ?? 0) + durationTurns;

  const filteredMods = (actor.status.tempModifiers || []).filter((mod) => !mod.id.startsWith(`frenzy:${actor.id}:`));
  const frenzyModifiers = [
    { id: `frenzy:${actor.id}:WS`, scope: "check" as const, key: "WS", value: 10, expires },
    { id: `frenzy:${actor.id}:STR`, scope: "check" as const, key: "STR", value: 10, expires },
    { id: `frenzy:${actor.id}:TOU`, scope: "check" as const, key: "TOU", value: 10, expires },
    { id: `frenzy:${actor.id}:WIL`, scope: "check" as const, key: "WIL", value: 10, expires },
    { id: `frenzy:${actor.id}:BS`, scope: "check" as const, key: "BS", value: -20, expires },
    { id: `frenzy:${actor.id}:INT`, scope: "check" as const, key: "INT", value: -20, expires },
    { id: `frenzy:${actor.id}:CHA`, scope: "check" as const, key: "CHA", value: -20, expires },
  ];

  const updatedActor = addConditionToActor(actor, "frenzy", 1, expires, "talent:frenzy");
  const updatedWithMods = {
    ...updatedActor,
    status: {
      ...updatedActor.status,
      tempModifiers: [...filteredMods, ...frenzyModifiers],
    },
  };

  const updatedSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actor.id]: updatedWithMods,
    },
  };

  const actorName = actor.name || actor.id;
  const logEntry =
    actor.kind === "PC" ? "Entri in Frenzy!" : `${actorName} entra in Frenzy!`;
  return { save: appendCombatLog(updatedSave, logEntry) };
}
