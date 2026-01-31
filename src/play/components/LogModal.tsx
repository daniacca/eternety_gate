import { useState, useMemo } from "react";
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import type { CheckResult, GameSave, RuntimeLogEntry } from "@eg/engine";
import { formatCheckTitle } from "../utils/combatLogFormat";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
  check: CheckResult | null;
  save?: GameSave;
}

// Unified log entry type for display
type UnifiedLogEntry = 
  | { type: "check"; entry: Extract<RuntimeLogEntry, { kind: "check" }> }
  | { type: "initiative"; entry: Extract<RuntimeLogEntry, { kind: "initiative" }> }
  | { type: "damage"; entry: Extract<RuntimeLogEntry, { kind: "damage" }> }
  | { type: "system"; entry: Extract<RuntimeLogEntry, { kind: "system" }> };

export function LogModal({ visible, onClose, check: _check, save }: LogModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const { width } = useWindowDimensions();
  const isNarrow = width < 700;

  // Build unified log from runtimeLog only (preserves engine append order)
  const unifiedLog = useMemo(() => {
    const entries: UnifiedLogEntry[] = [];
    
    // Use runtimeLog entries in append order (chronological: oldest -> newest)
    if (save?.runtime.runtimeLog) {
      save.runtime.runtimeLog.forEach((entry) => {
        if (entry.kind === "check") {
          entries.push({ type: "check", entry });
        } else if (entry.kind === "initiative") {
          entries.push({ type: "initiative", entry });
        } else if (entry.kind === "damage") {
          entries.push({ type: "damage", entry });
        } else if (entry.kind === "system") {
          entries.push({ type: "system", entry });
        }
      });
    }
    
    // Display in chronological order (oldest -> newest)
    // No reverse() - preserve deterministic append order
    return entries;
  }, [save]);

  const selectedEntry = selectedIndex !== null ? unifiedLog[selectedIndex] : null;

  // Format log entry summary for list
  const formatLogSummary = (entry: UnifiedLogEntry, idx: number) => {
    if (entry.type === "check") {
      const c = entry.entry.check;
      if (!c) {
        return `${idx + 1}. Check: (null)`;
      }
      const checkTitle = formatCheckTitle(c.checkId || "", save);
      return `${idx + 1}. ${checkTitle}: ${c.roll}/${c.target} ${c.success ? "✓" : "✗"} (DoS:${c.dos} DoF:${c.dof})`;
    } else if (entry.type === "initiative") {
      return `${idx + 1}. Initiative: INI bonus ${entry.entry.iniBonus} + ${entry.entry.iniRoll} = ${entry.entry.iniScore}`;
    } else if (entry.type === "damage") {
      return `${idx + 1}. Damage: ${entry.entry.rawDamage} - ${entry.entry.soak} = ${entry.entry.finalDamage}`;
    } else {
      return `${idx + 1}. System: ${entry.entry.message}`;
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>Check Log</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.content, isNarrow && styles.contentNarrow]}>
            {/* Left column: Log list */}
            <View style={[styles.leftColumn, isNarrow && styles.leftColumnNarrow]}>
              <Text style={styles.columnTitle}>Log Entries ({unifiedLog.length})</Text>
              <ScrollView style={styles.checkList}>
                {unifiedLog.length === 0 ? (
                  <Text style={styles.emptyText}>No entries recorded</Text>
                ) : (
                  unifiedLog.map((entry, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.checkItem, selectedIndex === idx && styles.checkItemSelected]}
                      onPress={() => setSelectedIndex(idx)}
                    >
                      <Text style={styles.checkItemText}>{formatLogSummary(entry, idx)}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>
            </View>

            {/* Right column: Selected entry details */}
            <View style={[styles.rightColumn, isNarrow && styles.rightColumnNarrow]}>
              <Text style={styles.columnTitle}>Entry Details</Text>
              <ScrollView style={styles.detailsContent}>
                {selectedEntry ? (
                  <>
                    {selectedEntry.type === "check" ? (
                      <>
                        {selectedEntry.entry.check ? (
                          <>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Check:</Text>
                              <Text style={styles.detailValue}>{formatCheckTitle(selectedEntry.entry.check.checkId || "", save)}</Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Actor:</Text>
                              <Text style={styles.detailValue}>{selectedEntry.entry.check.actorId}</Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Roll:</Text>
                              <Text style={styles.detailValue}>{selectedEntry.entry.check.roll}</Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Target:</Text>
                              <Text style={styles.detailValue}>{selectedEntry.entry.check.target}</Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Result:</Text>
                              <Text style={[styles.detailValue, selectedEntry.entry.check.success ? styles.successText : styles.failureText]}>
                                {selectedEntry.entry.check.success ? "Success" : "Failure"}
                              </Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>DoS:</Text>
                              <Text style={styles.detailValue}>{selectedEntry.entry.check.dos}</Text>
                            </View>
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>DoF:</Text>
                              <Text style={styles.detailValue}>{selectedEntry.entry.check.dof}</Text>
                            </View>
                            {selectedEntry.entry.check.critical !== "none" && (
                              <View style={styles.detailSection}>
                                <Text style={styles.detailLabel}>Critical:</Text>
                                <Text style={styles.detailValue}>{selectedEntry.entry.check.critical}</Text>
                              </View>
                            )}
                            <View style={styles.detailSection}>
                              <Text style={styles.detailLabel}>Tags ({selectedEntry.entry.check.tags.length}):</Text>
                              <View style={styles.tagsContainer}>
                                {selectedEntry.entry.check.tags.slice(0, 200).map((tag, idx) => (
                                  <Text key={idx} style={styles.tagText}>
                                    {tag}
                                  </Text>
                                ))}
                                {selectedEntry.entry.check.tags.length > 200 && (
                                  <Text style={styles.tagText}>... (trimmed to 200)</Text>
                                )}
                              </View>
                            </View>
                          </>
                        ) : (
                          <Text style={styles.emptyText}>Check data unavailable</Text>
                        )}
                      </>
                    ) : selectedEntry.type === "initiative" ? (
                      <>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Type:</Text>
                          <Text style={styles.detailValue}>Initiative Roll</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Actor:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.actorId}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Base INI:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.iniBonus}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Roll (d10):</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.iniRoll}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Total Score:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.iniScore}</Text>
                        </View>
                        {selectedEntry.entry.turnCounter !== undefined && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Turn:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.entry.turnCounter}</Text>
                          </View>
                        )}
                      </>
                    ) : selectedEntry.type === "damage" ? (
                      <>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Type:</Text>
                          <Text style={styles.detailValue}>Damage Roll</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Attacker:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.attackerId}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Defender:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.defenderId}</Text>
                        </View>
                        {selectedEntry.entry.weaponId && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Weapon:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.entry.weaponId}</Text>
                          </View>
                        )}
                        {selectedEntry.entry.formula && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Formula:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.entry.formula}</Text>
                          </View>
                        )}
                        {selectedEntry.entry.rolls && selectedEntry.entry.rolls.length > 0 && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Rolls:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.entry.rolls.join(", ")}</Text>
                          </View>
                        )}
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Raw Damage:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.rawDamage}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Soak:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.soak}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Final Damage:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.finalDamage}</Text>
                        </View>
                        {selectedEntry.entry.turnCounter !== undefined && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Turn:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.entry.turnCounter}</Text>
                          </View>
                        )}
                      </>
                    ) : (
                      <>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Type:</Text>
                          <Text style={styles.detailValue}>System Message</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Message:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.entry.message}</Text>
                        </View>
                        {"tags" in selectedEntry.entry && selectedEntry.entry.tags && selectedEntry.entry.tags.length > 0 && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Tags ({selectedEntry.entry.tags.length}):</Text>
                            <View style={styles.tagsContainer}>
                              {selectedEntry.entry.tags.slice(0, 200).map((tag, idx) => (
                                <Text key={idx} style={styles.tagText}>
                                  {tag}
                                </Text>
                              ))}
                              {selectedEntry.entry.tags.length > 200 && (
                                <Text style={styles.tagText}>... (trimmed to 200)</Text>
                              )}
                            </View>
                          </View>
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <Text style={styles.emptyText}>Select an entry to view details</Text>
                )}
              </ScrollView>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "90%",
    maxWidth: 900,
    maxHeight: "80%",
    backgroundColor: "#fff",
    borderRadius: 8,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
  },
  title: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#333",
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  closeButtonText: {
    fontSize: 24,
    color: "#666",
  },
  content: {
    flexDirection: "row",
    flex: 1,
    minHeight: 400,
  },
  contentNarrow: {
    flexDirection: "column",
    minHeight: 520,
  },
  leftColumn: {
    width: "50%",
    borderRightWidth: 1,
    borderRightColor: "#ddd",
    padding: 12,
  },
  leftColumnNarrow: {
    width: "100%",
    borderRightWidth: 0,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    maxHeight: 260,
  },
  rightColumn: {
    width: "50%",
    padding: 12,
  },
  rightColumnNarrow: {
    width: "100%",
    flex: 1,
  },
  columnTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  checkList: {
    flex: 1,
  },
  checkItem: {
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
  checkItemSelected: {
    backgroundColor: "#e3f2fd",
    borderWidth: 1,
    borderColor: "#4a90e2",
  },
  checkItemText: {
    fontSize: 11,
    color: "#333",
    fontFamily: "monospace",
  },
  detailsContent: {
    flex: 1,
  },
  detailSection: {
    marginBottom: 12,
  },
  detailLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  detailValue: {
    fontSize: 13,
    color: "#333",
  },
  successText: {
    color: "#28a745",
    fontWeight: "600",
  },
  failureText: {
    color: "#dc3545",
    fontWeight: "600",
  },
  tagsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
  },
  tagText: {
    fontSize: 10,
    color: "#666",
    fontFamily: "monospace",
    backgroundColor: "#f0f0f0",
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  emptyText: {
    fontSize: 12,
    color: "#999",
    fontStyle: "italic",
    textAlign: "center",
    marginTop: 20,
  },
});

