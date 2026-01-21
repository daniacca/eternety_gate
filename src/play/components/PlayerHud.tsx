import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
import type { GameSave } from "@eg/engine";
import { getActorWeapon, getActorArmor, calculateMaxHp, getCurrentHp, calculateMaxRf, getMagicPower } from "@eg/engine";
import type { ConditionId } from "@eg/engine";
import { loadCharacterCatalogs } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";

interface PlayerHudProps {
  save: GameSave;
  onOpenSheet: () => void;
  onOpenTalentShop?: () => void;
  onOpenEquipment?: () => void;
}

const conditionLabels: Record<ConditionId, string> = {
  prone: "A terra",
  stunned: "Stordito",
  bleeding: "Sanguinante",
  fatigue: "Affaticato",
  unconscious: "Incosciente",
  bound: "Legato",
  force_field: "Campo di Forza",
  force_field_overload: "Campo di Forza (Sovraccarico)",
  force_shield: "Pelle di Drago",
  steel_body: "Corpo d'Acciaio",
  warp_speed: "Warp Speed",
  halvedMovement: "Movimento Dimezzato",
};

export function PlayerHud({ save, onOpenSheet, onOpenTalentShop, onOpenEquipment }: PlayerHudProps) {
  const { width } = useWindowDimensions();
  const isNarrow = width < 420;

  const activeActor = save.actorsById[save.party.activeActorId];
  if (!activeActor) return null;

  // Load catalogs for HP calculation
  const catalogs = loadCharacterCatalogs(sigilContentPack as any);

  const hpMax = calculateMaxHp(save, activeActor, catalogs);
  const hp = getCurrentHp(save, activeActor, catalogs);
  const rfMax = calculateMaxRf(save, activeActor, catalogs);
  const rf = activeActor.resources.rf ?? 0;
  const pm = getMagicPower(save, activeActor.id, catalogs);

  // Get equipment
  const weapon = getActorWeapon(save, activeActor);
  const armor = getActorArmor(save, activeActor);

  // Get conditions
  const conditions = activeActor.conditions || {};
  const conditionEntries = Object.entries(conditions) as Array<[ConditionId, { stacks?: number }]>;

  const xp = activeActor.resources.xp ?? 0;

  return (
    <View style={[styles.container, isNarrow && styles.containerNarrow]}>
      {/* Avatar placeholder */}
      <View style={[styles.avatar, isNarrow && styles.avatarNarrow]}>
        <Text style={[styles.avatarText, isNarrow && styles.avatarTextNarrow]}>{activeActor.name.charAt(0)}</Text>
      </View>

      {/* HP */}
      <View style={styles.hpContainer}>
        <Text style={styles.hpLabel}>HP</Text>
        <Text style={styles.hpValue}>
          {hp}/{hpMax}
        </Text>
      </View>

      {/* RF */}
      <View style={styles.hpContainer}>
        <Text style={styles.hpLabel}>RF</Text>
        <Text style={[styles.hpValue, rf > hpMax && styles.rfWarning]}>
          {rf}/{rfMax}
        </Text>
      </View>

      {/* PM */}
      <View style={styles.xpContainer}>
        <Text style={styles.xpLabel}>PM</Text>
        <Text style={styles.xpValue}>{pm}</Text>
      </View>

      {/* XP */}
      <View style={styles.xpContainer}>
        <Text style={styles.xpLabel}>XP</Text>
        <Text style={styles.xpValue}>{xp}</Text>
      </View>

      {/* Conditions */}
      {!isNarrow && conditionEntries.length > 0 && (
        <View style={styles.conditionsContainer}>
          {conditionEntries.map(([conditionId, instance]) => {
            const label = conditionLabels[conditionId] || conditionId;
            return (
              <View key={conditionId} style={styles.conditionBadge}>
                <Text style={styles.conditionText}>
                  {label}
                  {instance.stacks && instance.stacks > 1 ? ` (${instance.stacks})` : ""}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Equipment summary */}
      {!isNarrow ? (
        <View style={styles.equipmentContainer}>
          <Text style={styles.equipmentLabel}>Weapon:</Text>
          <Text style={styles.equipmentText}>{weapon.name}</Text>
          <Text style={styles.equipmentLabel}>Armor:</Text>
          <Text style={styles.equipmentText}>
            {armor.armorId !== "none" ? `${armor.name} (Soak: ${armor.soak || 0})` : "None"}
          </Text>
        </View>
      ) : conditionEntries.length > 0 ? (
        <View style={styles.statusCompact}>
          <Text style={styles.statusCompactText}>Status: {conditionEntries.length}</Text>
        </View>
      ) : null}

      {/* Talents button (debug) */}
      {onOpenTalentShop && (
        <TouchableOpacity style={styles.talentsButton} onPress={onOpenTalentShop}>
          <Text style={styles.talentsButtonText}>Talents</Text>
        </TouchableOpacity>
      )}

  {onOpenEquipment && (
    <TouchableOpacity style={styles.equipmentButton} onPress={onOpenEquipment}>
      <Text style={styles.equipmentButtonText}>Equipment</Text>
    </TouchableOpacity>
  )}

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
  containerNarrow: {
    flexWrap: "wrap",
    rowGap: 6,
    paddingVertical: 6,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#4a90e2",
    justifyContent: "center",
    alignItems: "center",
  },
  avatarNarrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarText: {
    color: "#fff",
    fontWeight: "600",
    fontSize: 16,
  },
  avatarTextNarrow: {
    fontSize: 14,
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
  xpContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  xpLabel: {
    fontSize: 12,
    color: "#666",
    fontWeight: "600",
  },
  xpValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#4a90e2",
  },
  rfWarning: {
    color: "#ff6b6b",
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
  statusCompact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#ff6b6b",
  },
  statusCompactText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "700",
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
  talentsButton: {
    backgroundColor: "#9333ea",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  talentsButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
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
  equipmentButton: {
    backgroundColor: "#475569",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  equipmentButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
