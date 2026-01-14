import { View, Text } from "react-native";
import type { GameSave } from "@eg/engine";

interface DebugPanelsProps {
  save: GameSave;
  tags: string[];
  styles: any;
}

export function DebugPanels({ save, tags, styles }: DebugPanelsProps) {
  // Prefer lastPlayerCheck for player combat checks, fallback to lastCheck
  const checkToShow = save.runtime.lastPlayerCheck || save.runtime.lastCheck;
  if (!checkToShow) return null;

  const checkTags = checkToShow.tags || [];

  return (
    <View style={styles.checkInfo}>
      <Text style={styles.checkLabel}>Last Check {save.runtime.lastPlayerCheck ? "(Player Combat)" : ""}:</Text>
      <Text style={styles.checkText}>
        Roll: {checkToShow.roll} vs Target: {checkToShow.target}
      </Text>
      <Text style={styles.checkText}>{checkToShow.success ? "✓ Success" : "✗ Failure"}</Text>
      <Text style={styles.checkText}>
        DoS: {checkToShow.dos} | DoF: {checkToShow.dof}
      </Text>
      {checkToShow.critical !== "none" && (
        <Text style={styles.checkText}>Critical: {checkToShow.critical}</Text>
      )}

      {/* Target breakdown (debug UI) */}
      {(() => {
        const calcTags = checkTags.filter((t) => t.startsWith("calc:"));
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
        const combatTags = checkTags.filter((t) => t.startsWith("combat:"));

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

      {checkTags.length > 0 && (
        <View style={styles.breakdownContainer}>
          <Text style={styles.breakdownLabel}>Tags:</Text>
          {checkTags.map((t, i) => (
            <Text key={i} style={styles.breakdownText}>
              {t}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

