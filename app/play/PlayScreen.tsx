import { useState, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
  type GameSave,
  type StoryPack,
  type ContentPack,
} from "@eg/engine";
import brunholt from "../../stories/brunholt.story.json";
import sigilContent from "@eg/content/sigil.content.json";
import { CombatGrid } from "./components/CombatGrid";
import { CombatControl } from "./components/CombatControl";
import { CombatNarration } from "./components/CombatNarration";
import { ChoiceList } from "./components/ChoiceList";
import { DebugPanels } from "./components/DebugPanels";
import { useCombatUiModel } from "./hooks/useCombatUiModel";

export function PlayScreen() {
  // Create a minimal 1-player party with fixed seed
  const initialSave = useMemo(() => {
    const minimalActor = {
      id: "PC_1",
      name: "Player",
      kind: "PC" as const,
      tags: [],
      stats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 50,
        CHA: 50,
        WS: 50,
        BS: 50,
        INI: 50,
        PER: 50,
      },
      resources: { hp: 100, rf: 100, peq: 100 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        weaponId: "shortbow", // Test weapon: ranged
        armorId: null, // No armor for player initially
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    const party = {
      actors: ["PC_1"],
      activeActorId: "PC_1",
    };

    // Create NPC_DUMMY with club and leather armor
    const npcDummy = {
      id: "NPC_DUMMY",
      name: "Dummy",
      kind: "NPC" as const,
      tags: [],
      stats: {
        STR: 40,
        TOU: 40,
        AGI: 30,
        INT: 20,
        WIL: 30,
        CHA: 20,
        WS: 40,
        BS: 30,
        INI: 30,
        PER: 30,
      },
      resources: { hp: 50, rf: 50, peq: 50 },
      skills: {},
      talents: [],
      traits: [],
      equipment: {
        weaponId: "club",
        armorId: "leather",
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    return createNewGame(
      brunholt as StoryPack,
      123456, // fixed seed
      party,
      { PC_1: minimalActor, NPC_DUMMY: npcDummy },
      {}, // empty item catalog for now
      sigilContent as ContentPack
    );
  }, []);

  const [save, setSave] = useState<GameSave>(initialSave);
  const { width, height } = useWindowDimensions();

  const { scene, text } = getCurrentScene(brunholt as StoryPack, save);
  const choices = listAvailableChoices(brunholt as StoryPack, save);

  // Determine layout mode: portrait/narrow uses column, landscape/wide uses row
  const isNarrow = width < 700 || height > width;

  const handleChoice = (choiceId: string) => {
    const newSave = applyChoice(brunholt as StoryPack, save, choiceId);
    setSave(newSave);
  };

  const lastCheck = save.runtime.lastCheck;
  const tags = lastCheck && lastCheck !== null ? lastCheck.tags : [];
  const combat = save.runtime.combat;

  // Filter out combat-related choices from generic choices list - ALWAYS exclude combat choices
  const nonCombatChoices = choices.filter(
    (choice) =>
      !choice.id.startsWith("combat_move_") &&
      !choice.id.startsWith("combat_melee") &&
      !choice.id.startsWith("combat_ranged_") &&
      choice.id !== "start_combat" &&
      choice.id !== "combat_end_turn"
  );

  // Get combat-specific choices
  const combatChoices = choices.filter(
    (choice) =>
      choice.id.startsWith("combat_move_") ||
      choice.id === "combat_melee" ||
      choice.id.startsWith("combat_melee_") ||
      choice.id.startsWith("combat_ranged_") ||
      choice.id === "combat_end_turn"
  );

  // Use combat UI model hook
  const combatModel = useCombatUiModel(save, combatChoices);

  // Game Area component with layout measurement
  const GameArea = () => {
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    const onLayout = useCallback((event: any) => {
      const { width, height } = event.nativeEvent.layout;
      setDimensions({ width, height });
    }, []);

    return (
      <View style={styles.gameAreaContainer} onLayout={onLayout}>
        {dimensions.width > 0 && dimensions.height > 0 ? (
          <CombatGrid
            containerWidth={dimensions.width}
            containerHeight={dimensions.height}
            combat={combat}
            save={save}
            styles={styles}
          />
        ) : (
          <View style={styles.gameArea}>
            <Text style={styles.gameAreaTitle}>Game Area</Text>
            <Text style={styles.gameAreaSubtitle}>Loading...</Text>
          </View>
        )}
      </View>
    );
  };

  // Get combat narration from combatLog (turn-scoped: only current turn)
  const combatLog = save.runtime.combatLog ?? [];
  const turnStartIndex = save.runtime.combatTurnStartIndex ?? 0;

  // Determine which scene the combat narration belongs to
  const narrationSceneId = save.runtime.combatLogSceneId ?? combat?.startedBySceneId;
  const showNarration = Boolean(narrationSceneId && narrationSceneId === save.runtime.currentSceneId);

  const showCombatEnded =
    tags.some((t) => t === "combat:state=end") && save.runtime.combatEndedSceneId === save.runtime.currentSceneId;

  // LeftPane content: story, choices, debug panels
  const LeftPaneContent = () => (
    <ScrollView style={styles.leftPaneScroll}>
      <View style={styles.content}>
        <Text style={styles.title}>{scene.title}</Text>

        {/* Scene descriptive text */}
        {text.map((line, index) => (
          <Text key={index} style={styles.text}>
            {line}
          </Text>
        ))}

        {/* Combat Narration */}
        <CombatNarration
          showNarration={showNarration}
          combatLog={combatLog}
          turnStartIndex={turnStartIndex}
          styles={styles}
        />

        {/* CombatControl Panel */}
        <CombatControl
          model={combatModel}
          save={save}
          combatChoices={combatChoices}
          handleChoice={handleChoice}
          width={width}
          styles={styles}
        />

        {/* Combat End Banner - only show in the scene that started combat */}
        {showCombatEnded && (
          <View style={styles.combatEndBanner}>
            <Text style={styles.combatEndText}>Combat ended.</Text>
            {tags.find((t) => t.startsWith("combat:winner=")) && (
              <Text style={styles.combatEndText}>
                Winner:{" "}
                {save.actorsById[tags.find((t) => t.startsWith("combat:winner="))!.split("=")[1]]?.name || "Unknown"}
              </Text>
            )}
          </View>
        )}

        {/* Non-combat choices only */}
        <ChoiceList choices={nonCombatChoices} handleChoice={handleChoice} styles={styles} />

        <DebugPanels save={save} tags={tags} styles={styles} />
      </View>
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {isNarrow ? (
        // Portrait/Narrow layout: TopPane (fixed height) + LeftPane (scrollable)
        <>
          <View style={styles.topPane}>
            <GameArea />
          </View>
          <View style={styles.leftPane}>
            <LeftPaneContent />
          </View>
        </>
      ) : (
        // Landscape/Wide layout: Row layout with LeftPane and RightPane
        <View style={styles.rowLayout}>
          <View style={styles.leftPane}>
            <LeftPaneContent />
          </View>
          <View style={styles.rightPane}>
            <GameArea />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },
  rowLayout: {
    flex: 1,
    flexDirection: "row",
  },
  leftPane: {
    flex: 1,
    width: "50%",
  },
  rightPane: {
    flex: 1,
    width: "50%",
    borderLeftWidth: 1,
    borderLeftColor: "#ddd",
  },
  topPane: {
    height: 280,
    borderBottomWidth: 1,
    borderBottomColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  leftPaneScroll: {
    flex: 1,
  },
  gameAreaContainer: {
    flex: 1,
    width: "100%",
  },
  gameArea: {
    flex: 1,
    width: "100%",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#f9f9f9",
    position: "relative",
    minHeight: 200,
  },
  gameAreaTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  gameAreaSubtitle: {
    fontSize: 14,
    color: "#666",
    fontStyle: "italic",
  },
  gridContainer: {
    position: "relative",
    borderWidth: 1,
    borderColor: "#999",
    backgroundColor: "#fff",
  },
  gridBackground: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  gridLine: {
    position: "absolute",
    backgroundColor: "#e0e0e0",
  },
  token: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#fff",
    transform: [{ translateX: -16 }, { translateY: -16 }],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3, // For Android
  },
  tokenText: {
    fontSize: 8,
    fontWeight: "600",
    color: "#fff",
    textAlign: "center",
  },
  gridOverlay: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: "rgba(255, 255, 255, 0.9)",
    padding: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  overlayText: {
    fontSize: 11,
    color: "#333",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  content: {
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 16,
    color: "#000",
  },
  text: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 12,
    color: "#333",
  },
  choicesContainer: {
    marginTop: 24,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingTop: 16,
  },
  choicesTitle: {
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 12,
    color: "#000",
  },
  choiceButton: {
    backgroundColor: "#007AFF",
    padding: 16,
    borderRadius: 8,
    marginBottom: 12,
  },
  choiceText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "500",
  },
  checkInfo: {
    marginTop: 16,
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
  },
  checkLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  checkText: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  breakdownContainer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#ddd",
  },
  breakdownLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  breakdownSubLabel: {
    fontSize: 11,
    fontWeight: "600",
    color: "#888",
    marginTop: 4,
    marginBottom: 2,
  },
  breakdownSection: {
    marginTop: 4,
  },
  breakdownText: {
    fontSize: 11,
    color: "#666",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  combatStatus: {
    marginTop: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#fff3cd",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffc107",
  },
  combatTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#856404",
    marginBottom: 8,
  },
  combatText: {
    fontSize: 14,
    color: "#856404",
    marginBottom: 4,
  },
  combatWarning: {
    fontSize: 14,
    color: "#dc3545",
    fontWeight: "600",
    marginTop: 4,
  },
  combatEndBanner: {
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: "#d4edda",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#28a745",
  },
  combatEndText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#155724",
    marginBottom: 4,
  },
  moveButtonsContainer: {
    marginTop: 16,
    marginBottom: 16,
  },
  moveButtonsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 8,
  },
  moveButton: {
    backgroundColor: "#28a745",
    padding: 12,
    borderRadius: 8,
    minWidth: 50,
    alignItems: "center",
    margin: 4,
  },
  moveButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  choiceButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  choiceTextDisabled: {
    color: "#666",
  },
  choiceItem: {
    marginBottom: 12,
  },
  disabledReason: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
    marginLeft: 4,
    fontStyle: "italic",
  },
  combatNarration: {
    marginTop: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#fff9e6",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ffd700",
  },
  combatNarrationTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#856404",
    marginBottom: 8,
  },
  combatNarrationText: {
    fontSize: 13,
    color: "#333",
    marginBottom: 6,
    lineHeight: 18,
  },
  combatFeed: {
    marginTop: 16,
    marginBottom: 16,
    padding: 12,
    backgroundColor: "#e8f4f8",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#b3d9e6",
  },
  combatFeedTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0066cc",
    marginBottom: 6,
  },
  combatFeedText: {
    fontSize: 12,
    color: "#333",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  endTurnContainer: {
    marginTop: 16,
    marginBottom: 16,
  },
  endTurnButton: {
    backgroundColor: "#ff6b35",
    padding: 16,
    borderRadius: 8,
    alignItems: "center",
  },
  endTurnButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
  },
  combatControl: {
    marginTop: 16,
    marginBottom: 16,
    padding: 16,
    backgroundColor: "#f0f8ff",
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "#4a90e2",
  },
  combatControlHeader: {
    marginBottom: 16,
  },
  combatControlTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#1e3a8a",
    marginBottom: 8,
  },
  combatControlInfo: {
    fontSize: 14,
    color: "#333",
    marginBottom: 4,
  },
  combatControlStats: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
  },
  combatControlStat: {
    fontSize: 12,
    color: "#555",
    marginBottom: 2,
    fontFamily: "monospace",
  },
  controlsRow: {
    flexDirection: "column",
    marginBottom: 16,
  },
  controlsRowHorizontal: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 16,
  },
  movePadContainer: {
    alignSelf: "flex-start",
  },
  movePadTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  movePadGrid: {
    flexDirection: "column",
  },
  movePadRow: {
    flexDirection: "row",
  },
  movePadCell: {
    width: 48,
    height: 48,
    margin: 2,
    justifyContent: "center",
    alignItems: "center",
  },
  movePadButton: {
    width: "100%",
    height: "100%",
    backgroundColor: "#28a745",
    borderRadius: 4,
    justifyContent: "center",
    alignItems: "center",
  },
  movePadButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  movePadButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
  movePadButtonTextDisabled: {
    color: "#666",
  },
  movePadReason: {
    fontSize: 8,
    color: "#999",
    marginTop: 2,
    textAlign: "center",
  },
  attackButtonsContainer: {
    flex: 1,
    minWidth: 0,
  },
  attackButtonsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  attackButtonItem: {
    marginBottom: 8,
  },
  attackButton: {
    backgroundColor: "#dc3545",
    padding: 12,
    borderRadius: 6,
  },
  attackButtonDisabled: {
    backgroundColor: "#ccc",
    opacity: 0.6,
  },
  attackButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  attackButtonTextDisabled: {
    color: "#666",
  },
  attackButtonReason: {
    fontSize: 10,
    color: "#999",
    marginTop: 4,
    marginLeft: 4,
    fontStyle: "italic",
  },
  combatControlEconomy: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#cbd5e1",
  },
  combatControlEconomyText: {
    fontSize: 12,
    color: "#1e3a8a",
    fontWeight: "600",
    fontFamily: "monospace",
  },
  specialActionsContainer: {
    marginTop: 16,
    marginBottom: 16,
  },
  specialActionsTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  specialActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  specialActionButton: {
    flex: 1,
    backgroundColor: "#6c757d",
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  specialActionButtonText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
});
