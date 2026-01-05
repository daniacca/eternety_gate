import { useState, useEffect } from "react";
import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { CheckResult } from "@eg/engine";

interface LogModalProps {
  visible: boolean;
  onClose: () => void;
  check: CheckResult | null;
}

// Simple in-memory check history (last 100 checks)
// In a real app, this would be stored in state management or persisted
let checkHistory: Array<CheckResult & { timestamp: number }> = [];

export function addCheckToHistory(check: CheckResult | null) {
  if (!check) return;
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

export function LogModal({ visible, onClose, check }: LogModalProps) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  // Ensure current check is in history when modal opens
  useEffect(() => {
    if (check && visible) {
      addCheckToHistory(check);
    }
  }, [check, visible]);

  const selectedCheck = selectedIndex !== null ? checkHistory[selectedIndex] : null;

  // Format check summary for list
  const formatCheckSummary = (c: CheckResult, idx: number) => {
    const checkType = c.checkId || "Unknown";
    const typeLabel = checkType.includes("WS") ? "WS" : checkType.includes("BS") ? "BS" : "Check";
    return `${idx + 1}. ${typeLabel}: ${c.roll}/${c.target} ${c.success ? "✓" : "✗"} (DoS:${c.dos} DoF:${c.dof})`;
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
            {/* Left column: Check list */}
            <View style={styles.leftColumn}>
              <Text style={styles.columnTitle}>Recent Checks ({checkHistory.length})</Text>
              <ScrollView style={styles.checkList}>
                {checkHistory.length === 0 ? (
                  <Text style={styles.emptyText}>No checks recorded</Text>
                ) : (
                  checkHistory
                    .slice()
                    .reverse()
                    .map((c, idx) => {
                      const actualIndex = checkHistory.length - 1 - idx;
                      return (
                        <TouchableOpacity
                          key={actualIndex}
                          style={[styles.checkItem, selectedIndex === actualIndex && styles.checkItemSelected]}
                          onPress={() => setSelectedIndex(actualIndex)}
                        >
                          <Text style={styles.checkItemText}>{formatCheckSummary(c, idx)}</Text>
                        </TouchableOpacity>
                      );
                    })
                )}
              </ScrollView>
            </View>

            {/* Right column: Selected check details */}
            <View style={styles.rightColumn}>
              <Text style={styles.columnTitle}>Check Details</Text>
              <ScrollView style={styles.detailsContent}>
                {selectedCheck ? (
                  <>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Check ID:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.checkId || "N/A"}</Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Actor:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.actorId}</Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Roll:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.roll}</Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Target:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.target}</Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Result:</Text>
                      <Text style={[styles.detailValue, selectedCheck.success ? styles.successText : styles.failureText]}>
                        {selectedCheck.success ? "Success" : "Failure"}
                      </Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>DoS:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.dos}</Text>
                    </View>
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>DoF:</Text>
                      <Text style={styles.detailValue}>{selectedCheck.dof}</Text>
                    </View>
                    {selectedCheck.critical !== "none" && (
                      <View style={styles.detailSection}>
                        <Text style={styles.detailLabel}>Critical:</Text>
                        <Text style={styles.detailValue}>{selectedCheck.critical}</Text>
                      </View>
                    )}
                    <View style={styles.detailSection}>
                      <Text style={styles.detailLabel}>Tags ({selectedCheck.tags.length}):</Text>
                      <View style={styles.tagsContainer}>
                        {selectedCheck.tags.slice(0, 200).map((tag, idx) => (
                          <Text key={idx} style={styles.tagText}>
                            {tag}
                          </Text>
                        ))}
                        {selectedCheck.tags.length > 200 && (
                          <Text style={styles.tagText}>... (trimmed to 200)</Text>
                        )}
                      </View>
                    </View>
                  </>
                ) : (
                  <Text style={styles.emptyText}>Select a check to view details</Text>
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

