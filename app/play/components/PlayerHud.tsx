import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import type { GameSave } from "@eg/engine";
import { getActorWeapon, getActorArmor } from "@eg/engine";
import type { ConditionId } from "@eg/engine";

interface PlayerHudProps {
  save: GameSave;
  onOpenSheet: () => void;
}

const conditionLabels: Record<ConditionId, string> = {
  prone: "A terra",
  stunned: "Stordito",
  bleeding: "Sanguinante",
  fatigue: "Affaticato",
};

export function PlayerHud({ save, onOpenSheet }: PlayerHudProps) {
  const activeActor = save.actorsById[save.party.activeActorId];
  if (!activeActor) return null;

  const hp = activeActor.resources.hp;
  const hpMax = activeActor.derived?.hpMax ?? 100;

  // Get equipment
  const weapon = getActorWeapon(save, activeActor);
  const armor = getActorArmor(save, activeActor);

  // Get conditions
  const conditions = activeActor.conditions || {};
  const conditionEntries = Object.entries(conditions) as Array<[ConditionId, { stacks?: number }]>;

  return (
    <View style={styles.container}>
      {/* Avatar placeholder */}
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{activeActor.name.charAt(0)}</Text>
      </View>

      {/* HP */}
      <View style={styles.hpContainer}>
        <Text style={styles.hpLabel}>HP</Text>
        <Text style={styles.hpValue}>
          {hp}/{hpMax}
        </Text>
      </View>

      {/* Conditions */}
      {conditionEntries.length > 0 && (
        <View style={styles.conditionsContainer}>
          {conditionEntries.map(([conditionId, instance]) => (
            <View key={conditionId} style={styles.conditionBadge}>
              <Text style={styles.conditionText}>
                {conditionLabels[conditionId]}
                {instance.stacks && instance.stacks > 1 ? ` (${instance.stacks})` : ""}
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Equipment summary */}
      <View style={styles.equipmentContainer}>
        <Text style={styles.equipmentLabel}>Armi:</Text>
        <Text style={styles.equipmentText}>{weapon.name}</Text>
        {armor.armorId !== "none" && (
          <>
            <Text style={styles.equipmentLabel}>Armatura:</Text>
            <Text style={styles.equipmentText}>{armor.name}</Text>
          </>
        )}
      </View>

      {/* Open sheet button */}
      <TouchableOpacity style={styles.sheetButton} onPress={onOpenSheet}>
        <Text style={styles.sheetButtonText}>Scheda</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    backgroundColor: "#f0f0f0",
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    gap: 8,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4a90e2",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  hpContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  hpLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
  },
  hpValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  conditionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    flex: 1,
  },
  conditionBadge: {
    backgroundColor: "#ff6b6b",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  conditionText: {
    fontSize: 10,
    color: "#fff",
    fontWeight: "600",
  },
  equipmentContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  equipmentLabel: {
    fontSize: 11,
    color: "#666",
  },
  equipmentText: {
    fontSize: 11,
    color: "#333",
    fontWeight: "500",
  },
  sheetButton: {
    backgroundColor: "#4a90e2",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  sheetButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});

