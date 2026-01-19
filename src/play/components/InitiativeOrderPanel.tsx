import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import type { GameSave } from "@eg/engine";
import { getCurrentTurnActorId, calculateMaxHp, getCurrentHp, loadCharacterCatalogs } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";

interface InitiativeOrderPanelProps {
  save: GameSave;
  styles: any;
}

export function InitiativeOrderPanel({ save, styles: parentStyles }: InitiativeOrderPanelProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 600;

  const combat = save.runtime.combat;
  if (!combat?.active || !combat.participants || combat.participants.length === 0) {
    return null;
  }

  const currentTurnActorId = getCurrentTurnActorId(save);
  const participants = combat.participants;

  // Load catalogs for HP calculation
  const catalogs = loadCharacterCatalogs(sigilContentPack as any);

  // Get HP info for each participant
  const participantInfo = participants.map((actorId) => {
    const actor = save.actorsById[actorId];
    const hpMax = actor ? calculateMaxHp(save, actor, catalogs) : (combat.initialHpByActorId?.[actorId] ?? 100);
    const hp = actor ? getCurrentHp(save, actor, catalogs) : 0;
    return {
      actorId,
      name: actor?.name || actorId,
      hp,
      hpMax,
      isCurrentTurn: actorId === currentTurnActorId,
      isPC: actor?.kind === "PC",
    };
  });

  return (
    <View style={parentStyles.initiativeOrderPanel}>
      <Text style={styles.title}>Initiative Order</Text>
      <View style={styles.list}>
        {participantInfo.map((info, index) => (
          <View
            key={info.actorId}
            style={[
              styles.item,
              info.isCurrentTurn && styles.itemCurrent,
              info.isPC && styles.itemPC,
            ]}
          >
            <View style={styles.itemHeader}>
              <Text style={[styles.itemName, info.isCurrentTurn && styles.itemNameCurrent]}>
                {info.name}
              </Text>
              {info.isCurrentTurn && (
                <View style={styles.currentIndicator}>
                  <Text style={styles.currentIndicatorText}>→</Text>
                </View>
              )}
            </View>
            <Text style={styles.itemHp}>
              HP: {info.hp}/{info.hpMax}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  list: {
    gap: 4,
  },
  item: {
    padding: 6,
    borderRadius: 4,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  itemCurrent: {
    backgroundColor: "#e8f4f8",
    borderColor: "#4a90e2",
    borderWidth: 2,
  },
  itemPC: {
    borderLeftWidth: 3,
    borderLeftColor: "#007AFF",
  },
  itemHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  itemName: {
    fontSize: 12,
    fontWeight: "500",
    color: "#333",
    flex: 1,
  },
  itemNameCurrent: {
    fontWeight: "600",
    color: "#007AFF",
  },
  currentIndicator: {
    marginLeft: 4,
  },
  currentIndicatorText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4a90e2",
  },
  itemHp: {
    fontSize: 10,
    color: "#666",
  },
});

