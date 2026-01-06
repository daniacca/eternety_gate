import { useState } from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import type { CheckResult, GameSave } from "@eg/engine";
import { LogModal } from "./LogModal";

interface LastCheckPanelProps {
  check: CheckResult | null | undefined;
  save?: GameSave;
  styles: any;
}

export function LastCheckPanel({ check, save, styles: parentStyles }: LastCheckPanelProps) {
  const [logModalVisible, setLogModalVisible] = useState(false);

  // Extract check type from checkId
  const checkType = check?.checkId || "Unknown Check";
  const checkTypeLabel = checkType.includes("WS") ? "WS Test" : checkType.includes("BS") ? "BS Test" : checkType;

  // Extract modifiers from tags
  const modifierTags = check?.tags.filter((t) => t.startsWith("mod:") || t.startsWith("combat:")) || [];

  return (
    <>
      <View style={parentStyles.lastCheckPanel}>
        <View style={styles.header}>
          <Text style={styles.title}>Last Check</Text>
          <Pressable style={styles.logButton} onPress={() => setLogModalVisible(true)}>
            <Text style={styles.logButtonText}>Log</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.scrollContent} nestedScrollEnabled>
          {!check ? (
            <Text style={styles.emptyText}>No check performed yet</Text>
          ) : (
            <View style={styles.content}>
              <Text style={styles.checkType}>{checkTypeLabel}</Text>
              <Text style={styles.rollInfo}>
                Roll: <Text style={styles.rollValue}>{check.roll}</Text> vs Target: <Text style={styles.targetValue}>{check.target}</Text>
              </Text>
              <Text style={check.success ? styles.successText : styles.failureText}>
                {check.success ? "✓ Success" : "✗ Failure"}
              </Text>
              <Text style={styles.dosDof}>
                DoS: {check.dos} | DoF: {check.dof}
              </Text>
              {check.critical !== "none" && (
                <Text style={styles.criticalText}>Critical: {check.critical}</Text>
              )}

              {/* Modifiers */}
              {modifierTags.length > 0 && (
                <View style={styles.modifiersSection}>
                  <Text style={styles.modifiersLabel}>Modifiers:</Text>
                  {modifierTags.slice(0, 5).map((tag, idx) => (
                    <Text key={idx} style={styles.modifierText}>
                      {tag.replace("mod:", "").replace("combat:", "")}
                    </Text>
                  ))}
                  {modifierTags.length > 5 && (
                    <Text style={styles.modifierText}>... and {modifierTags.length - 5} more</Text>
                  )}
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </View>

      <LogModal visible={logModalVisible} onClose={() => setLogModalVisible(false)} check={check || null} save={save} />
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
});

