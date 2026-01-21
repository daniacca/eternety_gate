import type { Actor, GameSave } from "../types";
import type { IRNG } from "../rng";
import type { CharacterCatalogs } from "../../content/catalogs";
import { applyFatigue } from "../characters/fatigue";
import { addConditionToActor } from "../conditions";

export type ForceFieldBlockResult = {
  save: GameSave;
  blocked: boolean;
  roll?: number;
  protection?: number;
  overload?: number;
  overloaded?: boolean;
  overloadDuration?: number;
  fatigue?: number;
};

type ForceFieldParams = {
  protection: number;
  overload: number;
};

function getForceFieldParams(save: GameSave, actor: Actor): ForceFieldParams | null {
  let traitParams = actor.traits?.["trait:force_field"];
  if (!traitParams && actor.equipment && save.itemsById) {
    const equippedItems = [
      actor.equipment.mainHand,
      actor.equipment.offHand,
      actor.equipment.armor,
      actor.equipment.helmet,
      actor.equipment.boots,
      actor.equipment.cloak,
      actor.equipment.necklace,
      actor.equipment.ring1,
      actor.equipment.ring2,
    ];
    for (const itemRef of equippedItems) {
      if (!itemRef || (itemRef.kind !== "item" && itemRef.kind !== "misc")) continue;
      const item = save.itemsById[itemRef.id];
      if (!item?.grants) continue;
      for (const grant of item.grants) {
        if (grant.type === "trait" && grant.traitId === "trait:force_field") {
          traitParams = grant.params ?? true;
          break;
        }
      }
      if (traitParams) break;
    }
  }
  const traitProtection = typeof traitParams?.x === "number" ? traitParams.x : null;
  const traitOverload = typeof traitParams?.y === "number" ? traitParams.y : null;

  const conditionParams = actor.conditions?.force_field?.params;
  const conditionProtection = typeof conditionParams?.x === "number" ? conditionParams.x : null;
  const conditionOverload = typeof conditionParams?.y === "number" ? conditionParams.y : null;

  if (conditionProtection !== null && conditionOverload !== null) {
    return {
      protection: Math.max(0, conditionProtection),
      overload: Math.max(0, conditionOverload),
    };
  }

  if (traitProtection !== null && traitOverload !== null) {
    return {
      protection: Math.max(0, traitProtection),
      overload: Math.max(0, traitOverload),
    };
  }

  return null;
}

function isForceFieldSuppressed(actor: Actor, turnCounter: number): boolean {
  const overload = actor.conditions?.force_field_overload;
  if (!overload) return false;
  if (overload.untilTurnCounter === undefined) return true;
  return overload.untilTurnCounter >= turnCounter;
}

export function resolveForceFieldBlock(
  save: GameSave,
  defender: Actor,
  rng: IRNG,
  turnCounter: number,
  catalogs?: CharacterCatalogs
): ForceFieldBlockResult {
  const params = getForceFieldParams(save, defender);
  if (!params) {
    return { save, blocked: false };
  }

  if (isForceFieldSuppressed(defender, turnCounter)) {
    return { save, blocked: false };
  }

  const roll = rng.rollD100();
  const isOverloaded = roll <= params.overload;
  const isBlocked = isOverloaded || roll <= params.protection;

  if (!isBlocked) {
    return {
      save,
      blocked: false,
      roll,
      protection: params.protection,
      overload: params.overload,
    };
  }

  let updatedSave = save;
  let fatigue: number | undefined;
  let overloadDuration: number | undefined;

  if (isOverloaded) {
    overloadDuration = roll;
    fatigue = rng.nextInt(1, 10);
    updatedSave = applyFatigue(updatedSave, defender.id, fatigue, catalogs);

    const defenderAfterFatigue = updatedSave.actorsById[defender.id];
    const updatedDefender = addConditionToActor(
      defenderAfterFatigue,
      "force_field_overload",
      1,
      turnCounter + overloadDuration,
      "force_field"
    );
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [defender.id]: updatedDefender,
      },
    };
  }

  return {
    save: updatedSave,
    blocked: true,
    roll,
    protection: params.protection,
    overload: params.overload,
    overloaded: isOverloaded,
    overloadDuration,
    fatigue,
  };
}
