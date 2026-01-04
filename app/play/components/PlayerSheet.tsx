import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { GameSave } from "@eg/engine";
import { getActorWeapon, getActorArmor } from "@eg/engine";
import type { ConditionId } from "@eg/engine";

interface PlayerSheetProps {
  visible: boolean;
  save: GameSave;
  onClose: () => void;
}

const conditionLabels: Record<ConditionId, string> = {
  prone: "A terra",
  stunned: "Stordito",
  bleeding: "Sanguinante",
  fatigue: "Affaticato",
};

const statLabels: Record<string, string> = {
  STR: "Forza",
  TOU: "Resistenza",
  AGI: "Agilità",
  INT: "Intelligenza",
  WIL: "Volontà",
  CHA: "Carisma",
  WS: "Abilità Combattiva",
  BS: "Abilità Balistica",
  INI: "Iniziativa",
  PER: "Percezione",
};

export function PlayerSheet({ visible, save, onClose }: PlayerSheetProps) {
  const activeActor = save.actorsById[save.party.activeActorId];
  if (!activeActor) return null;

  const hp = activeActor.resources.hp;
  const hpMax = activeActor.derived?.hpMax ?? 100;
  const rf = activeActor.resources.rf;
  const rfMax = activeActor.derived?.rfMax ?? 100;

  // Get equipment
  const weapon = getActorWeapon(save, activeActor);
  const armor = getActorArmor(save, activeActor);

  // Get conditions
  const conditions = activeActor.conditions || {};
  const conditionEntries = Object.entries(conditions) as Array<
    [ConditionId, { stacks?: number; untilTurnCounter?: number; source?: string }]
  >;

  // Get inventory
  const inventory = save.state.inventory.items || [];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <Text style={styles.title}>{activeActor.name}</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={styles.scrollView}>
            {/* Stats */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Statistiche</Text>
              <View style={styles.statsGrid}>
                {Object.entries(activeActor.stats).map(([key, value]) => (
                  <View key={key} style={styles.statRow}>
                    <Text style={styles.statLabel}>{statLabels[key] || key}:</Text>
                    <Text style={styles.statValue}>{value}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Resources */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Risorse</Text>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>HP:</Text>
                <Text style={styles.resourceValue}>
                  {hp}/{hpMax}
                </Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>RF:</Text>
                <Text style={styles.resourceValue}>
                  {rf}/{rfMax}
                </Text>
              </View>
            </View>

            {/* Conditions */}
            {conditionEntries.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Condizioni</Text>
                {conditionEntries.map(([conditionId, instance]) => (
                  <View key={conditionId} style={styles.conditionRow}>
                    <Text style={styles.conditionName}>
                      {conditionLabels[conditionId]}
                      {instance.stacks && instance.stacks > 1 ? ` (${instance.stacks})` : ""}
                    </Text>
                    {instance.source && <Text style={styles.conditionSource}>Fonte: {instance.source}</Text>}
                  </View>
                ))}
              </View>
            )}

            {/* Equipment */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Equipaggiamento</Text>
              <View style={styles.equipmentRow}>
                <Text style={styles.equipmentLabel}>Arma:</Text>
                <Text style={styles.equipmentValue}>{weapon.name}</Text>
              </View>
              <View style={styles.equipmentRow}>
                <Text style={styles.equipmentLabel}>Armatura:</Text>
                <Text style={styles.equipmentValue}>{armor.name}</Text>
              </View>
            </View>

            {/* Inventory */}
            {inventory.length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Inventario</Text>
                {inventory.map((itemId, index) => {
                  const item = save.itemCatalogById[itemId];
                  return (
                    <View key={index} style={styles.inventoryRow}>
                      <Text style={styles.inventoryItem}>{item?.name || itemId}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>
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
    maxWidth: 600,
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
    fontSize: 20,
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
  scrollView: {
    flex: 1,
  },
  section: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 12,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  statRow: {
    flexDirection: "row",
    width: "48%",
    justifyContent: "space-between",
  },
  statLabel: {
    fontSize: 14,
    color: "#666",
  },
  statValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  resourceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  resourceLabel: {
    fontSize: 14,
    color: "#666",
  },
  resourceValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  conditionRow: {
    marginBottom: 8,
    padding: 8,
    backgroundColor: "#fff3cd",
    borderRadius: 4,
  },
  conditionName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#856404",
  },
  conditionSource: {
    fontSize: 12,
    color: "#856404",
    marginTop: 4,
  },
  equipmentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  equipmentLabel: {
    fontSize: 14,
    color: "#666",
  },
  equipmentValue: {
    fontSize: 14,
    fontWeight: "500",
    color: "#333",
  },
  inventoryRow: {
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
  inventoryItem: {
    fontSize: 14,
    color: "#333",
  },
});
