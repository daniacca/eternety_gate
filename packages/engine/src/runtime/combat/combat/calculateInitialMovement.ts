import type { Actor, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { computeCombatModifiersFromConditions, hasCondition } from "../../conditions";
import { getCharacteristicBonusBase } from "../../characters/bonuses";
import { applyArmorAgiCap } from "../../characters/effectiveStats";
import { getModifierTotal } from "../../characters/modifiers";
import { hasTalentHook } from "../../characters/talentModifiers";
import { getSizeMovementModifier } from "../../characters/actors";

/**
 * Calculates initial movement for an actor based on AGI bonus, size, and conditions
 * This is used to determine the starting movement value for a turn
 *
 * @param actor - The actor
 * @param save - The game save
 * @param catalogs - Character catalogs (optional, required for catalog-based AGI bonuses)
 */
export function calculateInitialMovement(actor: Actor, save: GameSave, catalogs?: CharacterCatalogs): number {
  const modifiers = computeCombatModifiersFromConditions(actor);
  const moveDelta = modifiers.moveDelta ?? 0;

  const fallbackFlySpeed =
    typeof actor.traits?.["trait:flyer"] === "object" && typeof actor.traits["trait:flyer"].x === "number"
      ? actor.traits["trait:flyer"].x
      : 0;
  const flySpeed = catalogs ? getModifierTotal(save, catalogs, actor.id, "movement.flySpeed") : fallbackFlySpeed;
  const canFly = catalogs
    ? getModifierTotal(save, catalogs, actor.id, "movement.canFly") > 0
    : fallbackFlySpeed > 0;

  if (canFly && flySpeed > 0) {
    let baseMove = Math.max(1, flySpeed + moveDelta);
    if (hasCondition(actor, "halvedMovement")) {
      baseMove = Math.max(1, Math.floor(baseMove / 2));
    }
    const blindParams = actor.traits?.["trait:unnatural_sense"];
    const senseRange = typeof blindParams === "object" && typeof blindParams.x === "number" ? blindParams.x : 0;
    const isBlind = actor.conditions?.blind !== undefined || actor.traits?.["trait:blind"] !== undefined;
    if (isBlind && senseRange <= 0) {
      baseMove = Math.max(1, Math.floor(baseMove / 2));
    }
    return Math.max(1, baseMove);
  }

  const bonusAdd = catalogs ? getModifierTotal(save, catalogs, actor.id, "stat.AGI.bonusAdd") : 0;
  const cappedAgi = applyArmorAgiCap(save, actor.id, actor.stats.AGI);
  let agiBonus = getCharacteristicBonusBase(cappedAgi) + bonusAdd;
  if (catalogs && hasTalentHook(actor, catalogs, "sprint")) {
    agiBonus = Math.floor(agiBonus * 1.5);
  }
  const sizeModifier = getSizeMovementModifier(actor);
  let baseMove = Math.max(1, agiBonus + sizeModifier + moveDelta);

  // Called Shot to legs: halve movement
  if (hasCondition(actor, "halvedMovement")) {
    baseMove = Math.max(1, Math.floor(baseMove / 2));
  }
  const blindParams = actor.traits?.["trait:unnatural_sense"];
  const senseRange = typeof blindParams === "object" && typeof blindParams.x === "number" ? blindParams.x : 0;
  const isBlind = actor.conditions?.blind !== undefined || actor.traits?.["trait:blind"] !== undefined;
  if (isBlind && senseRange <= 0) {
    baseMove = Math.max(1, Math.floor(baseMove / 2));
  }

  return Math.max(1, baseMove); // Minimum 1 movement
}
