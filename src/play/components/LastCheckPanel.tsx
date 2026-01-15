import { useState, useMemo } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import type { CheckResult, GameSave } from "@eg/engine";
import { LogModal } from "./LogModal";
import { getLastPartyCheck, getRelatedDamage } from "../utils/runtimeLogSelectors";
import { formatCheckTitle } from "../utils/combatLogFormat";

interface LastCheckPanelProps {
  check: CheckResult | null | undefined;
  save?: GameSave;
  styles: any;
}

export function LastCheckPanel({ check, save, styles: parentStyles }: LastCheckPanelProps) {
  const [logModalVisible, setLogModalVisible] = useState(false);
  const { width } = useWindowDimensions();
  const isNarrow = width < 600;

  // Get last party check from runtimeLog (more reliable than lastCheck)
  const lastCheckEntry = useMemo(() => {
    return save?.runtime.runtimeLog ? getLastPartyCheck(save.runtime.runtimeLog) : null;
  }, [save]);

  // Get related damage entry if check has resolutionId
  const relatedDamage = useMemo(() => {
    if (!save?.runtime.runtimeLog || !lastCheckEntry?.resolutionId) {
      return null;
    }
    return getRelatedDamage(save.runtime.runtimeLog, lastCheckEntry.resolutionId);
  }, [save, lastCheckEntry]);

  // Use check from entry if available, otherwise fallback to prop
  const checkToDisplay = lastCheckEntry?.check || check;

  // Format check title using formatter
  const checkTypeLabel = checkToDisplay?.checkId ? formatCheckTitle(checkToDisplay.checkId, save) : "Unknown Check";

  // Extract modifiers from tags
  const modifierTags = checkToDisplay?.tags.filter((t) => t.startsWith("mod:") || t.startsWith("combat:")) || [];

  return (
    <>
      <View style={parentStyles.lastCheckPanel}>
        <View style={styles.header}>
          <Text style={styles.title}>Last Check</Text>
          <Pressable style={styles.logButton} onPress={() => setLogModalVisible(true)}>
            <Text style={styles.logButtonText}>Log</Text>
          </Pressable>
        </View>

        <View style={[styles.splitContainer, isNarrow && styles.splitContainerNarrow]}>
          {/* LEFT: Last d100 Check */}
          <View style={[styles.splitSection, isNarrow && styles.splitSectionFull]}>
            <Text style={styles.sectionTitle}>Last d100</Text>
            <ScrollView style={styles.scrollContent} nestedScrollEnabled>
              {!checkToDisplay ? (
                <Text style={styles.emptyText}>No check performed yet</Text>
              ) : (
                <View style={styles.content}>
                  <Text style={styles.checkType}>{checkTypeLabel}</Text>
                  <Text style={styles.rollInfo}>
                    Roll: <Text style={styles.rollValue}>{checkToDisplay.roll}</Text> vs Target:{" "}
                    <Text style={styles.targetValue}>{checkToDisplay.target}</Text>
                  </Text>
                  <Text style={checkToDisplay.success ? styles.successText : styles.failureText}>
                    {checkToDisplay.success ? "✓ Success" : "✗ Failure"}
                  </Text>
                  <Text style={styles.dosDof}>
                    DoS: {checkToDisplay.dos} | DoF: {checkToDisplay.dof}
                  </Text>
                  {checkToDisplay.critical !== "none" && (
                    <Text style={styles.criticalText}>Critical: {checkToDisplay.critical}</Text>
                  )}

                  {/* Modifiers */}
                  {modifierTags.length > 0 && (
                    <View style={styles.modifiersSection}>
                      <Text style={styles.modifiersLabel}>Modifiers:</Text>
                      {modifierTags.slice(0, 3).map((tag, idx) => (
                        <Text key={idx} style={styles.modifierText}>
                          {tag.replace("mod:", "").replace("combat:", "")}
                        </Text>
                      ))}
                      {modifierTags.length > 3 && (
                        <Text style={styles.modifierText}>... and {modifierTags.length - 3} more</Text>
                      )}
                    </View>
                  )}
                </View>
              )}
            </ScrollView>
          </View>

          {/* RIGHT: Related Damage */}
          <View style={[styles.splitSection, isNarrow && styles.splitSectionFull]}>
            <Text style={styles.sectionTitle}>Related Damage</Text>
            <ScrollView style={styles.scrollContent} nestedScrollEnabled>
              {!lastCheckEntry?.resolutionId ? (
                <Text style={styles.emptyText}>No resolution ID</Text>
              ) : !relatedDamage ? (
                <Text style={styles.emptyText}>No damage (miss/parry/dodge)</Text>
              ) : (
                <View style={styles.content}>
                  <Text style={styles.damageLabel}>Final Damage: {relatedDamage.finalDamage}</Text>
                  {relatedDamage.formula && (() => {
                    // Parse formula: "1d10 + 8 (Mighty Shot) | 17 (Raw) - 4 (TOU) - 0 (Soak)"
                    const parts = relatedDamage.formula.split(" | ");
                    const rawFormula = parts[0] || "";
                    const reductionFormula = parts[1] || "";
                    
                    return (
                      <>
                        {rawFormula && (
                          <Text style={styles.damageFormula}>Raw: {rawFormula}</Text>
                        )}
                        {reductionFormula && (
                          <Text style={styles.damageFormula}>Formula: {reductionFormula}</Text>
                        )}
                      </>
                    );
                  })()}
                  {relatedDamage.rolls && relatedDamage.rolls.length > 0 && (
                    <Text style={styles.damageRolls}>
                      Rolls: {relatedDamage.rolls.join(", ")}
                    </Text>
                  )}
                  {relatedDamage.weaponId && (
                    <Text style={styles.damageWeapon}>Weapon: {relatedDamage.weaponId}</Text>
                  )}
                </View>
              )}
            </ScrollView>
          </View>
        </View>
      </View>

      <LogModal visible={logModalVisible} onClose={() => setLogModalVisible(false)} check={checkToDisplay || null} save={save} />
    </>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    paddingVertical: 20,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  logButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#4a90e2",
    borderRadius: 4,
  },
  logButtonText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "600",
  },
  splitContainer: {
    flexDirection: "row",
    gap: 8,
    flex: 1,
  },
  splitContainerNarrow: {
    flexDirection: "column",
  },
  splitSection: {
    flex: 1,
    minHeight: 100,
  },
  splitSectionFull: {
    flex: 1,
    minHeight: 80,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  scrollContent: {
    flex: 1,
  },
  content: {
    gap: 4,
  },
  checkType: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  rollInfo: {
    fontSize: 13,
    color: "#333",
  },
  rollValue: {
    fontWeight: "600",
    color: "#007AFF",
  },
  targetValue: {
    fontWeight: "600",
    color: "#333",
  },
  successText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#28a745",
  },
  failureText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc3545",
  },
  dosDof: {
    fontSize: 12,
    color: "#666",
  },
  criticalText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#ff6b35",
  },
  modifiersSection: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#e0e0e0",
  },
  modifiersLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  modifierText: {
    fontSize: 10,
    color: "#666",
    marginBottom: 2,
  },
  damageLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: "#dc3545",
    marginBottom: 4,
  },
  damageDetail: {
    fontSize: 12,
    color: "#666",
    marginBottom: 2,
  },
  damageFormula: {
    fontSize: 11,
    color: "#888",
    fontFamily: "monospace",
    marginBottom: 2,
  },
  damageRolls: {
    fontSize: 11,
    color: "#888",
    fontFamily: "monospace",
    marginBottom: 2,
  },
  damageWeapon: {
    fontSize: 11,
    color: "#888",
    marginTop: 4,
  },
});

