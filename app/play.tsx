import { useState, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
  getCurrentTurnActorId,
  type GameSave,
  type StoryPack,
} from "@eg/engine";
import brunholt from "../stories/brunholt.story.json";

export default function PlayScreen() {
  // Create a minimal 1-player party with fixed seed
  const initialSave = useMemo(() => {
    const minimalActor = {
      id: "PC_1",
      name: "Player",
      kind: "PC" as const,
      tags: [],
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    return createNewGame(
      brunholt as StoryPack,
      123456, // fixed seed
      party,
      { PC_1: minimalActor },
      {} // empty item catalog for now
    );
  }, []);

  const [save, setSave] = useState<GameSave>(initialSave);

  const { scene, text } = getCurrentScene(brunholt as StoryPack, save);
  const choices = listAvailableChoices(brunholt as StoryPack, save);

  const handleChoice = (choiceId: string) => {
    const newSave = applyChoice(brunholt as StoryPack, save, choiceId);
    setSave(newSave);
  };

  const lastCheck = save.runtime.lastCheck;
  const tags = lastCheck && lastCheck !== null ? lastCheck.tags : [];
  const combat = save.runtime.combat;

  // Combat UI helpers
  const currentTurnActorId = combat?.active ? getCurrentTurnActorId(save) : null;
  const isPlayerTurn = combat?.active && currentTurnActorId === save.party.activeActorId;
  const currentTurnActor = currentTurnActorId ? save.actorsById[currentTurnActorId] : null;

  // Calculate distance if in combat
  let distance: number | null = null;
  if (combat?.active) {
    const pcPos = combat.positions[save.party.activeActorId];
    const npcIds = combat.participants.filter((id) => id !== save.party.activeActorId);
    if (pcPos && npcIds.length > 0) {
      const npcPos = combat.positions[npcIds[0]];
      if (npcPos) {
        const dx = Math.abs(pcPos.x - npcPos.x);
        const dy = Math.abs(pcPos.y - npcPos.y);
        distance = Math.max(dx, dy);
      }
    }
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{scene.title}</Text>

        {/* Combat Status */}
        {combat?.active && (
          <View style={styles.combatStatus}>
            <Text style={styles.combatTitle}>
              Round: {combat.round} | Turn: {currentTurnActor?.name || currentTurnActorId || "Unknown"}
            </Text>
            {combat.positions && (
              <View>
                {Object.entries(combat.positions).map(([actorId, pos]) => {
                  const actor = save.actorsById[actorId];
                  return (
                    <Text key={actorId} style={styles.combatText}>
                      {actor?.name || actorId}: ({pos.x}, {pos.y})
                    </Text>
                  );
                })}
                {distance !== null && <Text style={styles.combatText}>Distance: {distance}</Text>}
              </View>
            )}
            {!isPlayerTurn && <Text style={styles.combatWarning}>Not your turn!</Text>}
            {isPlayerTurn && combat.turn.hasMoved && <Text style={styles.combatWarning}>Already moved this turn</Text>}
            {isPlayerTurn && combat.turn.hasAttacked && (
              <Text style={styles.combatWarning}>Already attacked this turn</Text>
            )}
          </View>
        )}

        {/* Combat End Banner */}
        {tags.some((t) => t === "combat:state=end") && (
          <View style={styles.combatEndBanner}>
            <Text style={styles.combatEndText}>Combat ended.</Text>
            {tags.find((t) => t.startsWith("combat:winner=")) && (
              <Text style={styles.combatEndText}>
                Winner:{" "}
                {save.actorsById[tags.find((t) => t.startsWith("combat:winner="))!.split("=")[1]]?.name || "Unknown"}
              </Text>
            )}
          </View>
        )}

        {/* Move Buttons (only in combat, player's turn, not moved yet) */}
        {combat?.active && isPlayerTurn && !combat.turn.hasMoved && (
          <View style={styles.moveButtonsContainer}>
            <Text style={styles.choicesTitle}>Move:</Text>
            <View style={styles.moveButtonsGrid}>
              {(["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const).map((dir) => (
                <Pressable
                  key={dir}
                  style={styles.moveButton}
                  onPress={() => handleChoice(`combat_move_${dir.toLowerCase()}`)}
                >
                  <Text style={styles.moveButtonText}>{dir}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {text.map((line, index) => (
          <Text key={index} style={styles.text}>
            {line}
          </Text>
        ))}

        {choices.length > 0 && (
          <View style={styles.choicesContainer}>
            <Text style={styles.choicesTitle}>Choices:</Text>
            {choices.map((choice) => {
              // Check if choice should be disabled
              let disabled = false;
              let disabledReason = "";

              if (combat?.active) {
                if (!isPlayerTurn) {
                  disabled = true;
                  disabledReason = "Not your turn";
                } else {
                  // Check if it's a combat attack and already attacked
                  if (choice.checks?.some((c) => c.kind === "combatAttack") && combat.turn.hasAttacked) {
                    disabled = true;
                    disabledReason = "Already attacked";
                  }
                }
              }

              return (
                <Pressable
                  key={choice.id}
                  style={[styles.choiceButton, disabled && styles.choiceButtonDisabled]}
                  onPress={() => !disabled && handleChoice(choice.id)}
                  disabled={disabled}
                >
                  <Text style={[styles.choiceText, disabled && styles.choiceTextDisabled]}>
                    {choice.label}
                    {disabled && ` (${disabledReason})`}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        {save.runtime.lastCheck && (
          <View style={styles.checkInfo}>
            <Text style={styles.checkLabel}>Last Check:</Text>
            <Text style={styles.checkText}>
              Roll: {save.runtime.lastCheck.roll} vs Target: {save.runtime.lastCheck.target}
            </Text>
            <Text style={styles.checkText}>{save.runtime.lastCheck.success ? "✓ Success" : "✗ Failure"}</Text>
            <Text style={styles.checkText}>
              DoS: {save.runtime.lastCheck.dos} | DoF: {save.runtime.lastCheck.dof}
            </Text>
            {save.runtime.lastCheck.critical !== "none" && (
              <Text style={styles.checkText}>Critical: {save.runtime.lastCheck.critical}</Text>
            )}

            {/* Target breakdown (debug UI) */}
            {(() => {
              const calcTags = tags.filter((t) => t.startsWith("calc:"));
              const attCalcTags = tags.filter((t) => t.startsWith("att:calc:"));
              const defCalcTags = tags.filter((t) => t.startsWith("def:calc:"));

              if (calcTags.length > 0 || attCalcTags.length > 0) {
                return (
                  <View style={styles.breakdownContainer}>
                    <Text style={styles.breakdownLabel}>Target Breakdown:</Text>
                    {calcTags.length > 0 && (
                      <View>
                        {calcTags.map((tag, idx) => {
                          const [key, value] = tag.split("=");
                          const label = key.replace("calc:", "");
                          return (
                            <Text key={idx} style={styles.breakdownText}>
                              {label}: {value}
                            </Text>
                          );
                        })}
                      </View>
                    )}
                    {attCalcTags.length > 0 && (
                      <View style={styles.breakdownSection}>
                        <Text style={styles.breakdownSubLabel}>Attacker:</Text>
                        {attCalcTags.map((tag, idx) => {
                          const [key, value] = tag.split("=");
                          const label = key.replace("att:calc:", "");
                          return (
                            <Text key={idx} style={styles.breakdownText}>
                              {label}: {value}
                            </Text>
                          );
                        })}
                      </View>
                    )}
                    {defCalcTags.length > 0 && (
                      <View style={styles.breakdownSection}>
                        <Text style={styles.breakdownSubLabel}>Defender:</Text>
                        {defCalcTags.map((tag, idx) => {
                          const [key, value] = tag.split("=");
                          const label = key.replace("def:calc:", "");
                          return (
                            <Text key={idx} style={styles.breakdownText}>
                              {label}: {value}
                            </Text>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              }
              return null;
            })()}

            {/* Combat Debug (debug UI) */}
            {(() => {
              const combatTags = tags.filter((t) => t.startsWith("combat:"));

              if (combatTags.length > 0) {
                // Extract key combat values
                const getCombatValue = (prefix: string): string | null => {
                  const tag = combatTags.find((t) => t.startsWith(`combat:${prefix}=`));
                  return tag ? tag.split("=")[1] : null;
                };

                const attackStat = getCombatValue("attackStat");
                const attackTarget = getCombatValue("attackTarget");
                const attackRoll = getCombatValue("attackRoll");
                const attackDoS = getCombatValue("attackDoS");
                const defense = getCombatValue("defense");
                const defTarget = getCombatValue("defTarget");
                const defRoll = getCombatValue("defRoll");
                const defDoS = getCombatValue("defDoS");
                const defSuccess = getCombatValue("defSuccess");
                const tie = combatTags.some((t) => t === "combat:tie=1");

                return (
                  <View style={styles.breakdownContainer}>
                    <Text style={styles.breakdownLabel}>Combat Debug:</Text>
                    {attackStat && <Text style={styles.breakdownText}>Attack Stat: {attackStat}</Text>}
                    {attackTarget && <Text style={styles.breakdownText}>Attack Target: {attackTarget}</Text>}
                    {attackRoll && <Text style={styles.breakdownText}>Attack Roll: {attackRoll}</Text>}
                    {attackDoS !== null && <Text style={styles.breakdownText}>Attack DoS: {attackDoS}</Text>}
                    {defense && <Text style={styles.breakdownText}>Defense: {defense}</Text>}
                    {defTarget && <Text style={styles.breakdownText}>Defense Target: {defTarget}</Text>}
                    {defRoll && <Text style={styles.breakdownText}>Defense Roll: {defRoll}</Text>}
                    {defDoS !== null && <Text style={styles.breakdownText}>Defense DoS: {defDoS}</Text>}
                    {defSuccess && (
                      <Text style={styles.breakdownText}>Defense Success: {defSuccess === "1" ? "Yes" : "No"}</Text>
                    )}
                    {tie && <Text style={styles.breakdownText}>Tie: Yes (Defender wins)</Text>}
                  </View>
                );
              }
              return null;
            })()}

            {tags.length > 0 && (
              <View style={styles.breakdownContainer}>
                <Text style={styles.breakdownLabel}>Tags:</Text>
                {tags.map((t, i) => (
                  <Text key={i} style={styles.breakdownText}>
                    {t}
                  </Text>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#000",
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
    color: "#333",
  },
  choicesContainer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 16,
  },
  choicesTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    color: "#000",
  },
  choiceButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  choiceText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
  checkInfo: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  checkLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  checkText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  breakdownContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  breakdownLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  breakdownSubLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#888",
    marginTop: 4,
    marginBottom: 2,
  },
  breakdownSection: {
    marginTop: 4,
  },
  breakdownText: {
    fontSize: 11,
    color: "#666",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  combatStatus: {
    marginTop: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffc107",
  },
  combatTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#856404",
    marginBottom: 8,
  },
  combatText: {
    fontSize: 14,
    color: "#856404",
    marginBottom: 4,
  },
  combatWarning: {
    fontSize: 14,
    color: "#dc3545",
    fontWeight: "600",
    marginTop: 4,
  },
  combatEndBanner: {
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: "#d4edda",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#28a745",
  },
  combatEndText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#155724",
    marginBottom: 4,
  },
  moveButtonsContainer: {
    marginTop: 16,
    marginBottom: 16,
  },
  moveButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  moveButton: {
    backgroundColor: "#28a745",
    padding: 12,
    borderRadius: 8,
    minWidth: 50,
    alignItems: "center",
    margin: 4,
  },
  moveButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  choiceButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  choiceTextDisabled: {
    color: "#666",
  },
});
