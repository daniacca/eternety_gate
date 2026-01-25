import { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert, Platform } from "react-native";
import { useRouter } from "expo-router";
import { loadSaveSlots, deleteSaveSlot, type SaveSlot } from "../src/storage/gameSaves";

type MenuMode = "main" | "continue" | "reset";

export default function HomeScreen() {
  const router = useRouter();
  const [mode, setMode] = useState<MenuMode>("main");
  const [slots, setSlots] = useState<SaveSlot[]>([]);

  const refreshSlots = useCallback(async () => {
    const loaded = await loadSaveSlots();
    setSlots(loaded);
  }, []);

  useEffect(() => {
    refreshSlots();
  }, [refreshSlots]);

  useEffect(() => {
    if (mode !== "main") {
      refreshSlots();
    }
  }, [mode, refreshSlots]);

  const handleDeleteSlot = (slotId: string) => {
    const deleteSlot = async () => {
      const next = await deleteSaveSlot(slotId);
      setSlots(next);
    };

    if (Platform.OS === "web") {
      const confirmed = window.confirm("Delete this save slot?");
      if (confirmed) {
        void deleteSlot();
      }
      return;
    }

    Alert.alert("Reset Save", "Delete this save slot?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void deleteSlot();
        },
      },
    ]);
  };

  const renderSlot = (slot: SaveSlot, actionLabel: string, onPress: () => void) => (
    <Pressable key={slot.id} style={styles.slotCard} onPress={onPress}>
      <Text style={styles.slotName}>{slot.name}</Text>
      <Text style={styles.slotMeta}>Story: {slot.save.story.id}</Text>
      <Text style={styles.slotMeta}>Last updated: {new Date(slot.updatedAt).toLocaleString()}</Text>
      <View style={styles.slotAction}>
        <Text style={styles.slotActionText}>{actionLabel}</Text>
      </View>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Eternity Gate</Text>

      {mode === "main" && (
        <View style={styles.section}>
          <Pressable style={styles.primaryButton} onPress={() => router.push("/wizard")}>
            <Text style={styles.primaryButtonText}>New Game</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setMode("continue")}>
            <Text style={styles.secondaryButtonText}>Continue</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={() => setMode("reset")}>
            <Text style={styles.secondaryButtonText}>Reset Save</Text>
          </Pressable>

          <View style={styles.debugSection}>
            <Text style={styles.debugTitle}>Debug</Text>
            <Pressable style={styles.debugButton} onPress={() => router.push("/play?debug=1")}>
              <Text style={styles.debugButtonText}>Open Debug Play</Text>
            </Pressable>
          </View>
        </View>
      )}

      {mode === "continue" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select a save</Text>
          {slots.length === 0 ? (
            <Text style={styles.emptyText}>No saves available.</Text>
          ) : (
            slots.map((slot) =>
              renderSlot(slot, "Load", () => router.push(`/play?saveId=${slot.id}`))
            )
          )}
          <Pressable style={styles.secondaryButton} onPress={() => setMode("main")}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
        </View>
      )}

      {mode === "reset" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select a save to delete</Text>
          {slots.length === 0 ? (
            <Text style={styles.emptyText}>No saves available.</Text>
          ) : (
            slots.map((slot) => renderSlot(slot, "Delete", () => handleDeleteSlot(slot.id)))
          )}
          <Pressable style={styles.secondaryButton} onPress={() => setMode("main")}>
            <Text style={styles.secondaryButtonText}>Back</Text>
          </Pressable>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 16,
    backgroundColor: "#0f172a",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    marginBottom: 12,
    color: "#f8fafc",
  },
  section: {
    width: "100%",
    maxWidth: 420,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f1f5f9",
    marginBottom: 4,
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: "center",
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  secondaryButton: {
    backgroundColor: "#1e293b",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "600",
  },
  slotCard: {
    backgroundColor: "#111827",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  slotName: {
    fontSize: 16,
    fontWeight: "700",
    color: "#f8fafc",
  },
  slotMeta: {
    fontSize: 12,
    color: "#94a3b8",
    marginTop: 4,
  },
  slotAction: {
    marginTop: 10,
    alignSelf: "flex-start",
    backgroundColor: "#2563eb",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  slotActionText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  emptyText: {
    color: "#94a3b8",
    fontSize: 14,
  },
  debugSection: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#0b1220",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  debugTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: "#94a3b8",
    marginBottom: 8,
  },
  debugButton: {
    backgroundColor: "#7c3aed",
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
  },
  debugButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
});

