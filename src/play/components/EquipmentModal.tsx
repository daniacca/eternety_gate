import { useMemo, useState } from "react";
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from "react-native";
import type { GameSave, ItemRef } from "@eg/engine";
import {
  canEquipItem,
  listEquippableInventoryItems,
  getItemDefinition,
  getItemDisplaySummary,
  loadWeaponQualities,
  resolveWeaponQualities,
} from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";

type EquipmentSlot =
  | "mainHand"
  | "offHand"
  | "armor"
  | "helmet"
  | "boots"
  | "cloak"
  | "necklace"
  | "ring1"
  | "ring2";

interface EquipmentModalProps {
  visible: boolean;
  onClose: () => void;
  save: GameSave;
  actorId: string;
  onEquip: (slot: EquipmentSlot, itemRef: ItemRef) => void;
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

const SLOT_GROUPS: Array<{ title: string; slots: EquipmentSlot[] }> = [
  { title: "Hands", slots: ["mainHand", "offHand"] },
  { title: "Body", slots: ["armor", "helmet", "cloak", "boots"] },
  { title: "Jewelry", slots: ["necklace", "ring1", "ring2"] },
];

export function EquipmentModal({ visible, onClose, save, actorId, onEquip, onUnequip }: EquipmentModalProps) {
  const actor = save.actorsById[actorId];
  const [pickerSlot, setPickerSlot] = useState<EquipmentSlot | null>(null);
  const [inspectItem, setInspectItem] = useState<ItemRef | null>(null);
  if (!actor) return null;

  const catalogs = useMemo(
    () => ({
      itemsById: save.itemsById ?? {},
      weaponsById: save.weaponsById ?? {},
      armorsById: save.armorsById ?? {},
    }),
    [save]
  );

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

  const pickerItems = useMemo(() => {
    if (!pickerSlot) return [];
    return listEquippableInventoryItems(save, actorId, pickerSlot, catalogs);
  }, [pickerSlot, save, actorId, catalogs]);

  const handleEquip = (slot: EquipmentSlot, itemRef: ItemRef) => {
    const result = canEquipItem(save, actorId, itemRef, slot, catalogs);
    if (!result.ok) {
      Alert.alert("Cannot equip", result.reason || "This item cannot be equipped.");
      return;
    }
    onEquip(result.resolvedSlot ?? slot, itemRef);
    setPickerSlot(null);
  };

  const renderSlotRow = (slot: EquipmentSlot) => {
    const equipped = actor.equipment?.[slot] || null;
    const equippedName = equipped ? resolveItemName(equipped) : "Empty";

    return (
      <View key={slot} style={styles.slotRow}>
        <View style={styles.slotInfo}>
          <Text style={styles.slotLabel}>{SLOT_LABELS[slot]}</Text>
          <Text style={styles.slotValue}>{equippedName}</Text>
        </View>
        <View style={styles.slotActions}>
          {equipped && (
            <>
              <TouchableOpacity style={styles.actionButton} onPress={() => setInspectItem(equipped)}>
                <Text style={styles.actionText}>Inspect</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionButton} onPress={() => onUnequip(slot)}>
                <Text style={styles.actionText}>Unequip</Text>
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.actionButtonPrimary} onPress={() => setPickerSlot(slot)}>
            <Text style={styles.actionTextPrimary}>Equip</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <View style={styles.header}>
            <Text style={styles.title}>Equipment</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.content}>
            {SLOT_GROUPS.map((group) => (
              <View key={group.title} style={styles.group}>
                <Text style={styles.groupTitle}>{group.title}</Text>
                {group.slots.map(renderSlotRow)}
              </View>
            ))}
          </ScrollView>
        </View>

        <Modal visible={Boolean(pickerSlot)} transparent animationType="fade" onRequestClose={() => setPickerSlot(null)}>
          <View style={styles.overlay}>
            <View style={styles.pickerModal}>
              <View style={styles.header}>
                <Text style={styles.title}>Equip {pickerSlot ? SLOT_LABELS[pickerSlot] : ""}</Text>
                <TouchableOpacity onPress={() => setPickerSlot(null)} style={styles.closeButton}>
                  <Text style={styles.closeText}>Close</Text>
                </TouchableOpacity>
              </View>
              <ScrollView style={styles.content}>
                {pickerItems.length === 0 ? (
                  <Text style={styles.emptyText}>No compatible items in inventory.</Text>
                ) : (
                  pickerItems.map((itemRef, index) => {
                    const resolved = getItemDefinition(itemRef, catalogs);
                    const summary = resolved ? getItemDisplaySummary(resolved) : "Unknown";
                    const qtyLabel = itemRef.qty && itemRef.qty > 1 ? ` x${itemRef.qty}` : "";
                    return (
                      <TouchableOpacity
                        key={`${itemRef.kind}:${itemRef.id}:${index}`}
                        style={styles.itemRow}
                        onPress={() => handleEquip(pickerSlot!, itemRef)}
                      >
                        <Text style={styles.itemName}>
                          {resolveItemName(itemRef)}
                          {qtyLabel}
                        </Text>
                        <Text style={styles.itemSummary}>{summary}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <ItemInspectModal
          visible={Boolean(inspectItem)}
          itemRef={inspectItem}
          onClose={() => setInspectItem(null)}
          save={save}
        />
      </View>
    </Modal>
  );
}

function ItemInspectModal({
  visible,
  itemRef,
  onClose,
  save,
}: {
  visible: boolean;
  itemRef: ItemRef | null;
  onClose: () => void;
  save: GameSave;
}) {
  if (!visible || !itemRef) return null;
  const weaponQualityCatalog = loadWeaponQualities(sigilContentPack as any);
  const resolved = getItemDefinition(itemRef, {
    itemsById: save.itemsById ?? {},
    weaponsById: save.weaponsById ?? {},
    armorsById: save.armorsById ?? {},
  });

  const rows: Array<{ label: string; value: string }> = [];
  if (!resolved) {
    rows.push({ label: "Item", value: "Unknown item" });
  } else if (resolved.kind === "weapon") {
    const weapon = resolved.def;
    rows.push({ label: "Kind", value: weapon.kind });
    rows.push({
      label: "Damage",
      value: `${weapon.damage.tier}${weapon.damage.add >= 0 ? "+" : ""}${weapon.damage.add}${
        weapon.damage.bonus ? `+${weapon.damage.bonus}` : ""
      }`,
    });
    rows.push({ label: "Damage Type", value: weapon.damageType });
    rows.push({ label: "Penetration", value: String(weapon.penetration) });
    rows.push({ label: "Handedness", value: weapon.handedness ?? "oneHand" });
    if (weapon.range) {
      rows.push({ label: "Range", value: `${weapon.range.short}/${weapon.range.long}` });
    }
    if (weapon.ammo) {
      rows.push({ label: "Ammo", value: `${weapon.ammo.itemId} x${weapon.ammo.consumedPerAttack}` });
    }
    if (weapon.weight !== undefined) {
      rows.push({ label: "Weight", value: String(weapon.weight) });
    }
    if (weapon.tags?.length) {
      rows.push({ label: "Tags", value: weapon.tags.join(", ") });
    }
  } else if (resolved.kind === "armor") {
    const armor = resolved.def;
    rows.push({ label: "Soak", value: String(armor.soak) });
    if (armor.agiMax !== undefined) {
      rows.push({ label: "AGI Max", value: String(armor.agiMax) });
    }
    rows.push({ label: "Weight", value: String(armor.weight) });
    if (armor.tags?.length) {
      rows.push({ label: "Tags", value: armor.tags.join(", ") });
    }
  } else if (resolved.kind === "item") {
    const item = resolved.def;
    rows.push({ label: "Slot", value: item.slot ?? "N/A" });
    if (item.shield) {
      rows.push({ label: "Shield Soak", value: String(item.shield.soak ?? 0) });
    }
    if (item.grants?.length) {
      const grantText = item.grants
        .map((grant) => {
          if (grant.type === "modifier") {
            return `${grant.key} ${grant.value >= 0 ? "+" : ""}${grant.value}`;
          }
          if (grant.type === "unlockAction") {
            return `Unlock ${grant.actionId}`;
          }
          return grant.type;
        })
        .join(", ");
      rows.push({ label: "Grants", value: grantText });
    }
    rows.push({ label: "Weight", value: String(item.weight) });
    if (item.tags?.length) {
      rows.push({ label: "Tags", value: item.tags.join(", ") });
    }
  }

  const qualityDetails =
    resolved && resolved.kind === "weapon"
      ? resolveWeaponQualities(resolved.def, weaponQualityCatalog).map((quality) => {
          const qualityDef = weaponQualityCatalog[quality.id];
          const label = qualityDef ? qualityDef.name : quality.id;
          const rankLabel = quality.rank ? `${label} (${quality.rank})` : label;
          return {
            id: quality.id,
            label: rankLabel,
            description: qualityDef?.description ?? "",
          };
        })
      : [];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.inspectModal}>
          <View style={styles.header}>
            <Text style={styles.title}>Item Details</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.content}>
            {resolved && <Text style={styles.inspectTitle}>{resolved.def.name}</Text>}
            {rows.map((row) => (
              <View key={row.label} style={styles.inspectRow}>
                <Text style={styles.inspectLabel}>{row.label}</Text>
                <Text style={styles.inspectValue}>{row.value}</Text>
              </View>
            ))}
            {qualityDetails.length > 0 && (
              <View style={styles.qualitySection}>
                <Text style={styles.qualityHeader}>Qualities</Text>
                {qualityDetails.map((quality) => (
                  <View key={quality.id} style={styles.qualityRow}>
                    <Text style={styles.qualityName}>{quality.label}</Text>
                    {quality.description ? <Text style={styles.qualityDescription}>{quality.description}</Text> : null}
                  </View>
                ))}
              </View>
            )}
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
  pickerModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: "70%",
    overflow: "hidden",
  },
  inspectModal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    maxHeight: "70%",
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
    paddingVertical: 6,
  },
  closeText: {
    fontSize: 14,
    color: "#666",
  },
  content: {
    paddingHorizontal: 16,
  },
  group: {
    marginBottom: 16,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#666",
    marginTop: 12,
    marginBottom: 6,
    textTransform: "uppercase",
  },
  slotRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  slotInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  slotLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  slotValue: {
    fontSize: 14,
    color: "#555",
  },
  slotActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 8,
  },
  actionButton: {
    backgroundColor: "#e0e0e0",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    minHeight: 44,
    justifyContent: "center",
  },
  actionButtonPrimary: {
    backgroundColor: "#4a90e2",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    minHeight: 44,
    justifyContent: "center",
  },
  actionText: {
    fontSize: 12,
    color: "#333",
    fontWeight: "600",
  },
  actionTextPrimary: {
    fontSize: 12,
    color: "#fff",
    fontWeight: "600",
  },
  itemRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  itemName: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  itemSummary: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
  emptyText: {
    fontSize: 12,
    color: "#888",
    paddingVertical: 12,
  },
  inspectTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#222",
    marginVertical: 12,
  },
  inspectRow: {
    marginBottom: 10,
  },
  inspectLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
  },
  inspectValue: {
    fontSize: 13,
    color: "#333",
    marginTop: 2,
  },
  qualitySection: {
    marginTop: 12,
    marginBottom: 4,
  },
  qualityHeader: {
    fontSize: 12,
    fontWeight: "700",
    color: "#666",
    marginBottom: 6,
    textTransform: "uppercase",
  },
  qualityRow: {
    marginBottom: 8,
  },
  qualityName: {
    fontSize: 13,
    fontWeight: "600",
    color: "#333",
  },
  qualityDescription: {
    fontSize: 12,
    color: "#555",
    marginTop: 2,
  },
});
