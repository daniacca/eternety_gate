import { useState, useMemo } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView } from "react-native";
import {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
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

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>{scene.title}</Text>

        {text.map((line, index) => (
          <Text key={index} style={styles.text}>
            {line}
          </Text>
        ))}

        {choices.length > 0 && (
          <View style={styles.choicesContainer}>
            <Text style={styles.choicesTitle}>Choices:</Text>
            {choices.map((choice) => (
              <Pressable key={choice.id} style={styles.choiceButton} onPress={() => handleChoice(choice.id)}>
                <Text style={styles.choiceText}>{choice.label}</Text>
              </Pressable>
            ))}
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
              const tags = save.runtime.lastCheck && save.runtime.lastCheck !== null ? save.runtime.lastCheck.tags : [];
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
              const tags = save.runtime.lastCheck.tags || [];
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
});
