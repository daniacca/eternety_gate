import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import type { GameSave, ActorId } from "@eg/engine";
import { getLearnedSpells, getAllSpells, canLearnSpell, learnSpell, loadCharacterCatalogs } from "@eg/engine";
import sigilContent from "@eg/content/sigil.content.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";
import { useState } from "react";
import type { TargetSpec, Direction9 } from "@eg/engine";

interface SpellPickerModalProps {
  visible: boolean;
  save: GameSave;
  actorId: ActorId;
  onClose: () => void;
  onSelectSpell: (spellId: string, targetSpec: TargetSpec) => void;
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

  // State for direction picker (for cone/line spells)
  const [selectedSpellId, setSelectedSpellId] = useState<string | null>(null);
  const [selectedDir, setSelectedDir] = useState<Direction9>(8); // Default to North

  const directionLabels: Record<Direction9, string> = {
    7: "↖",
    8: "↑",
    9: "↗",
    4: "←",
    6: "→",
    1: "↙",
    2: "↓",
    3: "↘",
  };

  const directionNames: Record<Direction9, string> = {
    7: "NW",
    8: "N",
    9: "NE",
    4: "W",
    6: "E",
    1: "SW",
    2: "S",
    3: "SE",
  };

  const handleSpellSelect = (spellId: string) => {
    const spell = allSpells.find((s) => s.id === spellId);
    if (!spell) return;

    // For cone/line spells, show direction picker first
    if (spell.targetShape === "cone" || spell.targetShape === "line") {
      setSelectedSpellId(spellId);
      return;
    }

    // For other spells, proceed directly
    let targetSpec: TargetSpec;
    if (spell.targetShape === "self") {
      targetSpec = { kind: "self" };
    } else if (spell.targetShape === "single" && selectedTargetId) {
      targetSpec = { kind: "actor", actorId: selectedTargetId as ActorId };
    } else if (spell.targetShape === "radius" && selectedTargetId) {
      // For radius, use actor position
      targetSpec = { kind: "actor", actorId: selectedTargetId as ActorId };
    } else {
      // Fallback to self
      targetSpec = { kind: "self" };
    }
    onSelectSpell(spellId, targetSpec);
    onClose();
  };

  const handleDirectionConfirm = () => {
    if (!selectedSpellId) return;
    const targetSpec: TargetSpec = { kind: "direction", dir: selectedDir };
    onSelectSpell(selectedSpellId, targetSpec);
    setSelectedSpellId(null);
    setSelectedDir(8); // Reset to default
    onClose();
  };

  const handleDirectionCancel = () => {
    setSelectedSpellId(null);
    setSelectedDir(8); // Reset to default
  };

  const handleLearnSpell = (spellId: string) => {
    if (onLearnSpell) {
      onLearnSpell(spellId);
    }
  };

  // Show direction picker if a cone/line spell is selected
  if (selectedSpellId) {
    const spell = allSpells.find((s) => s.id === selectedSpellId);
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={handleDirectionCancel}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", alignItems: "center" }}>
          <View style={{ backgroundColor: "#fff", padding: 20, borderRadius: 8, maxWidth: "90%" }}>
            <Text style={{ fontSize: 18, fontWeight: "600", marginBottom: 8 }}>
              Seleziona Direzione: {spell?.name}
            </Text>
            <Text style={{ fontSize: 12, color: "#666", marginBottom: 16 }}>
              Direzione selezionata: {directionNames[selectedDir]}
            </Text>

            {/* Direction pad (3x3 grid) */}
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <View style={{ flexDirection: "row", gap: 4 }}>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 7 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(7)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[7]}</Text>
                </Pressable>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 8 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(8)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[8]}</Text>
                </Pressable>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 9 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(9)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[9]}</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 4 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(4)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[4]}</Text>
                </Pressable>
                <View
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: "#e0e0e0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                >
                  <Text style={{ fontSize: 12, color: "#999" }}>—</Text>
                </View>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 6 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(6)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[6]}</Text>
                </Pressable>
              </View>
              <View style={{ flexDirection: "row", gap: 4, marginTop: 4 }}>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 1 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(1)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[1]}</Text>
                </Pressable>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 2 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(2)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[2]}</Text>
                </Pressable>
                <Pressable
                  style={{
                    width: 50,
                    height: 50,
                    backgroundColor: selectedDir === 3 ? "#4a90e2" : "#f0f0f0",
                    borderRadius: 4,
                    justifyContent: "center",
                    alignItems: "center",
                    borderWidth: 1,
                    borderColor: "#ddd",
                  }}
                  onPress={() => setSelectedDir(3)}
                >
                  <Text style={{ fontSize: 20 }}>{directionLabels[3]}</Text>
                </Pressable>
              </View>
            </View>

            <View style={{ flexDirection: "row", gap: 8 }}>
              <Pressable
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: "#666",
                  borderRadius: 4,
                  alignItems: "center",
                }}
                onPress={handleDirectionCancel}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Annulla</Text>
              </Pressable>
              <Pressable
                style={{
                  flex: 1,
                  padding: 12,
                  backgroundColor: "#4a90e2",
                  borderRadius: 4,
                  alignItems: "center",
                }}
                onPress={handleDirectionConfirm}
              >
                <Text style={{ color: "#fff", fontSize: 14, fontWeight: "600" }}>Conferma</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    );
  }

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
                    {(spell.targetShape === "cone" || spell.targetShape === "line") && (
                      <Text style={{ fontSize: 10, color: "#4a90e2", marginTop: 4 }}>
                        Richiede selezione direzione
                      </Text>
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

