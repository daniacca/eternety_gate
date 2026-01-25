import { View, Text, Modal, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from "react-native";
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
  getActorTalentsWithParams,
  canUseItem,
} from "@eg/engine";
import { useState, useEffect } from "react";
import type { ConditionId } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";
import { TalentShop } from "./TalentShop";

interface PlayerSheetProps {
  visible: boolean;
  save: GameSave;
  onClose: () => void;
  applySystemEffects?: (effects: Effect[]) => void;
  onUseItem?: (itemRef: ItemRef) => void;
  onDebugSpawnGear?: () => void;
  openSpellShop?: boolean;
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

export function PlayerSheet({
  visible,
  save,
  onClose,
  applySystemEffects,
  onUseItem,
  onDebugSpawnGear,
  openSpellShop,
}: PlayerSheetProps) {
  const [showLearnSpells, setShowLearnSpells] = useState(false);
  const [showTalentShop, setShowTalentShop] = useState(false);
  const { width } = useWindowDimensions();
  const isNarrow = width < 420;
  const activeActor = save.actorsById[save.party.activeActorId];
  if (!activeActor) return null;

  // Load catalogs for bonus calculation
  const catalogs = loadCharacterCatalogs(sigilContentPack as any);

  const hpMax = calculateMaxHp(save, activeActor, catalogs);
  const hp = getCurrentHp(save, activeActor, catalogs);
  const rfMax = calculateMaxRf(save, activeActor, catalogs);
  const rf = activeActor.resources.rf;
  const pm = getMagicPower(save, activeActor.id, catalogs);
  const learnedSpells = getLearnedSpells(save, activeActor.id, catalogs);
  const allSpells = getAllSpells();
  const currentXp = activeActor.resources.xp ?? 0;

  useEffect(() => {
    if (visible && openSpellShop) {
      setShowLearnSpells(true);
    }
  }, [visible, openSpellShop]);

  // Get equipment slots from new structure
  const mainHand = activeActor.equipment?.mainHand;
  const offHand = activeActor.equipment?.offHand;
  const equippedArmor = activeActor.equipment?.armor;
  const equippedHelmet = activeActor.equipment?.helmet;
  const equippedBoots = activeActor.equipment?.boots;
  const equippedCloak = activeActor.equipment?.cloak;
  const equippedNecklace = activeActor.equipment?.necklace;
  const equippedRing1 = activeActor.equipment?.ring1;
  const equippedRing2 = activeActor.equipment?.ring2;

  // Get conditions
  const conditions = activeActor.conditions || {};
  const conditionEntries = Object.entries(conditions) as Array<
    [ConditionId, { stacks?: number; untilTurnCounter?: number; source?: string }]
  >;

  // Get inventory from actor (new structure)
  const inventory = activeActor.inventory || [];

  const equippedTraits: Record<string, any> = {};
  if (save.itemsById && activeActor.equipment) {
    const equippedItems = [
      activeActor.equipment.mainHand,
      activeActor.equipment.offHand,
      activeActor.equipment.armor,
      activeActor.equipment.helmet,
      activeActor.equipment.boots,
      activeActor.equipment.cloak,
      activeActor.equipment.necklace,
      activeActor.equipment.ring1,
      activeActor.equipment.ring2,
    ];
    for (const itemRef of equippedItems) {
      if (!itemRef || (itemRef.kind !== "item" && itemRef.kind !== "misc")) continue;
      const item = save.itemsById[itemRef.id];
      if (!item?.grants) continue;
      for (const grant of item.grants) {
        if (grant.type === "trait" && activeActor.traits[grant.traitId] === undefined) {
          equippedTraits[grant.traitId] = grant.params ?? true;
        }
      }
    }
  }
  const combinedTraits = { ...equippedTraits, ...activeActor.traits };

  const getCharacteristicBonusBase = (value: number): number => Math.floor(value / 10);
  const armorAgiMax = getActorArmor(save, activeActor).armor?.agiMax;

  // Helper to get item name
  const getItemName = (itemRef: ItemRef | null | undefined): string => {
    if (!itemRef) return "Nessuno";
    if (itemRef.kind === "weapon") {
      return save.weaponsById?.[itemRef.id]?.name || itemRef.id;
    }
    if (itemRef.kind === "armor") {
      return save.armorsById?.[itemRef.id]?.name || itemRef.id;
    }
    return save.itemsById?.[itemRef.id]?.name || itemRef.id;
  };

  const resolveEquipSlot = (itemRef: ItemRef): EquipmentSlot | null => {
    if (itemRef.kind === "armor") return "armor";
    if (itemRef.kind === "weapon") return "mainHand";
    if (itemRef.kind !== "item" && itemRef.kind !== "misc") return null;
    const itemDef = save.itemsById?.[itemRef.id];
    if (!itemDef || (itemDef.kind ?? itemDef.type) !== "wearable" || !itemDef.slot) return null;
    if (itemDef.shield) return "offHand";
    if (itemDef.slot === "ring") {
      if (!activeActor.equipment?.ring1) return "ring1";
      if (!activeActor.equipment?.ring2) return "ring2";
      return "ring1";
    }
    return itemDef.slot;
  };

  // Helper to handle equip action
  const handleEquip = (itemRef: ItemRef, inventoryIndex: number) => {
    if (!applySystemEffects) return;
    const slot = resolveEquipSlot(itemRef);
    if (!slot) return;
    applySystemEffects([{ op: "combatEquipItem", actorId: activeActor.id, itemRef, slot, inventoryIndex }]);
  };

  // Helper to handle unequip action
  const handleUnequip = (slot: EquipmentSlot) => {
    if (!applySystemEffects) return;
    applySystemEffects([{ op: "combatUnequipItem", actorId: activeActor.id, slot }]);
  };

  // Helper to handle drop action
  const handleDrop = (
    itemRef: ItemRef | null,
    fromSlot?: EquipmentSlot | "inventory",
    inventoryIndex?: number
  ) => {
    if (!applySystemEffects || !itemRef) return;
    applySystemEffects([{ op: "combatDrop", actorId: activeActor.id, itemRef, fromSlot, inventoryIndex }]);
  };

  const equipmentRows: Array<{ label: string; slot: EquipmentSlot; item: ItemRef | null | undefined }> = [
    { label: "Mano principale", slot: "mainHand", item: mainHand },
    { label: "Mano secondaria", slot: "offHand", item: offHand },
    { label: "Armatura", slot: "armor", item: equippedArmor },
    { label: "Elmo", slot: "helmet", item: equippedHelmet },
    { label: "Stivali", slot: "boots", item: equippedBoots },
    { label: "Mantello", slot: "cloak", item: equippedCloak },
    { label: "Collana", slot: "necklace", item: equippedNecklace },
    { label: "Anello 1", slot: "ring1", item: equippedRing1 },
    { label: "Anello 2", slot: "ring2", item: equippedRing2 },
  ];

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
              <View style={[styles.statsGrid, isNarrow && styles.statsGridNarrow]}>
                {Object.entries(activeActor.stats).map(([key, value]) => {
                  const statKey = key as StatKey;
                  const rawValue = value as number;
                  const rawBonus = getCharacteristicBonus(save, activeActor.id, statKey, catalogs);
                  const baseBonus = Math.floor(rawValue / 10);
                  const isBoosted = rawBonus > baseBonus;
                  const hasAgiCap = statKey === "AGI";
                  const cappedValue = hasAgiCap && armorAgiMax !== undefined ? Math.min(rawValue, armorAgiMax) : rawValue;
                  const cappedBonus = hasAgiCap ? getCharacteristicBonusBase(cappedValue) : rawBonus;
                  const isCapped = hasAgiCap && cappedValue < rawValue;
                  const showCappedBonus = hasAgiCap && cappedBonus !== rawBonus;
                  return (
                    <View key={key} style={[styles.statRow, isNarrow && styles.statRowNarrow]}>
                      <Text style={styles.statLabel}>{statLabels[key] || key}:</Text>
                      <View style={styles.statValueContainer}>
                        {isCapped ? (
                          <>
                            <Text style={[styles.statValue, styles.statValueLimited]}>{cappedValue}</Text>
                            <Text style={styles.statValueMuted}> ({rawValue})</Text>
                          </>
                        ) : (
                          <Text style={styles.statValue}>{rawValue}</Text>
                        )}
                        <Text style={[styles.statBonus, isBoosted && styles.statBonusBoosted]}>
                          {isCapped && showCappedBonus ? (
                            <>
                              <Text style={styles.statBonusLimited}>
                                ({cappedBonus >= 0 ? "+" : ""}
                                {cappedBonus})
                              </Text>
                              <Text style={styles.statValueMuted}>
                                {" "}
                                ({rawBonus >= 0 ? "+" : ""}
                                {rawBonus})
                              </Text>
                            </>
                          ) : (
                            <>
                              ({rawBonus >= 0 ? "+" : ""}
                              {rawBonus})
                            </>
                          )}
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
                <Text style={styles.resourceValue}>{activeActor.resources.xp ?? 0}</Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>XP Totale:</Text>
                <Text style={styles.resourceValue}>{activeActor.resources.xpEarned ?? 0}</Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>XP Spesa:</Text>
                <Text style={styles.resourceValue}>{activeActor.resources.xpSpent ?? 0}</Text>
              </View>
              <View style={styles.resourceRow}>
                <Text style={styles.resourceLabel}>Fate Points:</Text>
                <Text style={[styles.resourceValue, styles.fatePointsValue]}>
                  {activeActor.resources.fatePoints ?? 0}
                </Text>
              </View>

              {/* Dev Controls */}
              {__DEV__ && (
                <View style={styles.devControls}>
                  <Text style={styles.devLabel}>Dev Controls</Text>
                  <View style={styles.devButtonsRow}>
                    <TouchableOpacity
                      style={styles.devButton}
                      onPress={() => {
                        if (applySystemEffects) {
                          applySystemEffects([{ op: "grantXp", actorId: activeActor.id, amount: 1000 }]);
                        }
                      }}
                    >
                      <Text style={styles.devButtonText}>+1000 XP</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.devButton}
                      onPress={() => {
                        if (applySystemEffects) {
                          applySystemEffects([{ op: "grantFatePoint", actorId: activeActor.id, amount: 1 }]);
                        }
                      }}
                    >
                      <Text style={styles.devButtonText}>+1 Fate</Text>
                    </TouchableOpacity>
                  </View>
                  {onDebugSpawnGear && (
                    <TouchableOpacity style={styles.devButtonWide} onPress={onDebugSpawnGear}>
                      <Text style={styles.devButtonText}>Spawn Test Gear</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
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
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Talenti</Text>
                <TouchableOpacity style={styles.shopButton} onPress={() => setShowTalentShop(true)}>
                  <Text style={styles.shopButtonText}>Acquista Talenti</Text>
                </TouchableOpacity>
              </View>
              {Object.keys(activeActor.talents).length === 0 ? (
                <Text style={styles.emptyText}>Nessun talento</Text>
              ) : (
                getActorTalentsWithParams(activeActor).map(({ talentId, rank, params }) => {
                  const talentDef = (talentsCatalog as any[]).find((t) => t.id === talentId);
                  const talentName = talentDef?.name || talentId.replace("talent:", "");
                  const paramsText =
                    params && Object.keys(params).length > 0 ? ` (${Object.values(params).join(", ")})` : "";
                  return (
                    <View key={talentId} style={styles.talentRow}>
                      <View style={styles.talentInfo}>
                        <Text style={styles.talentName}>
                          {talentName}
                          {paramsText}
                        </Text>
                        <Text style={styles.talentIdText}>{talentId.replace("talent:", "")}</Text>
                      </View>
                      <Text style={styles.talentRank}>Rango {rank}</Text>
                    </View>
                  );
                })
              )}
            </View>

            {/* Traits */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tratti</Text>
              {Object.keys(combinedTraits).length === 0 ? (
                <Text style={styles.emptyText}>Nessun tratto</Text>
              ) : (
                Object.entries(combinedTraits).map(([traitId, params]) => {
                  const isEquippedTrait = activeActor.traits[traitId] === undefined;
                  // Special handling for unnatural_characteristic trait
                  if (traitId === "trait:unnatural_characteristic" && params && typeof params === "object") {
                    const characteristics = (params as any).characteristics;
                    if (Array.isArray(characteristics)) {
                      return (
                        <View key={traitId} style={styles.traitRow}>
                          <Text style={styles.traitName}>
                            {traitId.replace("trait:", "")}
                            {isEquippedTrait ? " (equip)" : ""}
                          </Text>
                          <View style={styles.traitParamsContainer}>
                            {characteristics.map((char: any, index: number) => {
                              if (char && typeof char === "object" && char.stat && typeof char.bonusX === "number") {
                                const statLabel = statLabels[char.stat] || char.stat;
                                return (
                                  <Text key={index} style={styles.traitParams}>
                                    {statLabel}: +{char.bonusX}
                                  </Text>
                                );
                              }
                              return null;
                            })}
                          </View>
                        </View>
                      );
                    }
                  }

                  // Default rendering for other traits
                  return (
                    <View key={traitId} style={styles.traitRow}>
                          <Text style={styles.traitName}>
                            {traitId.replace("trait:", "")}
                            {isEquippedTrait ? " (equip)" : ""}
                          </Text>
                      {params && typeof params === "object" && Object.keys(params).length > 0 && (
                        <Text style={styles.traitParams}>
                          {Object.entries(params)
                            .map(([key, value]) => {
                              // Handle different value types
                              if (Array.isArray(value)) {
                                return `${key}: [${value.length} items]`;
                              }
                              if (typeof value === "object" && value !== null) {
                                return `${key}: {...}`;
                              }
                              return `${key}: ${value}`;
                            })
                            .join(", ")}
                        </Text>
                      )}
                    </View>
                  );
                })
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

                    // Grant XP first (if needed) - per actor
                    const actorXp = activeActor.resources.xp ?? 0;
                    const xpToGrant = Math.max(0, totalXpNeeded - actorXp);

                    const effects: Effect[] = [];
                    if (xpToGrant > 0) {
                      effects.push({
                        op: "grantXp",
                        actorId: activeActor.id,
                        amount: xpToGrant,
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
              {equipmentRows.map(({ label, slot, item }) => (
                <View key={slot} style={styles.equipmentSlotRow}>
                  <View style={styles.equipmentSlotInfo}>
                    <Text style={styles.equipmentLabel}>{label}:</Text>
                    <Text style={styles.equipmentValue}>{getItemName(item)}</Text>
                  </View>
                  {item && applySystemEffects && (
                    <View style={styles.equipmentActions}>
                      <TouchableOpacity style={styles.actionButton} onPress={() => handleUnequip(slot)}>
                        <Text style={styles.actionButtonText}>Rimuovi</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.dropButton]}
                        onPress={() => handleDrop(item, slot)}
                      >
                        <Text style={styles.actionButtonText}>Lascia</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              ))}
            </View>

            {/* Inventory */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Inventario</Text>
              {inventory.length === 0 ? (
                <Text style={styles.emptyText}>Inventario vuoto</Text>
              ) : (
                inventory.map((itemRef, index) => {
                  const itemDef = itemRef.kind === "item" || itemRef.kind === "misc" ? save.itemsById?.[itemRef.id] : null;
                  const isConsumable = Boolean(itemDef?.consumable?.actionId);
                  const isWearable = Boolean(itemDef && (itemDef.kind ?? itemDef.type) === "wearable");
                  const canUse = isConsumable ? canUseItem(save, activeActor.id, itemRef) : { ok: false };
                  return (
                    <View key={index} style={styles.inventoryRow}>
                      <Text style={styles.inventoryItem}>{getItemName(itemRef)}</Text>
                      {applySystemEffects && (
                        <View style={styles.inventoryActions}>
                          {isConsumable && onUseItem && (
                            <TouchableOpacity
                              style={[styles.actionButton, !canUse.ok && styles.actionButtonDisabled]}
                              onPress={() => onUseItem(itemRef)}
                              disabled={!canUse.ok}
                            >
                              <Text style={[styles.actionButtonText, !canUse.ok && styles.actionButtonTextDisabled]}>Usa</Text>
                            </TouchableOpacity>
                          )}
                          {(itemRef.kind === "weapon" || itemRef.kind === "armor" || isWearable) && (
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
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Talent Shop Modal */}
      <TalentShop
        visible={showTalentShop}
        save={save}
        actor={activeActor}
        onClose={() => setShowTalentShop(false)}
        applySystemEffects={applySystemEffects!}
      />
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
    width: "92%",
    maxWidth: 600,
    height: "80%",
    minHeight: 360,
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
  statsGridNarrow: {
    flexDirection: "column",
    gap: 10,
  },
  statRow: {
    flexDirection: "row",
    width: "48%",
    justifyContent: "space-between",
  },
  statRowNarrow: {
    width: "100%",
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
  statValueLimited: {
    color: "#dc2626",
  },
  statValueMuted: {
    fontSize: 12,
    color: "#9ca3af",
  },
  statBonus: {
    fontSize: 12,
    color: "#666",
    fontStyle: "italic",
  },
  statBonusLimited: {
    color: "#dc2626",
    fontStyle: "normal",
    fontWeight: "700",
  },
  statBonusBoosted: {
    color: "#16a34a",
    fontWeight: "700",
    fontStyle: "normal",
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
  actionButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  dropButton: {
    backgroundColor: "#FF3B30",
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "500",
  },
  actionButtonTextDisabled: {
    color: "#666",
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
    marginTop: 2,
  },
  traitParamsContainer: {
    marginTop: 4,
    gap: 2,
  },
  // New styles for enhanced features
  fatePointsValue: {
    color: "#f59e0b",
    fontWeight: "700",
  },
  devControls: {
    marginTop: 12,
    padding: 12,
    backgroundColor: "#fef2f2",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fca5a5",
  },
  devLabel: {
    fontSize: 11,
    color: "#dc2626",
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
  },
  devButtonsRow: {
    flexDirection: "row",
    gap: 8,
  },
  devButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#ef4444",
    borderRadius: 6,
  },
  devButtonWide: {
    marginTop: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#ef4444",
    borderRadius: 6,
    alignItems: "center",
  },
  devButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  shopButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "#8b5cf6",
    borderRadius: 6,
  },
  shopButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  talentInfo: {
    flex: 1,
  },
  talentIdText: {
    fontSize: 10,
    color: "#888",
    fontStyle: "italic",
    marginTop: 2,
  },
});
