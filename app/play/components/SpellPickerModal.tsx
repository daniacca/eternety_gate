import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import type { GameSave, ActorId } from "@eg/engine";
import { getLearnedSpells, getAllSpells, canLearnSpell, learnSpell, loadCharacterCatalogs } from "@eg/engine";
import sigilContent from "@eg/content/sigil.content.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";
import { useState } from "react";

interface SpellPickerModalProps {
  visible: boolean;
  save: GameSave;
  actorId: ActorId;
  onClose: () => void;
  onSelectSpell: (spellId: string, targetSpec: { type: "self" | "actor" | "position"; actorId?: string }) => void;
  selectedTargetId?: string | null;
  showLearnSpells?: boolean;
  onLearnSpell?: (spellId: string) => void;
}

export function SpellPickerModal({
  visible,
  save,
  actorId,
  onClose,
  onSelectSpell,
  selectedTargetId,
  showLearnSpells = false,
  onLearnSpell,
}: SpellPickerModalProps) {
  const catalogs = loadCharacterCatalogs({
    ...sigilContent,
    skills: skillsCatalog as any,
    talents: talentsCatalog as any,
    traits: traitsCatalog as any,
  } as any);

  const learnedSpells = getLearnedSpells(save, actorId, catalogs);
  const allSpells = getAllSpells();
  const actor = save.actorsById[actorId];
  const currentXp = save.meta?.xp ?? 0;

  const handleSpellSelect = (spellId: string) => {
    const spell = allSpells.find((s) => s.id === spellId);
    if (!spell) return;

    if (spell.targetShape === "self") {
      onSelectSpell(spellId, { type: "self" });
    } else if (spell.targetShape === "single" && selectedTargetId) {
      onSelectSpell(spellId, { type: "actor", actorId: selectedTargetId });
    } else {
      // For MVP: default to selected target or self
      onSelectSpell(spellId, { type: selectedTargetId ? "actor" : "self", actorId: selectedTargetId || undefined });
    }
    onClose();
  };

  const handleLearnSpell = (spellId: string) => {
    if (onLearnSpell) {
      onLearnSpell(spellId);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" }}>
        <View style={{ backgroundColor: "#fff", padding: 20, borderRadius: 8, maxWidth: "90%", maxHeight: "80%" }}>
          <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 16 }}>Seleziona Incantesimo</Text>

          {showLearnSpells ? (
            <ScrollView style={{ maxHeight: 400 }}>
              <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 8 }}>Tutti gli Incantesimi</Text>
              {allSpells.map((spell) => {
                const isLearned = learnedSpells.some((s) => s.id === spell.id);
                const canLearn = canLearnSpell(save, catalogs, actorId, spell.id);
                const xpCost = spell.xpCost || 0;

                return (
                  <View key={spell.id} style={{ marginBottom: 12, padding: 8, borderWidth: 1, borderColor: "#ddd", borderRadius: 4 }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>{spell.name}</Text>
                        <Text style={{ fontSize: 12, color: "#666" }}>{spell.discipline} - CN: {spell.baseCN}</Text>
                        <Text style={{ fontSize: 11, color: "#888" }}>{spell.notes}</Text>
                        {isLearned ? (
                          <Text style={{ fontSize: 11, color: "#4a90e2", marginTop: 4 }}>✓ Imparato</Text>
                        ) : (
                          <View style={{ marginTop: 4 }}>
                            <Text style={{ fontSize: 11, color: "#666" }}>Costo: {xpCost} XP</Text>
                            {!canLearn.canLearn && (
                              <Text style={{ fontSize: 10, color: "#ff6b6b" }}>{canLearn.reason}</Text>
                            )}
                          </View>
                        )}
                      </View>
                      {!isLearned && canLearn.canLearn && (
                        <Pressable
                          style={{
                            backgroundColor: "#4a90e2",
                            paddingHorizontal: 12,
                            paddingVertical: 6,
                            borderRadius: 4,
                            marginLeft: 8,
                          }}
                          onPress={() => handleLearnSpell(spell.id)}
                        >
                          <Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>Impara</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                );
              })}
              <Text style={{ fontSize: 12, marginTop: 16, color: "#666" }}>XP disponibili: {currentXp}</Text>
            </ScrollView>
          ) : (
            <ScrollView style={{ maxHeight: 400 }}>
              {learnedSpells.length === 0 ? (
                <Text style={{ fontSize: 14, color: "#666", textAlign: "center", padding: 20 }}>
                  Nessun incantesimo imparato. Impara gli incantesimi dalla scheda personaggio.
                </Text>
              ) : (
                learnedSpells.map((spell) => (
                  <Pressable
                    key={spell.id}
                    style={{
                      padding: 12,
                      marginBottom: 8,
                      backgroundColor: "#f0f0f0",
                      borderRadius: 4,
                      borderWidth: 1,
                      borderColor: "#ddd",
                    }}
                    onPress={() => handleSpellSelect(spell.id)}
                  >
                    <Text style={{ fontSize: 14, fontWeight: "600" }}>{spell.name}</Text>
                    <Text style={{ fontSize: 12, color: "#666" }}>
                      {spell.discipline} - CN: {spell.baseCN} - {spell.castTime}
                    </Text>
                    <Text style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{spell.notes}</Text>
                    {spell.targetShape === "single" && !selectedTargetId && (
                      <Text style={{ fontSize: 10, color: "#ff6b6b", marginTop: 4 }}>Seleziona un bersaglio</Text>
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          )}

          <Pressable
            style={{
              marginTop: 16,
              padding: 12,
              backgroundColor: "#666",
              borderRadius: 4,
              alignItems: "center",
            }}
            onPress={onClose}
          >
            <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Chiudi</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

