import { useMemo, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { Actor, Effect, GameSave, Armor, Weapon, ItemDefinition } from "@eg/engine";
import { getItemPrice, getActorCarriedWeightKg, getActorCarryCapacityKg } from "@eg/engine";
import itemsCatalog from "@eg/content/src/catalogs/items.json";
import weaponsCatalog from "@eg/content/src/catalogs/weapons.json";
import armorsCatalog from "@eg/content/src/catalogs/armors.json";

type ShopTab = "items" | "weapons" | "armors";

interface ItemShopProps {
  visible: boolean;
  save: GameSave;
  actor: Actor;
  onClose: () => void;
  applySystemEffects?: (effects: Effect[]) => void;
}

export function ItemShop({ visible, save, actor, onClose, applySystemEffects }: ItemShopProps) {
  const [activeTab, setActiveTab] = useState<ShopTab>("items");
  const gold = actor.resources.gold ?? 0;
  const currentWeight = getActorCarriedWeightKg(save, actor.id);
  const maxWeight = getActorCarryCapacityKg(save, actor.id);

  const items = useMemo(() => itemsCatalog as ItemDefinition[], []);
  const weapons = useMemo(() => weaponsCatalog as Weapon[], []);
  const armors = useMemo(() => armorsCatalog as Armor[], []);

  const handleBuy = (kind: "item" | "weapon" | "armor", entry: ItemDefinition | Weapon | Armor) => {
    if (!applySystemEffects) return;
    const price = getItemPrice(entry);
    if (gold < price) return;
    applySystemEffects([
      { op: "spendGold", actorId: actor.id, amount: price },
      { op: "addInventoryItem", actorId: actor.id, kind, itemId: entry.id, qty: 1 },
    ]);
  };

  const formatGrant = (grant: any): string => {
    if (grant.type === "modifier") {
      const labelMap: Record<string, string> = {
        "combat.naturalArmor": "Natural Armor",
        "magic.castBonus": "Casting Bonus",
        "magic.channelBonus": "Channel Bonus",
        "magic.pm": "PM",
      };
      const label = labelMap[grant.key] ?? grant.key ?? "Modifier";
      const op = grant.op === "add" ? "+" : grant.op === "sub" ? "-" : grant.op ?? "+";
      const value =
        grant.valueRef === "magic.pm"
          ? "PM"
          : typeof grant.value === "number"
            ? Math.abs(grant.value).toString()
            : grant.value ?? "0";
      return `${label}: ${op}${value}`;
    }
    if (grant.type === "trait") {
      return `Trait: ${grant.traitId?.replace("trait:", "") ?? "unknown"}`;
    }
    if (grant.type === "unlockAction") {
      return `Unlock: ${grant.actionId ?? "action"}`;
    }
    return grant.type ?? "Effect";
  };

  const getEntryEffects = (entry: ItemDefinition | Weapon | Armor): string[] => {
    const effects: string[] = [];
    if ("soak" in entry && typeof entry.soak === "number") {
      effects.push(`Soak: ${entry.soak}`);
    }
    if ("penetration" in entry && typeof entry.penetration === "number") {
      effects.push(`Pen: ${entry.penetration}`);
    }
    const grants = (entry as any).grants;
    if (Array.isArray(grants) && grants.length > 0) {
      effects.push(...grants.map(formatGrant));
    }
    return effects;
  };

  const renderEntry = (kind: "item" | "weapon" | "armor", entry: ItemDefinition | Weapon | Armor) => {
    const price = getItemPrice(entry);
    const weight = entry.weight ?? 0;
    const canAfford = gold >= price;
    const canCarry = currentWeight + weight <= maxWeight;
    const canBuy = canAfford && canCarry && Boolean(applySystemEffects);
    const effects = getEntryEffects(entry);

    return (
      <View key={entry.id} style={styles.card}>
        <View style={styles.cardRow}>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle}>{entry.name}</Text>
            <Text style={styles.cardMeta}>
              {entry.rarity ?? "Common"} · {price} GP · {weight} kg
            </Text>
            {effects.length > 0 && <Text style={styles.cardEffects}>Effetti: {effects.join(" · ")}</Text>}
          </View>
          <TouchableOpacity
            style={[styles.buyButton, !canBuy && styles.buyButtonDisabled]}
            disabled={!canBuy}
            onPress={() => handleBuy(kind, entry)}
          >
            <Text style={[styles.buyButtonText, !canBuy && styles.buyButtonTextDisabled]}>Buy</Text>
          </TouchableOpacity>
        </View>
        {!canAfford && <Text style={styles.warningText}>Not enough gold</Text>}
        {canAfford && !canCarry && <Text style={styles.warningText}>Carry capacity exceeded</Text>}
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.panel}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Item Shop</Text>
              <Text style={styles.subtitle}>{actor.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resourceBar}>
            <Text style={styles.resourceLabel}>Gold:</Text>
            <Text style={styles.resourceValue}>{gold}</Text>
            <Text style={styles.resourceLabel}>Carry:</Text>
            <Text style={styles.resourceValue}>
              {currentWeight.toFixed(1)}/{maxWeight.toFixed(1)} kg
            </Text>
          </View>

          <View style={styles.tabs}>
            {(["items", "weapons", "armors"] as ShopTab[]).map((tab) => (
              <TouchableOpacity
                key={tab}
                style={[styles.tab, activeTab === tab && styles.tabActive]}
                onPress={() => setActiveTab(tab)}
              >
                <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
                  {tab.toUpperCase()}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView contentContainerStyle={styles.listContent}>
            {activeTab === "items" && items.map((entry) => renderEntry("item", entry))}
            {activeTab === "weapons" && weapons.map((entry) => renderEntry("weapon", entry))}
            {activeTab === "armors" && armors.map((entry) => renderEntry("armor", entry))}
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
    maxWidth: 700,
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
    fontSize: 14,
    fontWeight: "700",
    marginRight: 12,
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    backgroundColor: "#0f172a",
    borderBottomWidth: 1,
    borderBottomColor: "#1f2937",
  },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#111827",
  },
  tabActive: {
    borderColor: "#3b82f6",
    backgroundColor: "#1e3a8a",
  },
  tabText: {
    fontSize: 12,
    color: "#94a3b8",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#e0e7ff",
  },
  listContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    backgroundColor: "#0f172a",
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  cardRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#e2e8f0",
  },
  cardMeta: {
    fontSize: 11,
    color: "#94a3b8",
    marginTop: 4,
  },
  cardEffects: {
    fontSize: 11,
    color: "#cbd5f5",
    marginTop: 6,
    lineHeight: 16,
  },
  buyButton: {
    backgroundColor: "#2563eb",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buyButtonDisabled: {
    backgroundColor: "#334155",
  },
  buyButtonText: {
    color: "#f8fafc",
    fontSize: 12,
    fontWeight: "700",
  },
  buyButtonTextDisabled: {
    color: "#94a3b8",
  },
  warningText: {
    marginTop: 6,
    fontSize: 11,
    color: "#f87171",
  },
});
