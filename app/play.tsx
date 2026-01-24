import { useEffect, useState } from "react";
import { View, Text, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { GameSave } from "@eg/engine";
import { createNewGame } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";
import { PlayScreen } from "../src/play/PlayScreen";
import { getSaveSlot, upsertSaveSlot, type SaveSlot } from "../src/storage/gameSaves";
import { getStoryPackById } from "../src/storypacks";
import { createDebugSave } from "../src/play/utils/createDebugSave";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; slot: SaveSlot; save: GameSave };

export default function PlayRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ saveId?: string; debug?: string }>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [storyId, setStoryId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (params.debug === "1") {
        const debugSave = createDebugSave();
        setState({
          status: "ready",
          slot: {
            id: "debug",
            name: "Debug",
            createdAt: debugSave.createdAt ?? new Date().toISOString(),
            updatedAt: debugSave.createdAt ?? new Date().toISOString(),
            save: debugSave,
          },
          save: debugSave,
        });
        setStoryId(debugSave.story.id);
        return;
      }

      if (!params.saveId || Array.isArray(params.saveId)) {
        setState({ status: "error", message: "Missing save id." });
        return;
      }
      const slot = await getSaveSlot(params.saveId);
      if (!slot) {
        setState({ status: "error", message: "Save slot not found." });
        return;
      }
      setState({ status: "ready", slot, save: slot.save });
      setStoryId(slot.save.story.id);
    };
    load();
  }, [params.saveId, params.debug]);

  const handleAutosave = async (save: GameSave, reasons: string[]) => {
    if (state.status !== "ready") return;
    const updated = await upsertSaveSlot({
      ...state.slot,
      save,
    });
    const nextSlot = updated.find((entry) => entry.id === state.slot.id);
    if (nextSlot) {
      setState({ status: "ready", slot: nextSlot, save });
    }
  };

  const handleStorySwitch = async (nextStoryId: string, currentSave: GameSave) => {
    const nextPack = getStoryPackById(nextStoryId);
    if (!nextPack) return;
    const newSave = createNewGame(
      nextPack,
      currentSave.runtime.rngSeed,
      currentSave.party,
      currentSave.actorsById,
      sigilContentPack as any
    );
    if (state.status === "ready") {
      const updated = await upsertSaveSlot({ ...state.slot, save: newSave });
      const nextSlot = updated.find((entry) => entry.id === state.slot.id);
      if (nextSlot) {
        setState({ status: "ready", slot: nextSlot, save: newSave });
      }
      setStoryId(newSave.story.id);
    }
  };

  const handleReturnToHub = async (currentSave: GameSave) => {
    await handleStorySwitch("sigil_hub", currentSave);
  };

  if (state.status === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2563eb" />
        <Text style={styles.loadingText}>Loading...</Text>
      </View>
    );
  }

  if (state.status === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{state.message}</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace("/")}>
          <Text style={styles.primaryButtonText}>Back to Menu</Text>
        </Pressable>
      </View>
    );
  }

  const storyPack = storyId ? getStoryPackById(storyId) : null;
  if (!storyPack) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>Story pack not found.</Text>
        <Pressable style={styles.primaryButton} onPress={() => router.replace("/")}>
          <Text style={styles.primaryButtonText}>Back to Menu</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <PlayScreen
      initialSave={state.save}
      storyPack={storyPack}
      contentPack={sigilContentPack as any}
      onAutosave={handleAutosave}
      onStorySwitch={handleStorySwitch}
      onReturnToHub={handleReturnToHub}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 12,
    backgroundColor: "#0f172a",
  },
  loadingText: {
    color: "#94a3b8",
  },
  errorText: {
    color: "#f87171",
    fontSize: 16,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 8,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
});
