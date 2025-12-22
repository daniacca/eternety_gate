import { View, Text, Pressable } from "react-native";
import type { GameSave, Choice } from "@eg/engine";
import { CombatUiModel, useCombatUiModel } from "../hooks/useCombatUiModel";

interface CombatControlProps {
  model: CombatUiModel | undefined;
  save: GameSave;
  combatChoices: Choice[];
  handleChoice: (choiceId: string) => void;
  width: number;
  styles: any;
}

export function CombatControl({ model, save, combatChoices, handleChoice, width, styles }: CombatControlProps) {
  if (!model || !model.isCombatActive) return null;

  const combat = save.runtime.combat;

  const pcHp = model.pcActor?.resources.hp ?? 0;
  const pcFatigue = model.pcActor?.resources.rf ?? 0;
  const npcHp = model.npcActor?.resources.hp ?? 0;
  const npcFatigue = model.npcActor?.resources.rf ?? 0;

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
          Round: {combat?.round ?? 0} | Turn: {model.currentTurnActor?.name || model.currentTurnActorId || "Unknown"}
        </Text>
        {model.distance !== null && <Text style={styles.combatControlInfo}>Distance: {model.distance}</Text>}
        {model.isPlayerTurn && (
          <View style={styles.combatControlEconomy}>
            <Text style={styles.combatControlEconomyText}>
              Move: {model.moveRemaining}/{model.agiBonus} | Action: {model.actionAvailable ? "Available" : "Spent"} |
              Stance: {model.stance}
            </Text>
          </View>
        )}
        <View style={styles.combatControlStats}>
          <Text style={styles.combatControlStat}>
            PC_1: HP {pcHp} / RF {pcFatigue} | Weapon: {model.pcWeapon?.name || "Unarmed"} | Armor:{" "}
            {model.pcArmor?.name || "None"} (Soak: {model.pcArmor?.soak || 0})
          </Text>
          <Text style={styles.combatControlStat}>
            NPC_DUMMY: HP {npcHp} / RF {npcFatigue} | Weapon: {model.npcWeapon?.name || "Unarmed"} | Armor:{" "}
            {model.npcArmor?.name || "None"} (Soak: {model.npcArmor?.soak || 0})
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

                  return (
                    <View key={move.dir} style={styles.movePadCell}>
                      <Pressable
                        style={[styles.movePadButton, !model.canMove && styles.movePadButtonDisabled]}
                        onPress={() => model.canMove && moveChoice && handleChoice(moveChoice.id)}
                        disabled={!model.canMove}
                      >
                        <Text style={[styles.movePadButtonText, !model.canMove && styles.movePadButtonTextDisabled]}>
                          {move.label}
                        </Text>
                      </Pressable>
                      {!model.canMove && model.moveDisabledReason && (
                        <Text style={styles.movePadReason}>{model.moveDisabledReason}</Text>
                      )}
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
          {model.meleeChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                style={[styles.attackButton, model.meleeDisabled && styles.attackButtonDisabled]}
                onPress={() => {
                  if (!model.meleeDisabled) {
                    handleChoice(model.meleeChoice!.id);
                  }
                }}
                disabled={model.meleeDisabled}
              >
                <Text style={[styles.attackButtonText, model.meleeDisabled && styles.attackButtonTextDisabled]}>
                  Melee attack
                </Text>
              </Pressable>
              {model.meleeDisabled && model.meleeDisabledReason && (
                <Text style={styles.attackButtonReason}>{model.meleeDisabledReason}</Text>
              )}
            </View>
          )}
          {model.rangedLongChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                style={[styles.attackButton, model.rangedDisabled && styles.attackButtonDisabled]}
                onPress={() => {
                  if (!model.rangedDisabled) {
                    handleChoice(model.rangedLongChoice!.id);
                  }
                }}
                disabled={model.rangedDisabled}
              >
                <Text style={[styles.attackButtonText, model.rangedDisabled && styles.attackButtonTextDisabled]}>
                  Ranged (LONG + cover)
                </Text>
              </Pressable>
              {model.rangedDisabled && model.rangedDisabledReason && (
                <Text style={styles.attackButtonReason}>{model.rangedDisabledReason}</Text>
              )}
            </View>
          )}
          {model.rangedCalledChoice && (
            <View style={styles.attackButtonItem}>
              <Pressable
                style={[styles.attackButton, model.rangedCalledDisabled && styles.attackButtonDisabled]}
                onPress={() => {
                  if (!model.rangedCalledDisabled) {
                    handleChoice(model.rangedCalledChoice!.id);
                  }
                }}
                disabled={model.rangedCalledDisabled}
              >
                <Text style={[styles.attackButtonText, model.rangedCalledDisabled && styles.attackButtonTextDisabled]}>
                  Called shot (SHORT)
                </Text>
              </Pressable>
              {model.rangedCalledDisabled && model.rangedCalledDisabledReason && (
                <Text style={styles.attackButtonReason}>{model.rangedCalledDisabledReason}</Text>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Special Actions: Defend and Aim */}
      {model.isPlayerTurn && (
        <View style={styles.specialActionsContainer}>
          <Text style={styles.specialActionsTitle}>Special Actions</Text>
          <View style={styles.specialActionsRow}>
            <Pressable
              style={[styles.specialActionButton, !model.actionAvailable && styles.attackButtonDisabled]}
              onPress={() => {
                if (model.actionAvailable) {
                  handleChoice("combat_defend");
                }
              }}
              disabled={!model.actionAvailable}
            >
              <Text style={[styles.specialActionButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                Defend
              </Text>
            </Pressable>
            <Pressable
              style={[styles.specialActionButton, !model.actionAvailable && styles.attackButtonDisabled]}
              onPress={() => {
                if (model.actionAvailable) {
                  handleChoice("combat_aim");
                }
              }}
              disabled={!model.actionAvailable}
            >
              <Text style={[styles.specialActionButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                Aim
              </Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* End Turn Button */}
      {model.isPlayerTurn && (
        <View style={styles.endTurnContainer}>
          <Pressable style={styles.endTurnButton} onPress={() => handleChoice("combat_end_turn")}>
            <Text style={styles.endTurnButtonText}>End Turn</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
