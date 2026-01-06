import { useState, useEffect, useMemo } from "react";
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { CheckResult, GameSave, RuntimeLogEntry } from "@eg/engine";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
  check: CheckResult | null;
  save?: GameSave;
}

// Simple in-memory check history (last 100 checks)
// In a real app, this would be stored in state management or persisted
let checkHistory: Array<CheckResult & { timestamp: number }> = [];

// Unified log entry type for display
type UnifiedLogEntry = 
  | { type: "check"; check: CheckResult; timestamp: number }
  | { type: "initiative"; entry: Extract<RuntimeLogEntry, { kind: "initiative" }> }
  | { type: "damage"; entry: Extract<RuntimeLogEntry, { kind: "damage" }> }
  | { type: "system"; entry: Extract<RuntimeLogEntry, { kind: "system" }> };

export function addCheckToHistory(check: CheckResult | null) {
  if (!check) return;
  
  // Skip actions (marked with combat:kind=action tag) - they're not real checks
  if (check.tags && check.tags.some((tag) => tag === "combat:kind=action")) {
    return;
  }
  
  // Avoid duplicates by checking if the last check is the same
  const lastCheck = checkHistory[checkHistory.length - 1];
  if (
    lastCheck &&
    lastCheck.checkId === check.checkId &&
    lastCheck.roll === check.roll &&
    lastCheck.target === check.target &&
    lastCheck.actorId === check.actorId
  ) {
    return; // Already recorded
  }
  checkHistory.push({ ...check, timestamp: Date.now() });
  // Keep only last 100
  if (checkHistory.length > 100) {
    checkHistory = checkHistory.slice(-100);
  }
}

export function LogModal({ visible, onClose, check, save }: LogModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Ensure current check is in history when modal opens
  useEffect(() => {
    if (check && visible) {
      addCheckToHistory(check);
    }
  }, [check, visible]);

  // Merge checkHistory with runtimeLog entries
  const unifiedLog = useMemo(() => {
    const entries: UnifiedLogEntry[] = [];
    
    // Add checks from history
    checkHistory.forEach((check) => {
      entries.push({ type: "check", check, timestamp: check.timestamp });
    });
    
    // Add runtime log entries (initiative, damage, system)
    if (save?.runtime.runtimeLog) {
      save.runtime.runtimeLog.forEach((entry) => {
        if (entry.kind === "initiative") {
          entries.push({ type: "initiative", entry });
        } else if (entry.kind === "damage") {
          entries.push({ type: "damage", entry });
        } else if (entry.kind === "system") {
          entries.push({ type: "system", entry });
        }
      });
    }
    
    // Sort by timestamp/turnCounter (newest first)
    entries.sort((a, b) => {
      const aTime = a.type === "check" ? a.timestamp : (a.entry.turnCounter ?? 0);
      const bTime = b.type === "check" ? b.timestamp : (b.entry.turnCounter ?? 0);
      return bTime - aTime; // Descending
    });
    
    return entries;
  }, [save, checkHistory.length]);

  const selectedEntry = selectedIndex !== null ? unifiedLog[selectedIndex] : null;

  // Format log entry summary for list
  const formatLogSummary = (entry: UnifiedLogEntry, idx: number) => {
    if (entry.type === "check") {
      const c = entry.check;
      const isAction = c.tags && c.tags.some((tag) => tag === "combat:kind=action");
      if (isAction) {
        const actionType = c.checkId?.replace("combat:", "") || "Action";
        return `${idx + 1}. Action: ${actionType}`;
      }
      const checkType = c.checkId || "Unknown";
      const typeLabel = checkType.includes("WS") ? "WS" : checkType.includes("BS") ? "BS" : checkType.includes("allOut") ? "All-Out Attack" : checkType.includes("attack") ? "Attack" : "Check";
      return `${idx + 1}. ${typeLabel}: ${c.roll}/${c.target} ${c.success ? "✓" : "✗"} (DoS:${c.dos} DoF:${c.dof})`;
    } else if (entry.type === "initiative") {
      return `${idx + 1}. Initiative: ${entry.entry.iniBase} + ${entry.entry.iniRoll} = ${entry.entry.iniScore}`;
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

          <View style={styles.content}>
            {/* Left column: Log list */}
            <View style={styles.leftColumn}>
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
            <View style={styles.rightColumn}>
              <Text style={styles.columnTitle}>Entry Details</Text>
              <ScrollView style={styles.detailsContent}>
                {selectedEntry ? (
                  <>
                    {selectedEntry.type === "check" ? (
                      <>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Check ID:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.checkId || "N/A"}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Actor:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.actorId}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Roll:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.roll}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Target:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.target}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Result:</Text>
                          <Text style={[styles.detailValue, selectedEntry.check.success ? styles.successText : styles.failureText]}>
                            {selectedEntry.check.success ? "Success" : "Failure"}
                          </Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>DoS:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.dos}</Text>
                        </View>
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>DoF:</Text>
                          <Text style={styles.detailValue}>{selectedEntry.check.dof}</Text>
                        </View>
                        {selectedEntry.check.critical !== "none" && (
                          <View style={styles.detailSection}>
                            <Text style={styles.detailLabel}>Critical:</Text>
                            <Text style={styles.detailValue}>{selectedEntry.check.critical}</Text>
                          </View>
                        )}
                        <View style={styles.detailSection}>
                          <Text style={styles.detailLabel}>Tags ({selectedEntry.check.tags.length}):</Text>
                          <View style={styles.tagsContainer}>
                            {selectedEntry.check.tags.slice(0, 200).map((tag, idx) => (
                              <Text key={idx} style={styles.tagText}>
                                {tag}
                              </Text>
                            ))}
                            {selectedEntry.check.tags.length > 200 && (
                              <Text style={styles.tagText}>... (trimmed to 200)</Text>
                            )}
                          </View>
                        </View>
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
                          <Text style={styles.detailValue}>{selectedEntry.entry.iniBase}</Text>
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
  leftColumn: {
    width: "50%",
    borderRightWidth: 1,
    borderRightColor: "#ddd",
    padding: 12,
  },
  rightColumn: {
    width: "50%",
    padding: 12,
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

