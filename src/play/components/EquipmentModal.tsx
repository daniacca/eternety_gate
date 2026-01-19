import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { GameSave, ItemRef } from "@eg/engine";

type EquipmentSlot = "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2";

interface EquipmentModalProps {
  visible: boolean;
  onClose: () => void;
  save: GameSave;
  actorId: string;
  onEquip: (slot: EquipmentSlot, inventoryIndex: number, itemRef: ItemRef) => void;
  onUnequip: (slot: EquipmentSlot) => void;
}

const SLOT_LABELS: Record<EquipmentSlot, string> = {
  mainHand: "Main Hand",
  offHand: "Off Hand",
  armor: "Armor",
  helmet: "Helmet",
  boots: "Boots",
  cloak: "Cloak",
  necklace: "Necklace",
  ring1: "Ring 1",
  ring2: "Ring 2",
};

export function EquipmentModal({ visible, onClose, save, actorId, onEquip, onUnequip }: EquipmentModalProps) {
  const actor = save.actorsById[actorId];
  if (!actor) return null;

  const inventory = actor.inventory || [];

  const resolveItemName = (itemRef: ItemRef): string => {
    if (itemRef.kind === "weapon") {
      return save.weaponsById?.[itemRef.id]?.name || itemRef.id;
    }
    if (itemRef.kind === "armor") {
      return save.armorsById?.[itemRef.id]?.name || itemRef.id;
    }
    if (itemRef.kind === "item" || itemRef.kind === "misc") {
      return save.itemsById?.[itemRef.id]?.name || itemRef.id;
    }
    return itemRef.id;
  };

  const isCompatibleWithSlot = (slot: EquipmentSlot, itemRef: ItemRef): boolean => {
    if (slot === "mainHand") {
      if (itemRef.kind === "weapon") return true;
      const item = save.itemsById?.[itemRef.id];
      return Boolean(item && item.type === "wearable" && item.slot === "mainHand");
    }
    if (slot === "offHand") {
      const item = save.itemsById?.[itemRef.id];
      return Boolean(item && item.type === "wearable" && item.slot === "offHand");
    }
    if (slot === "armor") {
      return itemRef.kind === "armor";
    }
    if (slot === "ring1" || slot === "ring2") {
      const item = save.itemsById?.[itemRef.id];
      return Boolean(item && item.type === "wearable" && item.slot === "ring");
    }
    const item = save.itemsById?.[itemRef.id];
    return Boolean(item && item.type === "wearable" && item.slot === slot);
  };

  const slots: EquipmentSlot[] = ["mainHand", "offHand", "armor", "helmet", "boots", "cloak", "necklace", "ring1", "ring2"];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Equipment</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.content}>
            {slots.map((slotKey) => {
              const equipped = actor.equipment?.[slotKey] || null;
              const equippedName = equipped ? resolveItemName(equipped) : "Empty";
              const compatibleInventory = inventory
                .map((itemRef, index) => ({ itemRef, index }))
                .filter(({ itemRef }) => isCompatibleWithSlot(slotKey, itemRef));

              return (
                <View key={slotKey} style={styles.slotRow}>
                  <Text style={styles.slotLabel}>
                    {SLOT_LABELS[slotKey]}: <Text style={styles.slotValue}>{equippedName}</Text>
                  </Text>
                  <View style={styles.slotActions}>
                    {equipped && (
                      <TouchableOpacity style={styles.actionButton} onPress={() => onUnequip(slotKey)}>
                        <Text style={styles.actionText}>Unequip</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <View style={styles.equipList}>
                    {compatibleInventory.length === 0 ? (
                      <Text style={styles.emptyText}>No compatible items in inventory.</Text>
                    ) : (
                      compatibleInventory.map(({ itemRef, index }) => (
                        <TouchableOpacity
                          key={`${itemRef.kind}:${itemRef.id}:${index}`}
                          style={styles.equipButton}
                          onPress={() => onEquip(slotKey, index, itemRef)}
                        >
                          <Text style={styles.equipButtonText}>Equip {resolveItemName(itemRef)}</Text>
                        </TouchableOpacity>
                      ))
                    )}
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
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 16,
  },
  modal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: "85%",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
  },
  closeButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  closeText: {
    fontSize: 18,
    color: "#666",
  },
  content: {
    paddingHorizontal: 16,
  },
  slotRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  slotValue: {
    fontWeight: "400",
    color: "#555",
  },
  slotActions: {
    flexDirection: "row",
    marginTop: 6,
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#e0e0e0",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  actionText: {
    fontSize: 12,
    color: "#333",
  },
  equipList: {
    marginTop: 8,
    gap: 6,
  },
  equipButton: {
    backgroundColor: "#4a90e2",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  equipButtonText: {
    fontSize: 12,
    color: "#fff",
  },
  emptyText: {
    fontSize: 12,
    color: "#888",
  },
});
