import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from "react-native";
import { useState, useMemo } from "react";
import type { GameSave, Effect, Actor, Talent, CharacterCatalogs, TalentId } from "@eg/engine";
import { canAcquireTalent, getActorTalentsWithParams, loadCharacterCatalogs, getTalentById } from "@eg/engine";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import { sigilContentPack } from "@eg/content/src";

interface TalentShopProps {
  visible: boolean;
  save: GameSave;
  actor: Actor;
  onClose: () => void;
  applySystemEffects?: (effects: Effect[]) => void;
}

// Talent tier colors
const tierColors: Record<number, { bg: string; border: string; text: string; badge: string }> = {
  1: { bg: "#1e3a5f", border: "#3b82f6", text: "#93c5fd", badge: "#3b82f6" },
  2: { bg: "#422006", border: "#f59e0b", text: "#fcd34d", badge: "#f59e0b" },
  3: { bg: "#4c1d4c", border: "#ec4899", text: "#f9a8d4", badge: "#ec4899" },
};

// Category colors
const categoryColors: Record<string, { bg: string; text: string }> = {
  common: { bg: "#374151", text: "#d1d5db" },
  fighter: { bg: "#7f1d1d", text: "#fca5a5" },
  archer: { bg: "#14532d", text: "#86efac" },
  mage: { bg: "#312e81", text: "#c4b5fd" },
  martial: { bg: "#78350f", text: "#fde68a" },
};

// Option sets for chosenParam talents
const PARAM_OPTIONS: Record<string, string[]> = {
  chosenType: ["magic", "poison", "disease", "fear"],
  chosenDiscipline: ["PYRA", "KINESIS", "MENTIS", "VATES", "CORPUS"],
};

export function TalentShop({ visible, save, actor, onClose, applySystemEffects }: TalentShopProps) {
  const [selectedTalent, setSelectedTalent] = useState<Talent | null>(null);
  const [paramModalVisible, setParamModalVisible] = useState(false);
  const [activeTier, setActiveTier] = useState<1 | 2 | 3>(1);

  // Load catalogs
  const catalogs = useMemo(() => {
    return loadCharacterCatalogs(sigilContentPack as any);
  }, []);

  // Get all talents from catalog grouped by category
  const talentsByCategory = useMemo(() => {
    const talents = talentsCatalog as Talent[];
    const grouped: Record<string, Talent[]> = {
      common: [],
      fighter: [],
      archer: [],
      mage: [],
      martial: [],
    };

    for (const talent of talents) {
      const cat = talent.category || "common";
      if (grouped[cat]) {
        grouped[cat].push(talent);
      } else {
        grouped.common.push(talent);
      }
    }

    // Sort each category by tier then name
    for (const cat of Object.keys(grouped)) {
      grouped[cat].sort((a, b) => {
        if (a.tier !== b.tier) return a.tier - b.tier;
        return a.name.localeCompare(b.name);
      });
    }

    return grouped;
  }, []);

  const filteredTalentsByCategory = useMemo(() => {
    const filtered: Record<string, Talent[]> = {};
    for (const [category, talents] of Object.entries(talentsByCategory)) {
      filtered[category] = talents.filter((talent) => talent.tier === activeTier);
    }
    return filtered;
  }, [talentsByCategory, activeTier]);

  // Get current XP (per-actor XP)
  const currentXp = actor?.resources?.xp ?? 0;
  const fatePoints = actor?.resources?.fatePoints ?? 0;

  // Get actor's acquired talents with params
  const acquiredTalents = useMemo(() => {
    if (!actor) return [];
    return getActorTalentsWithParams(actor);
  }, [actor]);

  // Handle buying a talent
  const handleBuyTalent = (talent: Talent, chosenParams?: Record<string, string>) => {
    if (!applySystemEffects) return;
    applySystemEffects([
      {
        op: "acquireTalent",
        actorId: actor.id,
        talentId: talent.id,
        chosenParams,
      },
    ]);
    setSelectedTalent(null);
    setParamModalVisible(false);
  };

  // Dev helpers
  const handleGrantXp = (amount: number) => {
    if (!applySystemEffects) return;
    applySystemEffects([{ op: "grantXp", actorId: actor.id, amount }]);
  };

  const handleGrantFate = () => {
    if (!applySystemEffects) return;
    applySystemEffects([{ op: "grantFatePoint", actorId: actor.id, amount: 1 }]);
  };

  // Get prerequisite status with detailed reason
  const getPrereqStatus = (
    talent: Talent,
    chosenParams?: Record<string, string>
  ): { canBuy: boolean; reason: string; prereqList: string } => {
    const result = canAcquireTalent(save, catalogs, actor, talent, chosenParams);
    
    // Build prerequisite list for display
    const prereqParts: string[] = [];
    for (const prereq of talent.prerequisites || []) {
      if (prereq.type === "statAtLeast") {
        prereqParts.push(`${prereq.stat} ≥ ${prereq.value}`);
      } else if (prereq.type === "hasTalent") {
        prereqParts.push(`Talent: ${prereq.talentId.replace("talent:", "")}`);
      } else if (prereq.type === "hasTalentRank") {
        prereqParts.push(`${prereq.talentId.replace("talent:", "")} R${prereq.minRank}+`);
      } else if (prereq.type === "hasTrait") {
        prereqParts.push(`Trait: ${prereq.traitId.replace("trait:", "")}`);
      } else if (prereq.type === "hasSpell") {
        prereqParts.push(`Spell: ${prereq.spellId}`);
      }
    }

    return {
      canBuy: result.canAcquire,
      reason: result.reason || "Available",
      prereqList: prereqParts.length > 0 ? prereqParts.join(" • ") : "None",
    };
  };

  const getParamRank = (talent: Talent, paramValue: string): number => {
    if (!talent.uniquenessKey || !talent.chosenParam) return 0;
    const resolvedKey = talent.uniquenessKey.replace(`<${talent.chosenParam.paramKey}>`, paramValue);
    const rankMap = (actor as any).talentUniquenessRanksById?.[talent.id] as Record<string, number> | undefined;
    if (rankMap && typeof rankMap[resolvedKey] === "number") return rankMap[resolvedKey] ?? 0;
    const legacyKeys = (actor as any).talentUniquenessKeys as string[] | undefined;
    return legacyKeys?.includes(resolvedKey) ? 1 : 0;
  };

  const renderTalentCard = (talent: Talent) => {
    const currentRank = actor?.talents?.[talent.id] ?? 0;
    const maxRank = talent.maxRank ?? 1;
    const hasParam = !!talent.chosenParam;
    const paramKey = talent.chosenParam?.paramKey;
    const paramOptions = paramKey ? PARAM_OPTIONS[paramKey] || talent.chosenParam?.options || [] : [];
    const firstAvailableParam =
      hasParam && paramKey
        ? paramOptions.find((option) => getParamRank(talent, option) < maxRank)
        : undefined;
    const status = hasParam && paramKey && firstAvailableParam
      ? getPrereqStatus(talent, { [paramKey]: firstAvailableParam })
      : getPrereqStatus(talent);
    const tierStyle = tierColors[talent.tier] || tierColors[1];
    const isMaxed = hasParam ? !firstAvailableParam : currentRank >= maxRank;

    // Check if acquired with params
    const acquiredForTalent = acquiredTalents.filter((t) => t.talentId === talent.id && t.params);
    const paramDisplay = acquiredForTalent.length
      ? acquiredForTalent
          .map((entry) => {
            const values = entry.params ? Object.values(entry.params).join(", ") : "";
            return entry.rank > 1 ? `${values} x${entry.rank}` : values;
          })
          .filter(Boolean)
          .join(", ")
      : null;

    return (
      <View
        key={talent.id}
        style={[
          styles.talentCard,
          { backgroundColor: tierStyle.bg, borderColor: tierStyle.border },
        ]}
      >
        {/* Header */}
        <View style={styles.talentHeader}>
          <View style={styles.talentTitleRow}>
            <Text style={[styles.talentName, { color: tierStyle.text }]} numberOfLines={1}>
              {talent.name}
              {paramDisplay ? ` (${paramDisplay})` : ""}
            </Text>
            <View style={[styles.tierBadge, { backgroundColor: tierStyle.badge }]}>
              <Text style={styles.tierText}>T{talent.tier}</Text>
            </View>
          </View>
        </View>

        {/* Description */}
        <Text style={styles.talentDescription} numberOfLines={3}>{talent.description}</Text>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Cost</Text>
            <Text style={styles.statValue}>{talent.xpCost} XP</Text>
          </View>
          {!hasParam && maxRank > 1 && (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Rank</Text>
              <Text style={styles.statValue}>{currentRank}/{maxRank}</Text>
            </View>
          )}
          {hasParam && (
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Specializations</Text>
              <Text style={styles.statValue}>{acquiredForTalent.length}</Text>
            </View>
          )}
        </View>

        {/* Prerequisites */}
        <View style={styles.prereqSection}>
          <Text style={styles.prereqLabel}>Prerequisites:</Text>
          <Text style={styles.prereqList}>{status.prereqList}</Text>
        </View>

        {/* Status / Buy Button */}
        {isMaxed ? (
          <View style={styles.acquiredBadge}>
            <Text style={styles.acquiredText}>✓ Acquired{maxRank > 1 ? ` (Max Rank)` : ""}</Text>
          </View>
        ) : (
          <View>
            {!status.canBuy && (
              <View style={styles.lockedReason}>
                <Text style={styles.lockedReasonText}>✗ {status.reason}</Text>
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.buyButton,
                !status.canBuy && styles.buyButtonDisabled,
                !applySystemEffects && styles.buyButtonDisabled,
              ]}
              disabled={!status.canBuy || !applySystemEffects}
              onPress={() => {
                if (hasParam) {
                  setSelectedTalent(talent);
                  setParamModalVisible(true);
                } else {
                  handleBuyTalent(talent);
                }
              }}
            >
              <Text style={[styles.buyButtonText, (!status.canBuy || !applySystemEffects) && styles.buyButtonTextDisabled]}>
                {!applySystemEffects ? "Effects unavailable" : hasParam ? "Select & Buy" : `Buy (${talent.xpCost} XP)`}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  };

  // Param selection modal
  const renderParamModal = () => {
    if (!selectedTalent?.chosenParam) return null;

    const paramKey = selectedTalent.chosenParam.paramKey;
    const options = PARAM_OPTIONS[paramKey] || selectedTalent.chosenParam.options || [];

    return (
      <Modal visible={paramModalVisible} transparent animationType="fade">
        <View style={styles.paramModalOverlay}>
          <View style={styles.paramModalContent}>
            <Text style={styles.paramModalTitle}>
              Select {selectedTalent.chosenParam.label || paramKey}
            </Text>
            <Text style={styles.paramModalSubtitle}>
              for {selectedTalent.name} ({selectedTalent.xpCost} XP)
            </Text>

            <ScrollView style={styles.paramOptionsList}>
              {options.map((optionValue) => {
                const currentParamRank = getParamRank(selectedTalent, optionValue);
                const canBuyWithParam = canAcquireTalent(save, catalogs, actor, selectedTalent, {
                  [paramKey]: optionValue,
                });
                const isMaxed = currentParamRank >= (selectedTalent.maxRank ?? 1);
                const isDisabled = isMaxed || !canBuyWithParam.canAcquire;

                const optionLabel = optionValue.charAt(0).toUpperCase() + optionValue.slice(1).toLowerCase();

                return (
                  <TouchableOpacity
                    key={optionValue}
                    style={[styles.paramOption, isDisabled && styles.paramOptionDisabled]}
                    disabled={isDisabled}
                    onPress={() => handleBuyTalent(selectedTalent, { [paramKey]: optionValue })}
                  >
                    <Text style={[styles.paramOptionText, isDisabled && styles.paramOptionTextDisabled]}>
                      {optionLabel}
                      {currentParamRank > 0 ? ` (Rank ${currentParamRank}/${selectedTalent.maxRank ?? 1})` : ""}
                    </Text>
                    {isMaxed && (
                      <Text style={styles.paramOptionTaken}>Max rank reached</Text>
                    )}
                    {!isMaxed && !canBuyWithParam.canAcquire && (
                      <Text style={styles.paramOptionTaken}>{canBuyWithParam.reason}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <TouchableOpacity
              style={styles.paramCancelButton}
              onPress={() => {
                setParamModalVisible(false);
                setSelectedTalent(null);
              }}
            >
              <Text style={styles.paramCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  };

  // Render owned talents list
  const renderOwnedTalents = () => {
    if (acquiredTalents.length === 0) {
      return <Text style={styles.noTalentsText}>No talents acquired yet</Text>;
    }

    return (
      <View style={styles.ownedTalentsList}>
        {acquiredTalents.map((t, idx) => {
          const talent = getTalentById(catalogs, t.talentId as TalentId);
          const maxRank = talent?.maxRank ?? 1;
          const paramStr = t.params ? Object.values(t.params).join(", ") : "";

          return (
            <View key={`${t.talentId}-${idx}`} style={styles.ownedTalentItem}>
              <Text style={styles.ownedTalentName}>
                {talent?.name || t.talentId}
                {paramStr ? ` (${paramStr})` : ""}
              </Text>
              {maxRank > 1 && (
                <Text style={styles.ownedTalentRank}>R{t.rank}/{maxRank}</Text>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  // Render category section
  const renderCategory = (categoryKey: string, talents: Talent[]) => {
    if (talents.length === 0) return null;
    const catStyle = categoryColors[categoryKey] || categoryColors.common;
    const categoryLabel = categoryKey.charAt(0).toUpperCase() + categoryKey.slice(1);

    return (
      <View key={categoryKey} style={styles.categorySection}>
        <View style={[styles.categoryHeader, { backgroundColor: catStyle.bg }]}>
          <Text style={[styles.categoryTitle, { color: catStyle.text }]}>{categoryLabel}</Text>
          <Text style={styles.categoryCount}>{talents.length} talents</Text>
        </View>
        {talents.map(renderTalentCard)}
      </View>
    );
  };

  if (!actor) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Header with actor info */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>Talent Shop</Text>
              <Text style={styles.actorName}>{actor.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Resources bar */}
          <View style={styles.resourcesBar}>
            <View style={styles.resourceItem}>
              <Text style={styles.resourceLabel}>XP</Text>
              <Text style={styles.resourceValueXp}>{currentXp}</Text>
            </View>
            <View style={styles.resourceItem}>
              <Text style={styles.resourceLabel}>Fate</Text>
              <Text style={styles.resourceValueFate}>{fatePoints}</Text>
            </View>
            
            {/* Dev helpers */}
            <View style={styles.devHelpers}>
              <TouchableOpacity 
                style={styles.devButton} 
                onPress={() => handleGrantXp(100)}
                disabled={!applySystemEffects}
              >
                <Text style={styles.devButtonText}>+100 XP</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={styles.devButton} 
                onPress={() => handleGrantXp(500)}
                disabled={!applySystemEffects}
              >
                <Text style={styles.devButtonText}>+500 XP</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.devButton, styles.devButtonFate]} 
                onPress={handleGrantFate}
                disabled={!applySystemEffects}
              >
                <Text style={styles.devButtonText}>+1 Fate</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Owned talents section */}
          <View style={styles.ownedSection}>
            <Text style={styles.sectionTitle}>Owned Talents</Text>
            {renderOwnedTalents()}
          </View>

          {/* Tier legend */}
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors[1].badge }]} />
              <Text style={styles.legendText}>Tier 1</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors[2].badge }]} />
              <Text style={styles.legendText}>Tier 2</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: tierColors[3].badge }]} />
              <Text style={styles.legendText}>Tier 3</Text>
            </View>
          </View>

          {/* Tier tabs */}
          <View style={styles.tierTabs}>
            {[1, 2, 3].map((tier) => (
              <TouchableOpacity
                key={`tier-${tier}`}
                style={[
                  styles.tierTab,
                  activeTier === tier && styles.tierTabActive,
                  { borderColor: tierColors[tier].border },
                ]}
                onPress={() => setActiveTier(tier as 1 | 2 | 3)}
              >
                <Text style={[styles.tierTabText, activeTier === tier && styles.tierTabTextActive]}>
                  Tier {tier}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Main content - talents by category */}
          <ScrollView 
            style={styles.talentsList} 
            contentContainerStyle={styles.talentsListContent}
            showsVerticalScrollIndicator={true}
          >
            {renderCategory("common", filteredTalentsByCategory.common)}
            {renderCategory("fighter", filteredTalentsByCategory.fighter)}
            {renderCategory("archer", filteredTalentsByCategory.archer)}
            {renderCategory("mage", filteredTalentsByCategory.mage)}
            {renderCategory("martial", filteredTalentsByCategory.martial)}
          </ScrollView>
        </View>
      </View>

      {renderParamModal()}
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    width: "96%",
    maxWidth: 700,
    height: "92%",
    backgroundColor: "#0f0f1a",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2d2d44",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: 16,
    backgroundColor: "#1a1a2e",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#f0f0ff",
    letterSpacing: 0.5,
  },
  actorName: {
    fontSize: 14,
    color: "#a0a0c0",
    marginTop: 2,
  },
  closeButton: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#2d2d44",
    borderRadius: 20,
  },
  closeButtonText: {
    fontSize: 22,
    color: "#f0f0ff",
  },
  resourcesBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#151525",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
    gap: 16,
  },
  resourceItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  resourceLabel: {
    fontSize: 13,
    color: "#888",
    fontWeight: "600",
  },
  resourceValueXp: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#facc15",
  },
  resourceValueFate: {
    fontSize: 18,
    fontWeight: "bold",
    color: "#60a5fa",
  },
  devHelpers: {
    flexDirection: "row",
    gap: 8,
    marginLeft: "auto",
  },
  devButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "#374151",
    borderRadius: 6,
  },
  devButtonFate: {
    backgroundColor: "#1e40af",
  },
  devButtonText: {
    fontSize: 11,
    color: "#fff",
    fontWeight: "600",
  },
  ownedSection: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#12121f",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
    maxHeight: 120,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#a0a0c0",
    marginBottom: 8,
  },
  noTalentsText: {
    fontSize: 13,
    color: "#666",
    fontStyle: "italic",
  },
  ownedTalentsList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  ownedTalentItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e3a5f",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    gap: 6,
  },
  ownedTalentName: {
    fontSize: 12,
    color: "#93c5fd",
    fontWeight: "500",
  },
  ownedTalentRank: {
    fontSize: 11,
    color: "#60a5fa",
    fontWeight: "700",
  },
  legend: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 20,
    paddingVertical: 10,
    backgroundColor: "#0f0f1a",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  tierTabs: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
    backgroundColor: "#0f0f1a",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  tierTab: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    backgroundColor: "#151525",
  },
  tierTabActive: {
    backgroundColor: "#1f2937",
  },
  tierTabText: {
    fontSize: 12,
    color: "#a0a0c0",
    fontWeight: "600",
  },
  tierTabTextActive: {
    color: "#f0f0ff",
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  legendText: {
    fontSize: 12,
    color: "#888",
  },
  talentsList: {
    flex: 1,
  },
  talentsListContent: {
    padding: 12,
    paddingBottom: 24,
  },
  categorySection: {
    marginBottom: 20,
  },
  categoryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 12,
  },
  categoryTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  categoryCount: {
    fontSize: 12,
    color: "#888",
  },
  talentCard: {
    marginBottom: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 2,
  },
  talentHeader: {
    marginBottom: 8,
  },
  talentTitleRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  talentName: {
    fontSize: 15,
    fontWeight: "700",
    flex: 1,
  },
  tierBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  tierText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
  },
  talentDescription: {
    fontSize: 12,
    color: "#a0a0b0",
    lineHeight: 18,
    marginBottom: 10,
  },
  statsRow: {
    flexDirection: "row",
    gap: 20,
    marginBottom: 8,
  },
  statItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statLabel: {
    fontSize: 11,
    color: "#888",
    fontWeight: "500",
  },
  statValue: {
    fontSize: 13,
    fontWeight: "700",
    color: "#e0e0ff",
  },
  prereqSection: {
    marginBottom: 10,
  },
  prereqLabel: {
    fontSize: 11,
    color: "#888",
    fontWeight: "600",
    marginBottom: 2,
  },
  prereqList: {
    fontSize: 11,
    color: "#a0a0c0",
  },
  lockedReason: {
    backgroundColor: "rgba(220, 38, 38, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 8,
  },
  lockedReasonText: {
    fontSize: 12,
    color: "#fca5a5",
    fontWeight: "500",
  },
  buyButton: {
    backgroundColor: "#3b82f6",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
  },
  buyButtonDisabled: {
    backgroundColor: "#374151",
  },
  buyButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  buyButtonTextDisabled: {
    color: "#6b7280",
  },
  acquiredBadge: {
    backgroundColor: "rgba(34, 197, 94, 0.2)",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(34, 197, 94, 0.4)",
  },
  acquiredText: {
    color: "#86efac",
    fontWeight: "700",
    fontSize: 14,
  },
  // Param Modal Styles
  paramModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  paramModalContent: {
    width: "85%",
    maxWidth: 420,
    backgroundColor: "#1a1a2e",
    borderRadius: 16,
    padding: 20,
    maxHeight: "75%",
    borderWidth: 1,
    borderColor: "#3b82f6",
  },
  paramModalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: "#f0f0ff",
    textAlign: "center",
  },
  paramModalSubtitle: {
    fontSize: 14,
    color: "#a0a0c0",
    textAlign: "center",
    marginTop: 4,
    marginBottom: 20,
  },
  paramOptionsList: {
    maxHeight: 320,
  },
  paramOption: {
    padding: 16,
    backgroundColor: "#2d2d44",
    borderRadius: 10,
    marginBottom: 10,
  },
  paramOptionDisabled: {
    opacity: 0.5,
    backgroundColor: "#1f1f30",
  },
  paramOptionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#f0f0ff",
  },
  paramOptionTextDisabled: {
    color: "#666",
  },
  paramOptionTaken: {
    fontSize: 12,
    color: "#f87171",
    marginTop: 4,
  },
  paramCancelButton: {
    marginTop: 16,
    padding: 14,
    backgroundColor: "#374151",
    borderRadius: 10,
    alignItems: "center",
  },
  paramCancelText: {
    color: "#f0f0ff",
    fontWeight: "600",
    fontSize: 15,
  },
});
