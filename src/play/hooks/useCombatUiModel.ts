import { useMemo } from "react";
import type { GameSave, Choice, StoryPack } from "@eg/engine";
import {
  getCurrentTurnActorId,
  getActorWeapon,
  getActorArmor,
  distanceChebyshev,
  isActorAlive,
  getInventoryItemQty,
  getCharacteristicBonus,
  loadCharacterCatalogs,
  getNaturalAbilityWeapons,
  getWeaponQualityRank,
  hasWeaponQuality,
} from "@eg/engine";

export interface CombatUiModel {
  // Combat state
  isCombatActive: boolean;
  isPlayerTurn: boolean;
  currentTurnActorId: string | null;
  currentTurnActor: GameSave["actorsById"][string] | null;
  distance: number | null;
  moveRemaining: number;
  actionAvailable: boolean;
  stance: "none" | "defend" | "allOut" | "aim";

  // Equipment info
  pcActor: GameSave["actorsById"][string] | null;
  npcActor: GameSave["actorsById"][string] | null;
  pcWeapon: ReturnType<typeof getActorWeapon> | null;
  pcArmor: ReturnType<typeof getActorArmor> | null;
  npcWeapon: ReturnType<typeof getActorWeapon> | null;
  npcArmor: ReturnType<typeof getActorArmor> | null;

  // Weapon capabilities
  hasRangedWeapon: boolean;
  weaponRange: number | null;

  // Attack availability
  canMelee: boolean;
  canRanged: boolean;
  canRangedReason: string | null;
  canAllOut: boolean;
  allOutDisabled: boolean;
  allOutDisabledReason: string | null;

  // Attack choices
  meleeChoice: boolean;
  rangedLongChoice: boolean;
  rangedCalledChoice: boolean;

  // Selected target (for All-Out Attack)
  selectedTargetId: string | null;

  // Move pad state
  canMove: boolean;
  moveDisabledReason: string | null;

  // Attack button states
  meleeDisabled: boolean;
  meleeDisabledReason: string | null;
  rangedDisabled: boolean;
  rangedDisabledReason: string | null;
  rangedCalledDisabled: boolean;
  rangedCalledDisabledReason: string | null;

  // Stats
  agiBonus: number;
}

export function useCombatUiModel(save: GameSave, combatChoices: Choice[], storyPack?: StoryPack): CombatUiModel {
  return useMemo(() => {
    const combat = save.runtime.combat;
    const isCombatActive = combat?.active ?? false;

    // Basic combat state
    const currentTurnActorId = isCombatActive ? getCurrentTurnActorId(save) : null;
    const currentTurnActor = currentTurnActorId ? save.actorsById[currentTurnActorId] : null;
    const isPlayerTurn = Boolean(isCombatActive && currentTurnActorId === save.party.activeActorId);
    const moveRemaining = combat?.turn.moveRemaining ?? 0;
    const actionAvailable = combat?.turn.actionAvailable ?? false;
    // Get stance from stancesByActorId for current turn actor
    // Absence of key means "none" (only for UI display, not stored in state)
    const stance = (isCombatActive && currentTurnActorId && combat?.stancesByActorId?.[currentTurnActorId]) || "none";

    // Calculate distance (find closest alive NPC)
    let distance: number | null = null;
    if (isCombatActive && combat?.positions) {
      const pcPos = combat.positions[save.party.activeActorId];
      const npcIds = combat.participants.filter((id) => {
        if (id === save.party.activeActorId) return false;
        const actor = save.actorsById[id];
        return isActorAlive(actor);
      });
      if (pcPos && npcIds.length > 0) {
        // Find the closest NPC
        let closestDist = Infinity;
        for (const npcId of npcIds) {
          const npcPos = combat.positions[npcId];
          if (npcPos) {
            const dist = distanceChebyshev(pcPos, npcPos);
            if (dist < closestDist) {
              closestDist = dist;
            }
          }
        }
        if (closestDist !== Infinity) {
          distance = closestDist;
        }
      }
    }

    // Get actors
    const pcActor = save.actorsById[save.party.activeActorId] || null;
    const npcActor = save.actorsById["NPC_DUMMY"] || null;

    // Get equipment info
    const pcWeapon = pcActor ? getActorWeapon(save, pcActor) : null;
    const pcArmor = pcActor ? getActorArmor(save, pcActor) : null;
    const npcWeapon = npcActor ? getActorWeapon(save, npcActor) : null;
    const npcArmor = npcActor ? getActorArmor(save, npcActor) : null;

    // Weapon capabilities (check both hands for ranged weapons)
    const mainWeaponId = pcActor?.equipment?.mainHand?.kind === "weapon" ? pcActor.equipment.mainHand.id : null;
    const offWeaponId = pcActor?.equipment?.offHand?.kind === "weapon" ? pcActor.equipment.offHand.id : null;
    const mainWeapon = mainWeaponId ? save.weaponsById?.[mainWeaponId] : null;
    const offWeapon = offWeaponId ? save.weaponsById?.[offWeaponId] : null;
    const naturalAbilities = pcActor ? getNaturalAbilityWeapons(pcActor) : [];
    const rangedWeapons = [mainWeapon, offWeapon, ...naturalAbilities].filter(
      (weapon): weapon is NonNullable<typeof weapon> => Boolean(weapon && weapon.kind === "RANGED")
    );
    const hasRangedWeapon = rangedWeapons.length > 0;
    const inventory = pcActor?.inventory ?? [];
    const rechargeByActor = combat?.weaponRechargeUntilTurnCounterByActorId?.[save.party.activeActorId] || {};
    const rangedWeaponStates = rangedWeapons.map((weapon) => {
      const rechargeTurns = getWeaponQualityRank(weapon, "recharge") ?? 0;
      const rechargeUntil = rechargeTurns > 0 ? rechargeByActor[weapon.id] : undefined;
      const isRecharging = rechargeUntil !== undefined && (combat?.turnCounter ?? 0) < rechargeUntil;
      const hasAmmo = weapon.ammo
        ? getInventoryItemQty(inventory, weapon.ammo.itemId) >= weapon.ammo.consumedPerAttack
        : true;
      const hasCloseRangeShot = hasWeaponQuality(weapon, "close_range_shot");
      return { weapon, isRecharging, hasAmmo, hasCloseRangeShot };
    });
    const availableRangedWeapons = rangedWeaponStates.filter((state) => !state.isRecharging && state.hasAmmo);
    const hasReadyRangedWeapon = availableRangedWeapons.length > 0;
    const hasUnlimitedRange = availableRangedWeapons.some((state) => state.weapon.range === undefined);
    const weaponRange = hasReadyRangedWeapon
      ? hasUnlimitedRange
        ? null
        : availableRangedWeapons.reduce((acc, state) => Math.max(acc, state.weapon.range ?? 0), 0)
      : null;

    // Basic attack availability - check if any NPC is in melee range
    let canMelee = false;
    if (isCombatActive && combat?.positions) {
      const pcPos = combat.positions[save.party.activeActorId];
      if (pcPos) {
        const npcIds = combat.participants.filter((id) => {
          if (id === save.party.activeActorId) return false;
          const actor = save.actorsById[id];
          return isActorAlive(actor);
        });
        for (const npcId of npcIds) {
          const npcPos = combat.positions[npcId];
          if (npcPos) {
            const dist = distanceChebyshev(pcPos, npcPos);
            if (dist <= 1) {
              canMelee = true;
              break;
            }
          }
        }
      }
    }
    let canRanged = distance !== null && distance > 1 && distance <= 8;
    let canRangedReason: string | null = null;

    const allRecharging = hasRangedWeapon && rangedWeaponStates.every((state) => state.isRecharging);
    const allOutOfAmmo = hasRangedWeapon && rangedWeaponStates.every((state) => !state.hasAmmo);
    const allBlockedByResources =
      hasRangedWeapon && rangedWeaponStates.every((state) => state.isRecharging || !state.hasAmmo);

    // Update canRanged based on weapon readiness and range if available
    if (!hasRangedWeapon) {
      canRanged = false;
      canRangedReason = "No ranged weapon";
    } else if (!hasReadyRangedWeapon) {
      canRanged = false;
      if (allRecharging || allBlockedByResources) {
        canRangedReason = "Recharging";
      } else if (allOutOfAmmo) {
        canRangedReason = "No ammo";
      } else {
        canRangedReason = "Recharging";
      }
    } else if (distance !== null) {
      const hasCloseRangeShot = availableRangedWeapons.some((state) => state.hasCloseRangeShot);
      if (distance <= 1 && !hasCloseRangeShot) {
        canRanged = false;
        canRangedReason = "In melee";
      } else if (weaponRange !== null && distance > weaponRange) {
        canRanged = false;
        canRangedReason = "Out of range";
      } else {
        canRanged = true;
        canRangedReason = null;
      }
    } else {
      canRanged = false;
      canRangedReason = "Out of range";
    }

    // Attack choices based on capabilities (not story pack)
    const meleeChoiceAvailable = canMelee;
    const rangedLongChoiceAvailable = hasRangedWeapon && canRanged;
    const rangedCalledChoiceAvailable = hasRangedWeapon && canRanged; // Called Shot is just a ranged attack for now

    // Move pad state
    const canMove = isPlayerTurn && moveRemaining > 0;
    const moveDisabledReason = !isPlayerTurn ? "Not your turn" : moveRemaining <= 0 ? "No movement left" : null;

    // Attack button states
    const meleeDisabled = !isPlayerTurn || !actionAvailable || !canMelee;
    const meleeDisabledReason = !isPlayerTurn
      ? "Not your turn"
      : !actionAvailable
      ? "Action spent"
      : !canMelee
      ? "Requires melee range"
      : null;

    const rangedDisabled = !isPlayerTurn || !actionAvailable || !canRanged;
    const rangedDisabledReason = !isPlayerTurn
      ? "Not your turn"
      : !actionAvailable
      ? "Action spent"
      : !hasRangedWeapon
      ? "No ranged weapon"
      : !canRanged
      ? canRangedReason || "Out of range"
      : null;

    const rangedCalledDisabled = !isPlayerTurn || !actionAvailable || !canRanged;
    const rangedCalledDisabledReason = rangedDisabledReason;

    // Selected target for attacks (first alive enemy in range)
    // For melee: must be in melee range (dist <= 1)
    // For ranged: must be in weapon range
    let selectedTargetId: string | null = null;
    if (isCombatActive && combat?.positions && isPlayerTurn && (canMelee || canRanged)) {
      const pcPos = combat.positions[save.party.activeActorId];
      const npcIds = combat.participants.filter((id) => {
        if (id === save.party.activeActorId) return false;
        const actor = save.actorsById[id];
        return isActorAlive(actor);
      });
      if (pcPos) {
        for (const npcId of npcIds) {
          const npcPos = combat.positions[npcId];
          if (!npcPos) continue;
          const npcActor = save.actorsById[npcId];
          if (!isActorAlive(npcActor)) continue; // Skip dead actors
          const dist = distanceChebyshev(pcPos, npcPos);

          // Check melee range
          if (canMelee && dist <= 1) {
            selectedTargetId = npcId;
            break;
          }
          // Check ranged range
          if (canRanged && hasRangedWeapon) {
            if (weaponRange === null) {
              if (dist > 1) {
                selectedTargetId = npcId;
                break;
              }
            } else if (dist > 1 && dist <= weaponRange) {
              selectedTargetId = npcId;
              break;
            }
          }
        }
      }
    }

    // All-Out Attack availability (melee only, requires action and valid target)
    const canAllOut = canMelee && actionAvailable && isPlayerTurn && selectedTargetId !== null;
    const allOutDisabled = !isPlayerTurn || !actionAvailable || !canMelee || selectedTargetId === null;
    const allOutDisabledReason = !isPlayerTurn
      ? "Not your turn"
      : !actionAvailable
      ? "Action spent"
      : !canMelee
      ? "Requires melee range"
      : selectedTargetId === null
      ? "No valid target"
      : null;

    // Calculate AGI bonus for display using getCharacteristicBonus to include trait bonuses
    // Load catalogs from storyPack (if available) for trait-based bonuses
    const catalogs =
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

    const agiBonus =
      pcActor && save.party.activeActorId
        ? Math.max(1, getCharacteristicBonus(save, save.party.activeActorId, "AGI", catalogs))
        : 1;

    return {
      isCombatActive,
      isPlayerTurn,
      currentTurnActorId,
      currentTurnActor,
      distance,
      moveRemaining,
      actionAvailable,
      stance,
      pcActor,
      npcActor,
      pcWeapon,
      pcArmor,
      npcWeapon,
      npcArmor,
      hasRangedWeapon,
      weaponRange,
      canMelee,
      canRanged,
      canRangedReason,
      meleeChoice: meleeChoiceAvailable,
      rangedLongChoice: rangedLongChoiceAvailable,
      rangedCalledChoice: rangedCalledChoiceAvailable,
      canMove,
      moveDisabledReason,
      meleeDisabled,
      meleeDisabledReason,
      rangedDisabled,
      rangedDisabledReason,
      rangedCalledDisabled,
      rangedCalledDisabledReason,
      canAllOut,
      allOutDisabled,
      allOutDisabledReason,
      selectedTargetId,
      agiBonus,
    };
  }, [save, combatChoices, storyPack]);
}
