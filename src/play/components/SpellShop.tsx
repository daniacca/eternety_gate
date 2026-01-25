import { useMemo, useState } from "react";
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet } from "react-native";
import type { GameSave, Actor, Effect } from "@eg/engine";
import { canLearnSpell, getAllSpells, getLearnedSpells, loadCharacterCatalogs } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";

interface SpellShopProps {
  visible: boolean;
  save: GameSave;
  actor: Actor;
  onClose: () => void;
  applySystemEffects?: (effects: Effect[]) => void;
}

export function SpellShop({ visible, save, actor, onClose, applySystemEffects }: SpellShopProps) {
  const catalogs = useMemo(() => loadCharacterCatalogs(sigilContentPack as any), []);
  const allSpells = useMemo(() => getAllSpells(), []);
  const learnedSpells = useMemo(() => getLearnedSpells(save, actor.id, catalogs), [save, actor.id, catalogs]);
  const currentXp = actor.resources.xp ?? 0;

  const disciplines = useMemo(() => {
    const values = Array.from(new Set(allSpells.map((spell) => spell.discipline)));
    return values.sort();
  }, [allSpells]);

  const [activeDiscipline, setActiveDiscipline] = useState<string>(disciplines[0] ?? "PYRA");

  const spellsByDiscipline = useMemo(() => {
    const grouped: Record<string, typeof allSpells> = {};
    for (const spell of allSpells) {
      grouped[spell.discipline] = grouped[spell.discipline] || [];
      grouped[spell.discipline].push(spell);
    }
    for (const discipline of Object.keys(grouped)) {
      grouped[discipline].sort((a, b) => a.name.localeCompare(b.name));
    }
    return grouped;
  }, [allSpells]);

  const handleLearnSpell = (spellId: string) => {
    if (!applySystemEffects) return;
    applySystemEffects([{ op: "learnSpell", actorId: actor.id, spellId }]);
  };

  if (!actor) return null;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.header}>
            <View>
              <Text style={styles.title}>Spell Shop</Text>
              <Text style={styles.subTitle}>{actor.name}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.resourcesBar}>
            <Text style={styles.resourceLabel}>XP:</Text>
            <Text style={styles.resourceValue}>{currentXp}</Text>
            <Text style={styles.resourceLabel}>Learned:</Text>
            <Text style={styles.resourceValue}>{learnedSpells.length}</Text>
          </View>

          <View style={styles.tabs}>
            {disciplines.map((discipline) => (
              <TouchableOpacity
                key={discipline}
                style={[styles.tab, activeDiscipline === discipline && styles.tabActive]}
                onPress={() => setActiveDiscipline(discipline)}
              >
                <Text style={[styles.tabText, activeDiscipline === discipline && styles.tabTextActive]}>
                  {discipline}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            {(spellsByDiscipline[activeDiscipline] || []).map((spell) => {
              const isLearned = learnedSpells.some((entry) => entry.id === spell.id);
              const canLearnResult = canLearnSpell(save, catalogs, actor.id, spell.id);

              return (
                <View key={spell.id} style={[styles.card, isLearned && styles.cardLearned]}>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.cardTitle}>{spell.name}</Text>
                      <Text style={styles.cardMeta}>
                        CN {spell.baseCN} • {spell.rangeMode} • {spell.targetShape}
                      </Text>
                      <Text style={styles.cardNotes}>{spell.notes}</Text>
                    </View>
                    <View style={styles.cardActions}>
                      {isLearned ? (
                        <Text style={styles.learnedBadge}>✓ Learned</Text>
                      ) : (
                        <TouchableOpacity
                          style={[
                            styles.buyButton,
                            (!applySystemEffects || !canLearnResult.canLearn) && styles.buyButtonDisabled,
                          ]}
                          disabled={!applySystemEffects || !canLearnResult.canLearn}
                          onPress={() => handleLearnSpell(spell.id)}
                        >
                          <Text style={styles.buyButtonText}>Learn</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                  {!isLearned && (
                    <View style={styles.cardFooter}>
                      <Text style={styles.costLabel}>Cost: {spell.xpCost} XP</Text>
                      {!canLearnResult.canLearn && (
                        <Text style={styles.reasonText}>{canLearnResult.reason}</Text>
                      )}
                    </View>
                  )}
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
    alignItems: "center",
    padding: 16,
    backgroundColor: "#1a1a2e",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#f0f0ff",
  },
  subTitle: {
    fontSize: 13,
    color: "#a0a0c0",
    marginTop: 4,
  },
  closeButton: {
    width: 36,
    height: 36,
    justifyContent: "center",
    alignItems: "center",
    borderRadius: 18,
    backgroundColor: "#2d2d44",
  },
  closeButtonText: {
    fontSize: 20,
    color: "#f0f0ff",
  },
  resourcesBar: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "#151525",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
    alignItems: "center",
  },
  resourceLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  resourceValue: {
    fontSize: 14,
    color: "#facc15",
    fontWeight: "700",
    marginRight: 10,
  },
  tabs: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 10,
    backgroundColor: "#0f0f1a",
    borderBottomWidth: 1,
    borderBottomColor: "#2d2d44",
    flexWrap: "wrap",
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
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
  },
  card: {
    backgroundColor: "#12121f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2d2d44",
    padding: 12,
    marginBottom: 12,
  },
  cardLearned: {
    borderColor: "#2e7d32",
    backgroundColor: "rgba(34, 197, 94, 0.12)",
  },
  cardHeader: {
    flexDirection: "row",
    gap: 10,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#f8fafc",
  },
  cardMeta: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 2,
  },
  cardNotes: {
    fontSize: 11,
    color: "#9ca3af",
    marginTop: 6,
  },
  cardActions: {
    alignItems: "flex-end",
    justifyContent: "center",
  },
  learnedBadge: {
    color: "#86efac",
    fontWeight: "700",
  },
  buyButton: {
    backgroundColor: "#3b82f6",
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
  },
  buyButtonDisabled: {
    backgroundColor: "#374151",
  },
  buyButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 12,
  },
  cardFooter: {
    marginTop: 8,
  },
  costLabel: {
    fontSize: 11,
    color: "#facc15",
  },
  reasonText: {
    fontSize: 11,
    color: "#f87171",
    marginTop: 4,
  },
});
