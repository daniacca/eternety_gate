import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { Actor, GameSave, StatKey } from "@eg/engine";

const STAT_LABELS: Record<StatKey, string> = {
  STR: "Strength",
  TOU: "Toughness",
  AGI: "Agility",
  INT: "Intelligence",
  WIL: "Willpower",
  CHA: "Charisma",
  WS: "Weapon Skill",
  BS: "Ballistic Skill",
  INI: "Initiative",
  PER: "Perception",
};

const STAT_KEYS: StatKey[] = ["STR", "TOU", "AGI", "INT", "WIL", "CHA", "WS", "BS", "INI", "PER"];

interface StatShopProps {
  visible: boolean;
  save: GameSave;
  actor: Actor;
  onClose: () => void;
  onIncreaseStat: (stat: StatKey, cost: number) => void;
}

export function StatShop({ visible, save, actor, onClose, onIncreaseStat }: StatShopProps) {
  const currentXp = actor?.resources?.xp ?? 0;
  const baseStats = actor?.resources?.baseStats ?? {};

  const getBaseStat = (stat: StatKey) => {
    return baseStats[stat] ?? actor.stats[stat];
  };

  const getIncreaseCost = (stat: StatKey) => {
    const base = getBaseStat(stat);
    const current = actor.stats[stat];
    const increases = Math.max(0, current - base);
    const nextIncrease = increases + 1;
    if (nextIncrease <= 10) {
      return 100 + 10 * nextIncrease;
    }
    if (nextIncrease <= 20) {
      return 200 + 100 * (nextIncrease - 10);
    }
    return 1200 + 300 * (nextIncrease - 20);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Characteristic Training</Text>
              <Text style={styles.subtitle}>{actor?.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resourceBar}>
            <Text style={styles.resourceLabel}>XP:</Text>
            <Text style={styles.resourceValue}>{currentXp}</Text>
            <Text style={styles.resourceHint}>Base stats are tracked per character</Text>
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {STAT_KEYS.map((stat) => {
              const base = getBaseStat(stat);
              const current = actor.stats[stat];
              const increases = Math.max(0, current - base);
              const cost = getIncreaseCost(stat);
              const canTrain = currentXp >= cost;
              return (
                <View key={stat} style={styles.statCard}>
                  <View style={styles.statRow}>
                    <View style={styles.statInfo}>
                      <Text style={styles.statName}>{STAT_LABELS[stat]}</Text>
                      <Text style={styles.statMeta}>
                        Base {base} · Current {current} · +{increases}
                      </Text>
                    </View>
                    <View style={styles.statBadge}>
                      <Text style={styles.statBadgeText}>{stat}</Text>
                    </View>
                  </View>
                  <View style={styles.statFooter}>
                    <Text style={styles.costText}>Cost: {cost} XP</Text>
                    <TouchableOpacity
                      style={[styles.trainButton, !canTrain && styles.trainButtonDisabled]}
                      disabled={!canTrain}
                      onPress={() => onIncreaseStat(stat, cost)}
                    >
                      <Text style={[styles.trainText, !canTrain && styles.trainTextDisabled]}>Increase +1</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  panel: {
    width: "94%",
    maxWidth: 720,
    height: "90%",
    backgroundColor: "#111827",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  header: {
    padding: 16,
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#f8fafc",
  },
  subtitle: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
  },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#1f2937",
    justifyContent: "center",
    alignItems: "center",
  },
  closeText: {
    color: "#f8fafc",
    fontSize: 20,
  },
  resourceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#0b1220",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  resourceLabel: {
    color: "#94a3b8",
    fontSize: 12,
    fontWeight: "600",
  },
  resourceValue: {
    color: "#facc15",
    fontSize: 16,
    fontWeight: "700",
  },
  resourceHint: {
    color: "#64748b",
    fontSize: 11,
    marginLeft: "auto",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  statCard: {
    backgroundColor: "#0f172a",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statInfo: {
    flex: 1,
    marginRight: 12,
  },
  statName: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  statMeta: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
  },
  statBadge: {
    backgroundColor: "#1e293b",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  statBadgeText: {
    color: "#e2e8f0",
    fontWeight: "700",
    fontSize: 12,
  },
  statFooter: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  costText: {
    color: "#94a3b8",
    fontSize: 12,
  },
  trainButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  trainButtonDisabled: {
    backgroundColor: "#334155",
  },
  trainText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
  trainTextDisabled: {
    color: "#94a3b8",
  },
});
