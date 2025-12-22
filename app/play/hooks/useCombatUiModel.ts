import { useMemo } from "react";
import type { GameSave, Choice } from "@eg/engine";
import { getCurrentTurnActorId, getActorWeapon, getActorArmor, distanceChebyshev } from "@eg/engine";

export interface CombatUiModel {
  // Combat state
  isCombatActive: boolean;
  isPlayerTurn: boolean;
  currentTurnActorId: string | null;
  currentTurnActor: GameSave["actorsById"][string] | null;
  distance: number | null;
  moveRemaining: number;
  actionAvailable: boolean;
  stance: "normal" | "defend";

  // Equipment info
  pcActor: GameSave["actorsById"][string] | null;
  npcActor: GameSave["actorsById"][string] | null;
  pcWeapon: ReturnType<typeof getActorWeapon> | null;
  pcArmor: ReturnType<typeof getActorArmor> | null;
  npcWeapon: ReturnType<typeof getActorWeapon> | null;
  npcArmor: ReturnType<typeof getActorArmor> | null;

  // Weapon capabilities
  hasRangedWeapon: boolean;
  weaponRange: { short: number; long: number } | null;

  // Attack availability
  canMelee: boolean;
  canRanged: boolean;
  canRangedReason: string | null;

  // Attack choices
  meleeChoice: Choice | null | undefined;
  rangedLongChoice: Choice | null | undefined;
  rangedCalledChoice: Choice | null | undefined;

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

export function useCombatUiModel(save: GameSave, combatChoices: Choice[]): CombatUiModel {
  return useMemo(() => {
    const combat = save.runtime.combat;
    const isCombatActive = combat?.active ?? false;

    // Basic combat state
    const currentTurnActorId = isCombatActive ? getCurrentTurnActorId(save) : null;
    const currentTurnActor = currentTurnActorId ? save.actorsById[currentTurnActorId] : null;
    const isPlayerTurn = Boolean(isCombatActive && currentTurnActorId === save.party.activeActorId);
    const moveRemaining = combat?.turn.moveRemaining ?? 0;
    const actionAvailable = combat?.turn.actionAvailable ?? false;
    const stance = combat?.turn.stance ?? "normal";

    // Calculate distance
    let distance: number | null = null;
    if (isCombatActive && combat?.positions) {
      const pcPos = combat.positions[save.party.activeActorId];
      const npcIds = combat.participants.filter((id) => id !== save.party.activeActorId);
      if (pcPos && npcIds.length > 0) {
        const npcPos = combat.positions[npcIds[0]];
        if (npcPos) {
          distance = distanceChebyshev(pcPos, npcPos);
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

    // Weapon capabilities
    const hasRangedWeapon = pcWeapon?.weapon?.kind === "RANGED";
    const weaponRange = pcWeapon?.weapon?.range || null;

    // Basic attack availability
    const canMelee = distance !== null && distance <= 1;
    let canRanged = distance !== null && distance > 1 && distance <= 8;
    let canRangedReason: string | null = null;

    // Update canRanged based on weapon range if available
    if (hasRangedWeapon && weaponRange && distance !== null) {
      canRanged = distance > 1 && distance <= weaponRange.long;
      if (distance <= 1) {
        canRangedReason = "In melee";
      } else if (distance > weaponRange.long) {
        canRangedReason = "Out of range";
      }
    } else if (!hasRangedWeapon) {
      canRanged = false;
      canRangedReason = "No ranged weapon";
    } else if (distance !== null && distance <= 1) {
      canRanged = false;
      canRangedReason = "In melee";
    } else if (distance !== null && distance > 8) {
      canRanged = false;
      canRangedReason = "Out of range";
    }

    // Get attack choices
    const meleeChoice =
      combatChoices.find((c) => c.id === "combat_melee") || combatChoices.find((c) => c.id.startsWith("combat_melee_"));
    const rangedLongChoice = combatChoices.find((c) => c.id === "combat_ranged_long_heavy");
    const rangedCalledChoice = combatChoices.find((c) => c.id === "combat_ranged_called_shot");

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

    // Calculate AGI bonus for display
    const agiBonus = pcActor ? Math.floor((pcActor.stats.AGI ?? 0) / 10) : 0;

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
      meleeChoice,
      rangedLongChoice,
      rangedCalledChoice,
      canMove,
      moveDisabledReason,
      meleeDisabled,
      meleeDisabledReason,
      rangedDisabled,
      rangedDisabledReason,
      rangedCalledDisabled,
      rangedCalledDisabledReason,
      agiBonus,
    };
  }, [save, combatChoices]);
}
