import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import type { GameSave, Effect, ItemRef, StatKey } from "@eg/engine";
import {
  getActorWeapon,
  getActorArmor,
  getCharacteristicBonus,
  loadCharacterCatalogs,
  calculateMaxHp,
  getCurrentHp,
  calculateMaxRf,
  getAllSpells,
  canLearnSpell,
  getLearnedSpells,
  getMagicPower,
} from "@eg/engine";
import { useState } from "react";
import type { ConditionId } from "@eg/engine";
import sigilContent from "@eg/content/sigil.content.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";

interface PlayerSheetProps {
  visible: boolean;
  save: GameSave;
  onClose: () => void;
  applySystemEffects?: (effects: Effect[]) => void;
}

const conditionLabels: Record<ConditionId, string> = {
  prone: "A terra",
  stunned: "Stordito",
  bleeding: "Sanguinante",
  fatigue: "Affaticato",
  unconscious: "Incosciente",
  bound: "Legato",
  force_shield: "Scudo di Forza",
  steel_body: "Corpo d'Acciaio",
  warp_speed: "Warp Speed",
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

export function PlayerSheet({ visible, save, onClose, applySystemEffects }: PlayerSheetProps) {
  const [showLearnSpells, setShowLearnSpells] = useState(false);
  const activeActor = save.actorsById[save.party.activeActorId];
  if (!activeActor) return null;

  // Load catalogs for bonus calculation
  const catalogs = loadCharacterCatalogs({
    ...sigilContent,
    skills: skillsCatalog as any,
    talents: talentsCatalog as any,
    traits: traitsCatalog as any,
  } as any);

  const hpMax = calculateMaxHp(save, activeActor, catalogs);
  const hp = getCurrentHp(save, activeActor, catalogs);
  const rfMax = calculateMaxRf(save, activeActor, catalogs);
  const rf = activeActor.resources.rf;
  const pm = getMagicPower(save, activeActor.id, catalogs);
  const learnedSpells = getLearnedSpells(save, activeActor.id, catalogs);
  const allSpells = getAllSpells();
  const currentXp = save.meta?.xp ?? 0;

  // Get equipment (using backward compatibility helpers)
  const weapon = getActorWeapon(save, activeActor);
  const armor = getActorArmor(save, activeActor);

  // Get equipment slots from new structure
  const mainHand = activeActor.equipment?.mainHand;
  const offHand = activeActor.equipment?.offHand;
  const equippedArmor = activeActor.equipment?.armor;

  // Get conditions
  const conditions = activeActor.conditions || {};
  const conditionEntries = Object.entries(conditions) as Array<
    [ConditionId, { stacks?: number; untilTurnCounter?: number; source?: string }]
  >;

  // Get inventory from actor (new structure)
  const inventory = activeActor.inventory || [];

  // Helper to get item name
  const getItemName = (itemRef: ItemRef | null | undefined): string => {
    if (!itemRef) return "Nessuno";
    if (itemRef.kind === "weapon") {
      return save.weaponsById?.[itemRef.id]?.name || itemRef.id;
    }
    if (itemRef.kind === "armor") {
      return save.armorsById?.[itemRef.id]?.name || itemRef.id;
    }
    return itemRef.id;
  };

  // Helper to handle equip action
  const handleEquip = (itemRef: ItemRef, inventoryIndex: number) => {
    if (!applySystemEffects) return;
    let slot: "mainHand" | "offHand" | "armor" = "mainHand";
    if (itemRef.kind === "armor") {
      slot = "armor";
    } else if (itemRef.kind === "weapon") {
      slot = "mainHand";
    }
    applySystemEffects([{ op: "combatEquipItem", actorId: activeActor.id, itemRef, slot, inventoryIndex }]);
  };

  // Helper to handle unequip action
  const handleUnequip = (slot: "mainHand" | "offHand" | "armor") => {
    if (!applySystemEffects) return;
    applySystemEffects([{ op: "combatUnequipItem", actorId: activeActor.id, slot }]);
  };

  // Helper to handle drop action
  const handleDrop = (
    itemRef: ItemRef | null,
    fromSlot?: "mainHand" | "offHand" | "armor" | "inventory",
    inventoryIndex?: number
  ) => {
    if (!applySystemEffects || !itemRef) return;
    applySystemEffects([{ op: "combatDrop", actorId: activeActor.id, itemRef, fromSlot, inventoryIndex }]);
  };

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
                {Object.entries(activeActor.stats).map(([key, value]) => {
                  const bonus = getCharacteristicBonus(save, activeActor.id, key as StatKey, catalogs);
                  return (
                    <View key={key} style={styles.statRow}>
                      <Text style={styles.statLabel}>{statLabels[key] || key}:</Text>
                      <View style={styles.statValueContainer}>
                        <Text style={styles.statValue}>{value}</Text>
                        <Text style={styles.statBonus}>
                          (Bonus: {bonus >= 0 ? "+" : ""}
                          {bonus})
                        </Text>
                      </View>
                    </View>
                  );
                })}
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
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>XP:</Text>
                <Text style={styles.resourceValue}>{save.meta?.xp ?? 0}</Text>
              </View>
            </View>

            {/* Skills */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Abilità</Text>
              {Object.keys(activeActor.skills).length === 0 ? (
                <Text style={styles.emptyText}>Nessuna abilità</Text>
              ) : (
                Object.entries(activeActor.skills).map(([skillId, rank]) => (
                  <View key={skillId} style={styles.skillRow}>
                    <Text style={styles.skillName}>{skillId.replace("skill:", "")}</Text>
                    <Text style={styles.skillRank}>Rango {rank}</Text>
                  </View>
                ))
              )}
            </View>

            {/* Talents */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Talenti</Text>
              {Object.keys(activeActor.talents).length === 0 ? (
                <Text style={styles.emptyText}>Nessun talento</Text>
              ) : (
                Object.entries(activeActor.talents).map(([talentId, rank]) => (
                  <View key={talentId} style={styles.talentRow}>
                    <Text style={styles.talentName}>{talentId.replace("talent:", "")}</Text>
                    <Text style={styles.talentRank}>Rango {rank}</Text>
                  </View>
                ))
              )}
            </View>

            {/* Traits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tratti</Text>
              {Object.keys(activeActor.traits).length === 0 ? (
                <Text style={styles.emptyText}>Nessun tratto</Text>
              ) : (
                Object.entries(activeActor.traits).map(([traitId, params]) => (
                  <View key={traitId} style={styles.traitRow}>
                    <Text style={styles.traitName}>{traitId.replace("trait:", "")}</Text>
                    {params && typeof params === "object" && Object.keys(params).length > 0 && (
                      <Text style={styles.traitParams}>
                        {Object.entries(params)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join(", ")}
                      </Text>
                    )}
                  </View>
                ))
              )}
            </View>

            {/* Magic */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Magia</Text>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>PM:</Text>
                <Text style={styles.resourceValue}>{pm}</Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>RF:</Text>
                <Text style={styles.resourceValue}>
                  {rf}/{rfMax}
                </Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>Incantesimi Imparati:</Text>
                <Text style={styles.resourceValue}>{learnedSpells.length}</Text>
              </View>
              <TouchableOpacity
                style={[styles.actionButton, { marginTop: 8 }]}
                onPress={() => setShowLearnSpells(!showLearnSpells)}
              >
                <Text style={styles.actionButtonText}>{showLearnSpells ? "Nascondi" : "Impara Incantesimi"}</Text>
              </TouchableOpacity>
              {/* Debug: Learn all spells button */}
              <TouchableOpacity
                style={[styles.actionButton, { marginTop: 8, backgroundColor: "#ff6b6b" }]}
                onPress={() => {
                  if (applySystemEffects) {
                    // Calculate total XP needed
                    const totalXpNeeded = allSpells.reduce((sum, spell) => {
                      const isLearned = learnedSpells.some((s) => s.id === spell.id);
                      return isLearned ? sum : sum + (spell.xpCost || 0);
                    }, 0);

                    // Grant XP first (if needed)
                    const currentXp = save.meta?.xp ?? 0;
                    const xpToGrant = Math.max(0, totalXpNeeded - currentXp);

                    const effects: Effect[] = [];
                    if (xpToGrant > 0) {
                      effects.push({
                        op: "addCounter",
                        path: "meta.xp",
                        value: xpToGrant,
                      });
                    }

                    // Learn all spells
                    allSpells.forEach((spell) => {
                      const isLearned = learnedSpells.some((s) => s.id === spell.id);
                      if (!isLearned) {
                        effects.push({
                          op: "learnSpell",
                          actorId: activeActor.id,
                          spellId: spell.id,
                        });
                      }
                    });

                    applySystemEffects(effects);
                  }
                }}
              >
                <Text style={styles.actionButtonText}>Impara tutte le magie (debug)</Text>
              </TouchableOpacity>
              {showLearnSpells && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>XP disponibili: {currentXp}</Text>
                  {allSpells.map((spell) => {
                    const isLearned = learnedSpells.some((s) => s.id === spell.id);
                    const canLearnResult = canLearnSpell(save, catalogs, activeActor.id, spell.id);

                    return (
                      <View
                        key={spell.id}
                        style={{
                          padding: 8,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: "#ddd",
                          borderRadius: 4,
                          backgroundColor: isLearned ? "#e8f5e9" : "#fff",
                        }}
                      >
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>{spell.name}</Text>
                        <Text style={{ fontSize: 12, color: "#666" }}>
                          {spell.discipline} - CN: {spell.baseCN} - Costo: {spell.xpCost} XP
                        </Text>
                        <Text style={{ fontSize: 11, color: "#888" }}>{spell.notes}</Text>
                        {isLearned ? (
                          <Text style={{ fontSize: 11, color: "#4a90e2", marginTop: 4 }}>✓ Imparato</Text>
                        ) : (
                          <View style={{ marginTop: 4 }}>
                            {!canLearnResult.canLearn && (
                              <Text style={{ fontSize: 10, color: "#ff6b6b" }}>{canLearnResult.reason}</Text>
                            )}
                            {canLearnResult.canLearn && (
                              <TouchableOpacity
                                style={{
                                  backgroundColor: "#4a90e2",
                                  paddingHorizontal: 12,
                                  paddingVertical: 6,
                                  borderRadius: 4,
                                  marginTop: 4,
                                  alignSelf: "flex-start",
                                }}
                                onPress={() => {
                                  if (applySystemEffects) {
                                    applySystemEffects([
                                      {
                                        op: "learnSpell",
                                        actorId: activeActor.id,
                                        spellId: spell.id,
                                      },
                                    ]);
                                  }
                                }}
                              >
                                <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Impara</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
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

              {/* Main Hand */}
              <View style={styles.equipmentSlotRow}>
                <View style={styles.equipmentSlotInfo}>
                  <Text style={styles.equipmentLabel}>Mano principale:</Text>
                  <Text style={styles.equipmentValue}>{getItemName(mainHand)}</Text>
                </View>
                {mainHand && applySystemEffects && (
                  <View style={styles.equipmentActions}>
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleUnequip("mainHand")}>
                      <Text style={styles.actionButtonText}>Rimuovi</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.dropButton]}
                      onPress={() => handleDrop(mainHand, "mainHand")}
                    >
                      <Text style={styles.actionButtonText}>Lascia</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Off Hand */}
              <View style={styles.equipmentSlotRow}>
                <View style={styles.equipmentSlotInfo}>
                  <Text style={styles.equipmentLabel}>Mano secondaria:</Text>
                  <Text style={styles.equipmentValue}>{getItemName(offHand)}</Text>
                </View>
                {offHand && applySystemEffects && (
                  <View style={styles.equipmentActions}>
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleUnequip("offHand")}>
                      <Text style={styles.actionButtonText}>Rimuovi</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.dropButton]}
                      onPress={() => handleDrop(offHand, "offHand")}
                    >
                      <Text style={styles.actionButtonText}>Lascia</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              {/* Armor */}
              <View style={styles.equipmentSlotRow}>
                <View style={styles.equipmentSlotInfo}>
                  <Text style={styles.equipmentLabel}>Armatura:</Text>
                  <Text style={styles.equipmentValue}>{getItemName(equippedArmor)}</Text>
                </View>
                {equippedArmor && applySystemEffects && (
                  <View style={styles.equipmentActions}>
                    <TouchableOpacity style={styles.actionButton} onPress={() => handleUnequip("armor")}>
                      <Text style={styles.actionButtonText}>Rimuovi</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionButton, styles.dropButton]}
                      onPress={() => handleDrop(equippedArmor, "armor")}
                    >
                      <Text style={styles.actionButtonText}>Lascia</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </View>

            {/* Inventory */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Inventario</Text>
              {inventory.length === 0 ? (
                <Text style={styles.emptyText}>Inventario vuoto</Text>
              ) : (
                inventory.map((itemRef, index) => (
                  <View key={index} style={styles.inventoryRow}>
                    <Text style={styles.inventoryItem}>{getItemName(itemRef)}</Text>
                    {applySystemEffects && (
                      <View style={styles.inventoryActions}>
                        {(itemRef.kind === "weapon" || itemRef.kind === "armor") && (
                          <TouchableOpacity style={styles.actionButton} onPress={() => handleEquip(itemRef, index)}>
                            <Text style={styles.actionButtonText}>
                              {itemRef.kind === "weapon" ? "Equipaggia" : "Indossa"}
                            </Text>
                          </TouchableOpacity>
                        )}
                        <TouchableOpacity
                          style={[styles.actionButton, styles.dropButton]}
                          onPress={() => handleDrop(itemRef, "inventory", index)}
                        >
                          <Text style={styles.actionButtonText}>Lascia</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))
              )}
            </View>
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
  statValueContainer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  statValue: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
  },
  statBonus: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
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
  equipmentSlotRow: {
    marginBottom: 12,
    padding: 8,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
  equipmentSlotInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 4,
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
  equipmentActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 4,
  },
  inventoryRow: {
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  inventoryItem: {
    fontSize: 14,
    color: "#333",
    flex: 1,
  },
  inventoryActions: {
    flexDirection: "row",
    gap: 8,
  },
  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#007AFF",
    borderRadius: 4,
  },
  dropButton: {
    backgroundColor: "#FF3B30",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
  emptyText: {
    fontSize: 14,
    color: "#999",
    fontStyle: "italic",
  },
  skillRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#f9f9f9",
    borderRadius: 4,
  },
  skillName: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  skillRank: {
    fontSize: 14,
    color: "#666",
  },
  talentRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#e8f4f8",
    borderRadius: 4,
  },
  talentName: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  talentRank: {
    fontSize: 14,
    color: "#666",
  },
  traitRow: {
    padding: 8,
    marginBottom: 4,
    backgroundColor: "#f0f8e8",
    borderRadius: 4,
  },
  traitName: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  traitParams: {
    fontSize: 12,
    color: "#666",
    marginTop: 4,
  },
});
