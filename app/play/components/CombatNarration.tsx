import { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";

interface CombatNarrationProps {
  showNarration: boolean;
  combatLog: string[];
  turnStartIndex: number;
  styles: any;
  cycleStartIndex?: number;
}

type ViewMode = "recap" | "turn" | "all";

export function CombatNarration({
  showNarration,
  combatLog,
  turnStartIndex,
  styles,
  cycleStartIndex,
}: CombatNarrationProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("recap");

  if (!showNarration) return null;

  // Helper to check if a line is a header
  const isHeader = (s: string) => s.trim().startsWith("—");

  // Determine which log entries to show based on view mode
  let displayLog: string[] = [];

  if (viewMode === "all") {
    // Show entire log
    displayLog = combatLog;
  } else if (viewMode === "turn") {
    // Show only current turn (from turnStartIndex, including header)
    const startIdx = Math.min(turnStartIndex, combatLog.length);
    displayLog = combatLog.slice(startIdx);
  } else {
    // Default: recap mode - show cycle recap (from cycleStartIndex, filtering headers)
    const cycleStart = cycleStartIndex ?? turnStartIndex;
    const startIdx = Math.min(cycleStart, combatLog.length);
    const cycleLog = combatLog.slice(startIdx);
    // Filter out headers in recap mode
    displayLog = cycleLog.filter((entry) => !isHeader(entry));
  }

  // If recap is empty (e.g., first turn), show fallback message
  const isEmpty = displayLog.length === 0;
  const fallbackMessage = isEmpty && viewMode === "recap" ? "— Tocca a te —" : null;

  // Toggle function: recap -> all -> turn -> recap
  const handleToggle = () => {
    if (viewMode === "recap") {
      setViewMode("all");
    } else if (viewMode === "all") {
      setViewMode("turn");
    } else {
      setViewMode("recap");
    }
  };

  const toggleLabel = viewMode === "recap" ? "Tutto" : viewMode === "all" ? "Turno corrente" : "Recap";

  return (
    <View style={styles.combatNarration}>
      <View style={styles.combatNarrationHeader}>
        <Text style={styles.combatNarrationTitle}>Combat Narration</Text>
        <TouchableOpacity onPress={handleToggle} style={styles.combatNarrationToggle}>
          <Text style={styles.combatNarrationToggleText}>{toggleLabel}</Text>
        </TouchableOpacity>
      </View>
      {fallbackMessage ? (
        <Text style={styles.combatNarrationText}>{fallbackMessage}</Text>
      ) : displayLog.length > 0 ? (
        displayLog.map((entry, index) => (
          <Text key={index} style={styles.combatNarrationText}>
            {entry}
          </Text>
        ))
      ) : (
        <Text style={styles.combatNarrationText}>Il combattimento è iniziato.</Text>
      )}
    </View>
  );
}
