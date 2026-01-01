import { useState } from "react";
import { View, Text, TouchableOpacity } from "react-native";
import type { GameSave } from "@eg/engine";

interface CombatNarrationProps {
  showNarration: boolean;
  combatLog: string[];
  turnStartIndex: number;
  styles: any;
}

export function CombatNarration({ showNarration, combatLog, turnStartIndex, styles }: CombatNarrationProps) {
  const [showFullLog, setShowFullLog] = useState(false);

  if (!showNarration) return null;

  const safeStart = Math.min(turnStartIndex, combatLog.length);
  const currentTurnLog = combatLog.slice(safeStart);
  const displayLog = showFullLog ? combatLog : currentTurnLog;

  return (
    <View style={styles.combatNarration}>
      <View style={styles.combatNarrationHeader}>
        <Text style={styles.combatNarrationTitle}>Combat Narration</Text>
        <TouchableOpacity
          onPress={() => setShowFullLog(!showFullLog)}
          style={styles.combatNarrationToggle}
        >
          <Text style={styles.combatNarrationToggleText}>
            {showFullLog ? "Turno corrente" : "Tutto"}
          </Text>
        </TouchableOpacity>
      </View>
      {displayLog.length > 0 ? (
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

