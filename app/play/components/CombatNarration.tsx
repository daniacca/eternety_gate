import { View, Text } from "react-native";
import type { GameSave } from "@eg/engine";

interface CombatNarrationProps {
  showNarration: boolean;
  combatLog: string[];
  turnStartIndex: number;
  styles: any;
}

export function CombatNarration({ showNarration, combatLog, turnStartIndex, styles }: CombatNarrationProps) {
  if (!showNarration) return null;

  const safeStart = Math.min(turnStartIndex, combatLog.length);
  const combatNarration = combatLog.slice(safeStart);

  return (
    <View style={styles.combatNarration}>
      <Text style={styles.combatNarrationTitle}>
        Combat Narration [DEBUG: combatLog.length={combatLog.length}, turnStartIndex={turnStartIndex}]
      </Text>
      {combatNarration.length > 0 ? (
        combatNarration.map((entry, index) => (
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

