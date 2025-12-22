import { View, Text, Pressable, StyleSheet } from "react-native";
import type { GameSave, Choice } from "@eg/engine";
import { getActorWeapon, getActorArmor } from "@eg/engine";

interface CombatControlProps {
  combat: GameSave["runtime"]["combat"];
  save: GameSave;
  currentTurnActorId: string | null;
  currentTurnActor: GameSave["actorsById"][string] | null;
  isPlayerTurn: boolean;
  distance: number | null;
  moveRemaining: number;
  actionAvailable: boolean;
  stance: "normal" | "defend";
  agiBonus: number;
  canMelee: boolean;
  canRanged: boolean;
  combatChoices: Choice[];
  handleChoice: (choiceId: string) => void;
  width: number;
  styles: any;
}

export function CombatControl({
  combat,
  save,
  currentTurnActorId,
  currentTurnActor,
  isPlayerTurn,
  distance,
  moveRemaining,
  actionAvailable,
  stance,
  agiBonus,
  canMelee,
  canRanged,
  combatChoices,
  handleChoice,
  width,
  styles,
}: CombatControlProps) {
  if (!combat?.active) return null;

  const pcActor = save.actorsById["PC_1"];
  const npcActor = save.actorsById["NPC_DUMMY"];
  const pcHp = pcActor?.resources.hp ?? 0;
  const pcFatigue = pcActor?.resources.rf ?? 0;
  const npcHp = npcActor?.resources.hp ?? 0;
  const npcFatigue = npcActor?.resources.rf ?? 0;

  // Get equipment info
  const pcWeapon = pcActor ? getActorWeapon(save, pcActor) : null;
  const pcArmor = pcActor ? getActorArmor(save, pcActor) : null;
  const npcWeapon = npcActor ? getActorWeapon(save, npcActor) : null;
  const npcArmor = npcActor ? getActorArmor(save, npcActor) : null;

  // Check if player has ranged weapon
  const hasRangedWeapon = pcWeapon?.weapon?.kind === "RANGED";
  const weaponRange = pcWeapon?.weapon?.range;
  
  // Update canRanged based on weapon range if available
  let actualCanRanged = canRanged;
  if (hasRangedWeapon && weaponRange && distance !== null) {
    actualCanRanged = distance > 1 && distance <= weaponRange.long;
  } else if (!hasRangedWeapon) {
    actualCanRanged = false; // No ranged weapon = can't ranged attack
  }

  // Get attack choices
  // Prioritize standard combat_melee over variants
  const meleeChoice =
    combatChoices.find((c) => c.id === "combat_melee") || combatChoices.find((c) => c.id.startsWith("combat_melee_"));
  const rangedLongChoice = combatChoices.find((c) => c.id === "combat_ranged_long_heavy");
  const rangedCalledChoice = combatChoices.find((c) => c.id === "combat_ranged_called_shot");

  // Move pad grid structure: 3x3 with blank center
  const moveGrid = [
    [
      { dir: "nw", label: "NW" },
      { dir: "n", label: "N" },
      { dir: "ne", label: "NE" },
    ],
    [{ dir: "w", label: "W" }, null, { dir: "e", label: "E" }],
    [
      { dir: "sw", label: "SW" },
      { dir: "s", label: "S" },
      { dir: "se", label: "SE" },
    ],
  ];

  // Determine if we should use row layout (wide screen)
  const useRowLayout = width >= 900;

  return (
    <View style={styles.combatControl}>
      {/* Header */}
      <View style={styles.combatControlHeader}>
        <Text style={styles.combatControlTitle}>Combat Control</Text>
        <Text style={styles.combatControlInfo}>
          Round: {combat.round} | Turn: {currentTurnActor?.name || currentTurnActorId || "Unknown"}
        </Text>
        {distance !== null && <Text style={styles.combatControlInfo}>Distance: {distance}</Text>}
        {isPlayerTurn && (
          <View style={styles.combatControlEconomy}>
            <Text style={styles.combatControlEconomyText}>
              Move: {moveRemaining}/{agiBonus} | Action: {actionAvailable ? "Available" : "Spent"} | Stance: {stance}
            </Text>
          </View>
        )}
          <View style={styles.combatControlStats}>
            <Text style={styles.combatControlStat}>
              PC_1: HP {pcHp} / RF {pcFatigue} | Weapon: {pcWeapon?.name || "Unarmed"} | Armor: {pcArmor?.name || "None"} (Soak: {pcArmor?.soak || 0})
            </Text>
            <Text style={styles.combatControlStat}>
              NPC_DUMMY: HP {npcHp} / RF {npcFatigue} | Weapon: {npcWeapon?.name || "Unarmed"} | Armor: {npcArmor?.name || "None"} (Soak: {npcArmor?.soak || 0})
            </Text>
          </View>
      </View>

      {/* Controls Row: MovePad + Attacks */}
      <View style={[styles.controlsRow, useRowLayout && styles.controlsRowHorizontal]}>
        {/* MovePad */}
        <View style={styles.movePadContainer}>
          <Text style={styles.movePadTitle}>Move</Text>
          <View style={styles.movePadGrid}>
            {moveGrid.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.movePadRow}>
                {row.map((move, colIndex) => {
                  if (move === null) {
                    return <View key={`center-${rowIndex}-${colIndex}`} style={styles.movePadCell} />;
                  }
                  const moveChoice = combatChoices.find((c) => c.id === `combat_move_${move.dir}`);
                  const disabled = !isPlayerTurn || moveRemaining <= 0;
                  const disabledReason = !isPlayerTurn
                    ? "Not your turn"
                    : moveRemaining <= 0
                    ? "No movement left"
                    : "";

                  return (
                    <View key={move.dir} style={styles.movePadCell}>
                      <Pressable
                        style={[styles.movePadButton, disabled && styles.movePadButtonDisabled]}
                        onPress={() => !disabled && moveChoice && handleChoice(moveChoice.id)}
                        disabled={disabled}
                      >
                        <Text style={[styles.movePadButtonText, disabled && styles.movePadButtonTextDisabled]}>
                          {move.label}
                        </Text>
                      </Pressable>
                      {disabled && disabledReason && <Text style={styles.movePadReason}>{disabledReason}</Text>}
                    </View>
                  );
                })}
              </View>
            ))}
          </View>
        </View>

        {/* Attack Buttons */}
        <View style={styles.attackButtonsContainer}>
          <Text style={styles.attackButtonsTitle}>Attacks</Text>
          {meleeChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                style={[
                  styles.attackButton,
                  (!isPlayerTurn || !actionAvailable || !canMelee) && styles.attackButtonDisabled,
                ]}
                onPress={() => {
                  if (isPlayerTurn && actionAvailable && canMelee) {
                    handleChoice(meleeChoice.id);
                  }
                }}
                disabled={!isPlayerTurn || !actionAvailable || !canMelee}
              >
                <Text
                  style={[
                    styles.attackButtonText,
                    (!isPlayerTurn || !actionAvailable || !canMelee) && styles.attackButtonTextDisabled,
                  ]}
                >
                  Melee attack
                </Text>
              </Pressable>
              {(!isPlayerTurn || !actionAvailable || !canMelee) && (
                <Text style={styles.attackButtonReason}>
                  {!isPlayerTurn
                    ? "Not your turn"
                    : !actionAvailable
                    ? "Action spent"
                    : !canMelee
                    ? "Requires melee range"
                    : ""}
                </Text>
              )}
            </View>
          )}
          {rangedLongChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                  style={[
                    styles.attackButton,
                    (!isPlayerTurn || !actionAvailable || !actualCanRanged) && styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (isPlayerTurn && actionAvailable && actualCanRanged) {
                      handleChoice(rangedLongChoice.id);
                    }
                  }}
                  disabled={!isPlayerTurn || !actionAvailable || !actualCanRanged}
              >
                <Text
                    style={[
                      styles.attackButtonText,
                      (!isPlayerTurn || !actionAvailable || !actualCanRanged) && styles.attackButtonTextDisabled,
                    ]}
                >
                  Ranged (LONG + cover)
                </Text>
              </Pressable>
                {(!isPlayerTurn || !actionAvailable || !actualCanRanged) && (
                  <Text style={styles.attackButtonReason}>
                    {!isPlayerTurn
                      ? "Not your turn"
                      : !actionAvailable
                      ? "Action spent"
                      : !hasRangedWeapon
                      ? "No ranged weapon"
                      : !actualCanRanged
                      ? distance !== null && distance <= 1
                        ? "In melee"
                        : "Out of range"
                      : ""}
                  </Text>
                )}
            </View>
          )}
          {rangedCalledChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                style={[
                  styles.attackButton,
                  (!isPlayerTurn || !actionAvailable || !canRanged) && styles.attackButtonDisabled,
                ]}
                onPress={() => {
                  if (isPlayerTurn && actionAvailable && canRanged) {
                    handleChoice(rangedCalledChoice.id);
                  }
                }}
                disabled={!isPlayerTurn || !actionAvailable || !canRanged}
              >
                <Text
                    style={[
                      styles.attackButtonText,
                      (!isPlayerTurn || !actionAvailable || !actualCanRanged) && styles.attackButtonTextDisabled,
                    ]}
                >
                  Called shot (SHORT)
                </Text>
              </Pressable>
                {(!isPlayerTurn || !actionAvailable || !actualCanRanged) && (
                  <Text style={styles.attackButtonReason}>
                    {!isPlayerTurn
                      ? "Not your turn"
                      : !actionAvailable
                      ? "Action spent"
                      : !hasRangedWeapon
                      ? "No ranged weapon"
                      : !actualCanRanged
                      ? distance !== null && distance <= 1
                        ? "In melee"
                        : "Out of range"
                      : ""}
                  </Text>
                )}
            </View>
          )}
        </View>
      </View>

      {/* Special Actions: Defend and Aim */}
      {isPlayerTurn && (
        <View style={styles.specialActionsContainer}>
          <Text style={styles.specialActionsTitle}>Special Actions</Text>
          <View style={styles.specialActionsRow}>
            <Pressable
              style={[styles.specialActionButton, !actionAvailable && styles.attackButtonDisabled]}
              onPress={() => {
                if (actionAvailable) {
                  handleChoice("combat_defend");
                }
              }}
              disabled={!actionAvailable}
            >
              <Text style={[styles.specialActionButtonText, !actionAvailable && styles.attackButtonTextDisabled]}>
                Defend
              </Text>
            </Pressable>
            <Pressable
              style={[styles.specialActionButton, !actionAvailable && styles.attackButtonDisabled]}
              onPress={() => {
                if (actionAvailable) {
                  handleChoice("combat_aim");
                }
              }}
              disabled={!actionAvailable}
            >
              <Text style={[styles.specialActionButtonText, !actionAvailable && styles.attackButtonTextDisabled]}>
                Aim
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* End Turn Button */}
      {isPlayerTurn && (
        <View style={styles.endTurnContainer}>
          <Pressable style={styles.endTurnButton} onPress={() => handleChoice("combat_end_turn")}>
            <Text style={styles.endTurnButtonText}>End Turn</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

