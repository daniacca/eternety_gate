import { View, Text, Pressable, Modal, ScrollView } from "react-native";
import type { GameSave, ActorId } from "@eg/engine";
import { getLearnedSpells, getAllSpells, canLearnSpell, loadCharacterCatalogs } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";

interface SpellPickerModalProps {
  visible: boolean;
  save: GameSave;
  actorId: ActorId;
  onClose: () => void;
  onSelectSpell: (spellId: string) => void;
  showLearnSpells?: boolean;
  onLearnSpell?: (spellId: string) => void;
  actionAvailable?: boolean;
}

export function SpellPickerModal({
  visible,
  save,
  actorId,
  onClose,
  onSelectSpell,
  showLearnSpells = false,
  onLearnSpell,
  actionAvailable = true,
}: SpellPickerModalProps) {
  const catalogs = loadCharacterCatalogs(sigilContentPack as any);

  const actor = save.actorsById[actorId];
  const learnedSpells = getLearnedSpells(save, actorId, catalogs);
  const allSpells = getAllSpells();
  const currentXp = actor?.resources.xp ?? 0;
  const combat = save.runtime.combat;
  const freeSpellUsedThisTurn = combat?.freeSpellUsedThisTurn?.[actorId] ?? false;

  // Helper to get cast time label
  const getCastTimeLabel = (castTime: string): string => {
    if (castTime === "free") return "Gratuito";
    if (castTime === "standard") return "Standard";
    if (castTime === "fullRound") return "Round Completo";
    return castTime;
  };

  // Helper to check if spell can be cast
  const canCastSpell = (spell: any): { canCast: boolean; reason?: string } => {
    if (spell.castTime === "free") {
      if (freeSpellUsedThisTurn) {
        return { canCast: false, reason: "Incantesimo gratuito già usato questo turno" };
      }
      return { canCast: true };
    } else {
      // Standard or Full Round: requires action
      if (!actionAvailable) {
        return { canCast: false, reason: "Azione già consumata" };
      }
      return { canCast: true };
    }
  };

  const handleSpellSelect = (spellId: string) => {
    onSelectSpell(spellId);
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
              <Text style={{ fontSize: 14, fontWeight: "600", marginBottom: 8, marginTop: 8 }}>
                Tutti gli Incantesimi
              </Text>
              {allSpells.map((spell) => {
                const isLearned = learnedSpells.some((s) => s.id === spell.id);
                const canLearn = canLearnSpell(save, catalogs, actorId, spell.id);
                const xpCost = spell.xpCost || 0;

                return (
                  <View
                    key={spell.id}
                    style={{ marginBottom: 12, padding: 8, borderWidth: 1, borderColor: "#ddd", borderRadius: 4 }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 14, fontWeight: "600" }}>{spell.name}</Text>
                        <Text style={{ fontSize: 12, color: "#666" }}>
                          {spell.discipline} - CN: {spell.baseCN}
                        </Text>
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
                learnedSpells.map((spell) => {
                  const castCheck = canCastSpell(spell);
                  const castTimeLabel = getCastTimeLabel(spell.castTime);

                  return (
                    <Pressable
                      key={spell.id}
                      style={{
                        padding: 12,
                        marginBottom: 8,
                        backgroundColor: castCheck.canCast ? "#f0f0f0" : "#e0e0e0",
                        borderRadius: 4,
                        borderWidth: 1,
                        borderColor: castCheck.canCast ? "#ddd" : "#bbb",
                        opacity: castCheck.canCast ? 1 : 0.6,
                      }}
                      onPress={() => castCheck.canCast && handleSpellSelect(spell.id)}
                      disabled={!castCheck.canCast}
                    >
                      <Text style={{ fontSize: 14, fontWeight: "600" }}>{spell.name}</Text>
                      <Text style={{ fontSize: 12, color: "#666" }}>
                        {spell.discipline} - CN: {spell.baseCN} - {castTimeLabel}
                      </Text>
                      {spell.castTime === "fullRound" && (
                        <Text style={{ fontSize: 10, color: "#ff6b6b", marginTop: 2 }}>
                          Consuma l'intero round (azione + movimento)
                        </Text>
                      )}
                      <Text style={{ fontSize: 11, color: "#888", marginTop: 4 }}>{spell.notes}</Text>
                      {!castCheck.canCast && castCheck.reason && (
                        <Text style={{ fontSize: 10, color: "#ff6b6b", marginTop: 4 }}>{castCheck.reason}</Text>
                      )}
                      {(spell.targetShape === "cone" ||
                        spell.targetShape === "line" ||
                        spell.targetShape === "radius") &&
                        castCheck.canCast && (
                          <Text style={{ fontSize: 10, color: "#4a90e2", marginTop: 4 }}>Richiede targeting</Text>
                        )}
                    </Pressable>
                  );
                })
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
