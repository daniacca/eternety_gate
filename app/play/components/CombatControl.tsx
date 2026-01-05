import { View, Text, Pressable } from "react-native";
import type { GameSave, Choice, Effect } from "@eg/engine";
import { distanceChebyshev } from "@eg/engine";
import { CombatUiModel, useCombatUiModel } from "../hooks/useCombatUiModel";

interface CombatControlProps {
  model: CombatUiModel | undefined;
  save: GameSave;
  combatChoices: Choice[];
  handleChoice: (choiceId: string) => void;
  applySystemEffects: (effects: Effect[]) => void;
  width: number;
  styles: any;
}

export function CombatControl({
  model,
  save,
  combatChoices,
  handleChoice,
  applySystemEffects,
  width,
  styles,
}: CombatControlProps) {
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
  // Determine if we should stack attacks and stance vertically (narrow screen)
  const useNarrowLayout = width < 600;

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
      </View>

      {/* A) Movement, Attacks, and Stance Blocks - All on Same Row */}
      {model.isPlayerTurn && (
        <View style={[styles.mainRow, useNarrowLayout && styles.mainRowNarrow]}>
          {/* Movement Block */}
          <View style={[styles.combatBlock, styles.movementBlock]}>
            <Text style={styles.combatBlockTitle}>Movement</Text>
            <View style={styles.movePadContainer}>
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
              {/* Movement Actions */}
              <View style={styles.movementActions}>
                <Pressable
                  style={[styles.movementActionButton, model.moveRemaining <= 0 && styles.attackButtonDisabled]}
                  onPress={() => {
                    if (model.moveRemaining > 0) {
                      const hasProne = model.pcActor?.conditions?.prone;
                      if (hasProne) {
                        applySystemEffects([{ op: "combatStandUp", actorId: save.party.activeActorId }]);
                      } else {
                        applySystemEffects([{ op: "combatGetProne", actorId: save.party.activeActorId }]);
                      }
                    }
                  }}
                  disabled={model.moveRemaining <= 0}
                >
                  <Text style={[styles.movementActionText, model.moveRemaining <= 0 && styles.attackButtonTextDisabled]}>
                    {model.pcActor?.conditions?.prone ? "Stand Up" : "Get Prone"}
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.movementActionButton, model.moveRemaining <= 0 && styles.attackButtonDisabled]}
                  onPress={() => {
                    if (model.moveRemaining > 0) {
                      applySystemEffects([{ op: "combatPickup", actorId: save.party.activeActorId }]);
                    }
                  }}
                  disabled={model.moveRemaining <= 0}
                >
                  <Text style={[styles.movementActionText, model.moveRemaining <= 0 && styles.attackButtonTextDisabled]}>
                    Pickup
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
          {/* Attacks Block - Contains Melee and Ranged sections */}
          <View style={[styles.combatBlock, styles.attacksBlock]}>
            <Text style={styles.combatBlockTitle}>Attacks</Text>
            
            {/* Melee Attacks Section */}
            <View style={styles.attackSection}>
              <Text style={styles.attackSectionTitle}>Melee Attacks</Text>
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
                      Melee Attack
                    </Text>
                  </Pressable>
                </View>
              )}
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[styles.attackButton, model.allOutDisabled && styles.attackButtonDisabled]}
                  onPress={() => {
                    if (!model.allOutDisabled && model.selectedTargetId) {
                      applySystemEffects([{ op: "combatAllOut", targetId: model.selectedTargetId }]);
                    }
                  }}
                  disabled={model.allOutDisabled}
                >
                  <Text style={[styles.attackButtonText, model.allOutDisabled && styles.attackButtonTextDisabled]}>
                    All-Out Attack
                  </Text>
                </Pressable>
              </View>
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[
                    styles.attackButton,
                    (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) && styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (model.actionAvailable && model.canMelee && model.selectedTargetId) {
                      applySystemEffects([
                        { op: "combatKnockdown", attackerId: save.party.activeActorId, defenderId: model.selectedTargetId },
                      ]);
                    }
                  }}
                  disabled={!model.actionAvailable || !model.canMelee || !model.selectedTargetId}
                >
                  <Text
                    style={[
                      styles.attackButtonText,
                      (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                        styles.attackButtonTextDisabled,
                    ]}
                  >
                    Knockdown
                  </Text>
                </Pressable>
              </View>
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[
                    styles.attackButton,
                    (!model.actionAvailable || !model.canMelee || !model.selectedTargetId || !model.npcWeapon?.weapon) &&
                      styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (
                      model.actionAvailable &&
                      model.canMelee &&
                      model.selectedTargetId &&
                      model.npcWeapon?.weapon
                    ) {
                      applySystemEffects([
                        { op: "combatDisarm", attackerId: save.party.activeActorId, defenderId: model.selectedTargetId },
                      ]);
                    }
                  }}
                  disabled={
                    !model.actionAvailable || !model.canMelee || !model.selectedTargetId || !model.npcWeapon?.weapon
                  }
                >
                  <Text
                    style={[
                      styles.attackButtonText,
                      (!model.actionAvailable || !model.canMelee || !model.selectedTargetId || !model.npcWeapon?.weapon) &&
                        styles.attackButtonTextDisabled,
                    ]}
                  >
                    Disarm
                  </Text>
                </Pressable>
              </View>
            </View>

            {/* Ranged Attacks Section */}
            {(model.rangedLongChoice || model.rangedCalledChoice) && (
              <View style={styles.attackSection}>
                <Text style={styles.attackSectionTitle}>Ranged Attacks</Text>
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
                        Ranged Attack
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
                      <Text
                        style={[
                          styles.attackButtonText,
                          model.rangedCalledDisabled && styles.attackButtonTextDisabled,
                        ]}
                      >
                        Called Shot
                      </Text>
                    </Pressable>
                    {model.rangedCalledDisabled && model.rangedCalledDisabledReason && (
                      <Text style={styles.attackButtonReason}>{model.rangedCalledDisabledReason}</Text>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>

          {/* Stance Block */}
          <View style={[styles.combatBlock, styles.stanceBlock]}>
            <Text style={styles.combatBlockTitle}>Stance</Text>
            <View style={styles.stanceActions}>
              <Pressable
                style={[styles.stanceButton, !model.actionAvailable && styles.attackButtonDisabled]}
                onPress={() => {
                  if (model.actionAvailable) {
                    applySystemEffects([{ op: "combatDefend" }]);
                  }
                }}
                disabled={!model.actionAvailable}
              >
                <Text style={[styles.stanceButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                  Defend
                </Text>
              </Pressable>
              <Pressable
                style={[styles.stanceButton, !model.actionAvailable && styles.attackButtonDisabled]}
                onPress={() => {
                  if (model.actionAvailable) {
                    applySystemEffects([{ op: "combatAim" }]);
                  }
                }}
                disabled={!model.actionAvailable}
              >
                <Text style={[styles.stanceButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                  Aim
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}

      {/* D) End Turn */}
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
