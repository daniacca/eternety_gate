import { useState, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, ScrollView, useWindowDimensions, Pressable } from "react-native";
import {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
  applyEffects,
  RNG,
  type GameSave,
  type StoryPack,
  type ContentPack,
  type Effect,
  type ItemRef,
  buildSpellTargetSpec,
  computeTargetPreview,
  getSpellById,
  getEffectById,
  type TargetSpec,
  type TargetSelection,
  type TargetPreview,
  type Direction8,
  type Position,
} from "@eg/engine";
import brunholt from "../../stories/brunholt.story.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";
import gridsCatalog from "@eg/content/src/catalogs/grids.json";
import tilesCatalog from "@eg/content/src/catalogs/tiles.json";
import { sigilContentPack } from "@eg/content/src";
import { CombatGrid } from "./components/CombatGrid";
import { CombatControl } from "./components/CombatControl";
import { CombatNarration } from "./components/CombatNarration";
import { LastCheckPanel } from "./components/LastCheckPanel";
import { ChoiceList } from "./components/ChoiceList";
import { PlayerHud } from "./components/PlayerHud";
import { PlayerSheet } from "./components/PlayerSheet";
import { TalentShop } from "./components/TalentShop";
import { EquipmentModal } from "./components/EquipmentModal";
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
        STR: 53,
        TOU: 56,
        AGI: 62,
        INT: 47,
        WIL: 89,
        CHA: 48,
        WS: 88,
        BS: 88,
        INI: 75,
        PER: 73,
      },
      resources: { wounds: 0, rf: 0, fatePoints: 3 },
      skills: {
        "skill:dodge": 2,
        "skill:parry": 1,
        "skill:awareness": 3,
        "skill:stealth": 1,
        "skill:weave_sense": 2,
        "skill:channeling": 5,
      },
      talents: {
        "talent:quick_draw": 1,
        "talent:sound_constitution": 5,
        "talent:mighty_shot_1": 1,
        "talent:mighty_shot_2": 1,
        "talent:swift_attack": 1,
        "talent:disarm": 1,
        "talent:takedown": 1,
        "talent:arcane_attunement_1": 1,
        "talent:arcane_attunement_2": 1,
        "talent:arcane_attunement_3": 1,
        "talent:weave_favoured": 1,
        "talent:weave_seal": 1,
      },
      traits: {
        "trait:weaver": true,
        "trait:size": { size: 4 },
        "trait:unnatural_characteristic": {
          characteristics: [
            { stat: "STR", bonusX: 2 },
            { stat: "AGI", bonusX: 2 },
            { stat: "TOU", bonusX: 2 },
            { stat: "WIL", bonusX: 4 },
            { stat: "INI", bonusX: 2 },
          ],
        },
      },
      spells: {
        "spell:flame_bolt": true,
        "spell:flame_cone": true,
        "spell:pyra_explosion": true,
        "spell:soothe_wounds": true,
        "spell:force_push": true,
        "spell:disrupt": true,
        "spell:sense_magic": true,
        "spell:corpus_steel_body": true,
        "spell:corpus_warp_speed": true,
        "spell:regenerate_minor": true,
      },
      equipment: {
        mainHand: { kind: "weapon" as const, id: "shortbow" }, // Test weapon: ranged
        armor: { kind: "armor" as const, id: "plate" },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
      inventory: [
        { kind: "weapon" as const, id: "club" },
        { kind: "item" as const, id: "shield:wooden" },
        { kind: "item" as const, id: "helmet:leather" },
        { kind: "item" as const, id: "boots:leather" },
        { kind: "item" as const, id: "cloak:traveler" },
        { kind: "item" as const, id: "necklace:iron" },
        { kind: "item" as const, id: "ring:agility" },
        { kind: "item" as const, id: "ammo:arrow", qty: 10 },
      ],
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
      resources: { wounds: 0, rf: 0 },
      skills: {},
      talents: { "talent:deny_the_witch": 1 },
      traits: { "trait:size": { size: 4 } },
      equipment: {
        mainHand: { kind: "weapon" as const, id: "club" },
        armor: { kind: "armor" as const, id: "leather" },
      },
      status: {
        conditions: [],
        tempModifiers: [],
      },
    };

    // Merge content pack catalogs into story pack for combat system access
    const storyPackWithCatalogs = {
      ...(brunholt as StoryPack),
      skills: skillsCatalog as any,
      talents: talentsCatalog as any,
      traits: traitsCatalog as any,
      grids: gridsCatalog.grids as any,
      tiles: tilesCatalog.tiles as any,
    };

    return createNewGame(
      storyPackWithCatalogs,
      123456, // fixed seed
      party,
      { PC_1: minimalActor, NPC_DUMMY: npcDummy, NPC_DUMMY_2: { ...npcDummy, id: "NPC_DUMMY_2", name: "Dummy 2" } },
      sigilContentPack as ContentPack
    );
  }, []);

  // Merge catalogs into story pack reference (reused throughout component)
  const storyPackWithCatalogs = useMemo(
    () => ({
      ...(brunholt as StoryPack),
      skills: skillsCatalog as any,
      talents: talentsCatalog as any,
      traits: traitsCatalog as any,
      grids: gridsCatalog.grids as any,
      tiles: tilesCatalog.tiles as any,
    }),
    []
  );

  type SpellTargetingState = {
    spellId: string;
    spellName: string;
    targetSpec: TargetSpec;
    selection: Partial<TargetSelection>;
    preview: TargetPreview;
  };
  type EquipmentSlot = "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2";

  const [save, setSave] = useState<GameSave>(initialSave);
  const [playerSheetVisible, setPlayerSheetVisible] = useState(false);
  const [talentShopVisible, setTalentShopVisible] = useState(false);
  const [equipmentVisible, setEquipmentVisible] = useState(false);
  const [spellTargeting, setSpellTargeting] = useState<SpellTargetingState | null>(null);
  const { width, height } = useWindowDimensions();

  const { scene, text } = getCurrentScene(storyPackWithCatalogs, save);
  const choices = listAvailableChoices(storyPackWithCatalogs, save);
  const gameOver = save.runtime.gameOver;

  // Layout rules:
  // - Wide/landscape: 2 columns (map left, UI right)
  // - Portrait: map on top, then bottom area split into 2 columns (story/choices | combat panels)
  const isPortrait = height > width;
  const isWide = !isPortrait && width >= 700;
  const isNarrow = !isWide; // used for sizing + some responsive tweaks
  const isPhone = width < 420;

  const styles = useMemo(() => createStyles({ width, height, isNarrow, isPhone }), [width, height, isNarrow, isPhone]);

  const handleChoice = (choiceId: string) => {
    const newSave = applyChoice(storyPackWithCatalogs, save, choiceId, sigilContentPack);
    setSave(newSave);
  };

  const applySystemEffects = (effects: Effect[]) => {
    const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
    let newSave = applyEffects(effects, storyPackWithCatalogs, save, rng, sigilContentPack);

    // Ensure RNG counter is always saved back to the game state
    // This prevents RNG values from being reused
    newSave = {
      ...newSave,
      runtime: {
        ...newSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };

    setSave(newSave);
  };

  const handleEquipItem = (slot: EquipmentSlot, inventoryIndex: number, itemRef: ItemRef) => {
    applySystemEffects([
      {
        op: "combatEquipItem",
        actorId: save.party.activeActorId,
        itemRef,
        slot,
        inventoryIndex,
      },
    ]);
  };

  const handleUnequipItem = (slot: EquipmentSlot) => {
    applySystemEffects([
      {
        op: "combatUnequipItem",
        actorId: save.party.activeActorId,
        slot,
      },
    ]);
  };

  const buildInitialSelection = (spec: TargetSpec): Partial<TargetSelection> => {
    switch (spec.shape.kind) {
      case "self":
        return { kind: "self" };
      case "touch":
        return { kind: "touch", direction: "N" };
      case "line":
        return { kind: "line", direction: "N" };
      case "cone":
        return { kind: "cone", direction: "N" };
      case "single":
        return { kind: "single" };
      case "radius":
        return { kind: "radius" };
      default:
        return {};
    }
  };

  const startSpellTargeting = (spellId: string) => {
    const spell = getSpellById(spellId);
    const effectDef = spell ? getEffectById(spell.effectId) : null;
    if (!spell || !effectDef) return;
    const cnBase = effectDef.baseCN ?? spell.baseCN;
    const targetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
    const selection = buildInitialSelection(targetSpec);
    const preview = computeTargetPreview(save, save.party.activeActorId, targetSpec, selection);
    setSpellTargeting({
      spellId,
      spellName: spell.name,
      targetSpec,
      selection,
      preview,
    });
  };

  const handleTargetDirection = (dir: Direction8) => {
    setSpellTargeting((current) => {
      if (!current) return current;
      const kind = current.targetSpec.shape.kind;
      if (kind === "touch") {
        const selection: TargetSelection = { kind: "touch", direction: dir };
        const preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        return { ...current, selection, preview };
      }
      if (kind === "line") {
        const selection: TargetSelection = { kind: "line", direction: dir };
        const preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        return { ...current, selection, preview };
      }
      if (kind === "cone") {
        const selection: TargetSelection = { kind: "cone", direction: dir };
        const preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        return { ...current, selection, preview };
      }
      return current;
    });
  };

  const handleCellTarget = (pos: Position) => {
    setSpellTargeting((current) => {
      if (!current) return current;
      const kind = current.targetSpec.shape.kind;
      if (kind === "single") {
        const selection: TargetSelection = { kind: "single", targetPos: pos };
        const preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        return { ...current, selection, preview };
      }
      if (kind === "radius") {
        const selection: TargetSelection = { kind: "radius", centerPos: pos };
        const preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        return { ...current, selection, preview };
      }
      return current;
    });
  };

  const confirmSpellTargeting = () => {
    if (!spellTargeting || !spellTargeting.preview.valid) return;
    applySystemEffects([
      {
        op: "combatCastSpell",
        actorId: save.party.activeActorId,
        spellId: spellTargeting.spellId,
        targetSelection: spellTargeting.selection as TargetSelection,
      },
    ]);
    setSpellTargeting(null);
  };

  const cancelSpellTargeting = () => setSpellTargeting(null);

  const lastCheck = save.runtime.lastPlayerCheck || save.runtime.lastCheck;
  const tags = lastCheck && lastCheck !== null ? lastCheck.tags : [];
  const combat = save.runtime.combat;
  const targetingInfo = spellTargeting
    ? {
        spellName: spellTargeting.spellName,
        previewValid: spellTargeting.preview.valid,
        reason: spellTargeting.preview.reason,
        requiresDirection: spellTargeting.targetSpec.requiresDirection,
        direction: "direction" in spellTargeting.selection ? (spellTargeting.selection as any).direction : undefined,
      }
    : undefined;

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
  const combatModel = useCombatUiModel(save, combatChoices, storyPackWithCatalogs);

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
            targetingPreview={spellTargeting?.preview}
            onCellPress={spellTargeting ? handleCellTarget : undefined}
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
  const cycleStartIndex = save.runtime.combatCycleStartIndex ?? turnStartIndex;

  // Determine which scene the combat narration belongs to
  const showNarration = Boolean(save.runtime.combat?.active);

  const showCombatEnded =
    tags.some((t) => t === "combat:state=end") && save.runtime.combatEndedSceneId === save.runtime.currentSceneId;

  const StoryContent = () => (
    <View style={styles.content}>
      <Text style={styles.title}>{scene.title}</Text>

      {/* Scene descriptive text */}
      {text.map((line, index) => (
        <Text key={index} style={styles.text}>
          {line}
        </Text>
      ))}

      {/* Game Over Panel */}
      {gameOver && (
        <View style={styles.gameOverPanel}>
          <Text style={styles.gameOverTitle}>Game Over</Text>
          <Text style={styles.gameOverText}>
            {gameOver.reason === "playerDead" ? "Sei morto!" : "Tutti i membri del gruppo sono morti!"}
          </Text>
          <Pressable
            style={styles.gameOverButton}
            onPress={() => {
              setSave(initialSave);
            }}
          >
            <Text style={styles.gameOverButtonText}>Restart</Text>
          </Pressable>
        </View>
      )}

      {/* Combat End Banner - only show in the scene that started combat */}
      {showCombatEnded && !gameOver && (
        <View style={styles.combatEndBanner}>
          {(() => {
            const outcomeTag = tags.find((t) => t.startsWith("combat:outcome="));
            const outcome = outcomeTag ? outcomeTag.split("=")[1] : null;

            if (outcome === "victory") {
              return <Text style={styles.combatEndText}>Tutti i nemici presenti nell'area sono stati sconfitti.</Text>;
            } else if (outcome === "defeat") {
              return <Text style={styles.combatEndText}>Il party è stato annientato. Game over.</Text>;
            } else {
              // Fallback for old saves
              return (
                <>
                  <Text style={styles.combatEndText}>Combat ended.</Text>
                  {tags.find((t) => t.startsWith("combat:winner=")) && (
                    <Text style={styles.combatEndText}>
                      Winner:{" "}
                      {save.actorsById[tags.find((t) => t.startsWith("combat:winner="))!.split("=")[1]]?.name ||
                        "Unknown"}
                    </Text>
                  )}
                </>
              );
            }
          })()}
        </View>
      )}

      {/* Non-combat choices only */}
      <ChoiceList choices={nonCombatChoices} handleChoice={handleChoice} styles={styles} />
    </View>
  );

  const CombatPanels = () => (
    <View style={styles.content}>
      {/* Combat Narration + Last Check */}
      {showNarration && (
        <View style={styles.narrationContainer}>
          <View style={styles.narrationLeft}>
            <CombatNarration
              showNarration={showNarration}
              combatLog={combatLog}
              turnStartIndex={turnStartIndex}
              cycleStartIndex={cycleStartIndex}
              styles={styles}
            />
          </View>
          <View style={styles.narrationRight}>
            <LastCheckPanel check={lastCheck} save={save} styles={styles} />
          </View>
        </View>
      )}

      {/* CombatControl Panel */}
      <CombatControl
        model={combatModel}
        save={save}
        combatChoices={combatChoices}
        handleChoice={handleChoice}
        applySystemEffects={applySystemEffects}
        storyPack={storyPackWithCatalogs}
        width={width}
        styles={styles}
        onSpellTargetSelect={startSpellTargeting}
        targetingInfo={targetingInfo}
        onTargetDirection={handleTargetDirection}
        onTargetConfirm={confirmSpellTargeting}
        onTargetCancel={cancelSpellTargeting}
      />
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Player HUD - always visible */}
      <PlayerHud
        save={save}
        onOpenSheet={() => setPlayerSheetVisible(true)}
        onOpenTalentShop={() => setTalentShopVisible(true)}
        onOpenEquipment={() => setEquipmentVisible(true)}
      />

      {isWide ? (
        // Wide/Landscape: 2 columns, map LEFT and UI RIGHT
        <View style={styles.rowLayout}>
          <View style={styles.rightPane}>
            <GameArea />
          </View>
          <ScrollView style={styles.leftPaneScroll}>
            <StoryContent />
            <CombatPanels />
          </ScrollView>
        </View>
      ) : (
        // Portrait/Narrow: single full-width column (map on top, then story + combat panels stacked)
        <>
          <View style={styles.topPane}>
            <GameArea />
          </View>
          <ScrollView style={styles.bottomScroll} contentContainerStyle={styles.bottomScrollContent}>
            <StoryContent />
            <CombatPanels />
          </ScrollView>
        </>
      )}

      {/* Player Sheet Modal */}
      <PlayerSheet
        visible={playerSheetVisible}
        save={save}
        onClose={() => setPlayerSheetVisible(false)}
        applySystemEffects={applySystemEffects}
      />

      {/* Talent Shop Modal */}
      <TalentShop
        visible={talentShopVisible}
        save={save}
        actor={save.actorsById[save.party.activeActorId]}
        onClose={() => setTalentShopVisible(false)}
        applySystemEffects={applySystemEffects}
      />

      {/* Equipment Modal (debug) */}
      <EquipmentModal
        visible={equipmentVisible}
        save={save}
        actorId={save.party.activeActorId}
        onClose={() => setEquipmentVisible(false)}
        onEquip={handleEquipItem}
        onUnequip={handleUnequipItem}
      />
    </View>
  );
}

const createStyles = ({
  width,
  height,
  isNarrow,
  isPhone,
}: {
  width: number;
  height: number;
  isNarrow: boolean;
  isPhone: boolean;
}) => {
  const topPaneHeight = isNarrow ? Math.round(Math.max(220, Math.min(420, height * 0.42))) : 280;
  // On phones we want readability first.
  const contentPadding = isPhone ? 16 : 20;
  const titleFontSize = isPhone ? 24 : 24;
  const textFontSize = isPhone ? 17 : 16;
  const textLineHeight = isPhone ? 26 : 24;
  const actionPadding = isPhone ? 16 : 16;
  const sidePanelHeight = isPhone ? 170 : 200;
  const movePadCellSize = isPhone ? 42 : 48;

  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: "#fff",
    },
    rowLayout: {
      flex: 1,
      flexDirection: "row",
    },
    rightPane: {
      flex: 1,
      width: "50%",
      borderRightWidth: 1,
      borderRightColor: "#ddd",
    },
    topPane: {
      height: topPaneHeight,
      borderBottomWidth: 1,
      borderBottomColor: "#ddd",
      justifyContent: "center",
      alignItems: "center",
      padding: isPhone ? 8 : 16,
    },
    leftPaneScroll: { flex: 1, width: "50%" },
    bottomScroll: { flex: 1 },
    bottomScrollContent: { flexGrow: 1 },
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
    initiativeOrderPanel: {
      padding: 0,
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
    barsContainer: {
      position: "absolute",
      transform: [{ translateX: -30 }], // Center horizontally (width is ~60)
      alignItems: "flex-start",
      zIndex: 10,
    },
    barRow: {
      flexDirection: "row",
      alignItems: "center",
      marginBottom: 4,
    },
    healthBarBackground: {
      width: 40,
      height: 6,
      backgroundColor: "#333",
      borderRadius: 3,
      overflow: "hidden",
      marginRight: 4,
    },
    healthBarFill: {
      height: "100%",
      backgroundColor: "#4CAF50",
      borderRadius: 3,
    },
    criticalBarBackground: {
      width: 40,
      height: 6,
      backgroundColor: "#333",
      borderRadius: 3,
      overflow: "hidden",
      marginRight: 4,
    },
    criticalBarFill: {
      height: "100%",
      backgroundColor: "#F44336",
      borderRadius: 3,
    },
    barText: {
      fontSize: 8,
      fontWeight: "600",
      color: "#000",
      minWidth: 20,
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
    initiativeOverlay: {
      position: "absolute",
      top: 8,
      right: 8,
      backgroundColor: "rgba(255, 255, 255, 0.9)",
      padding: 8,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "#ddd",
      maxWidth: isPhone ? 120 : 150,
    },
    content: {
      padding: contentPadding,
    },
    title: {
      fontSize: titleFontSize,
      fontWeight: "bold",
      marginBottom: 16,
      color: "#000",
    },
    text: {
      fontSize: textFontSize,
      lineHeight: textLineHeight,
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
      fontSize: isPhone ? 20 : 18,
      fontWeight: "600",
      marginBottom: 12,
      color: "#000",
    },
    choiceButton: {
      backgroundColor: "#007AFF",
      padding: actionPadding,
      borderRadius: 8,
      marginBottom: 12,
    },
    choiceText: {
      color: "#FFFFFF",
      fontSize: isPhone ? 18 : 16,
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
    narrationContainer: {
      flexDirection: isNarrow ? "column" : "row",
      marginTop: 16,
      marginBottom: 16,
      gap: 12,
    },
    narrationLeft: {
      flex: 1,
    },
    narrationRight: {
      flex: 1,
    },
    combatNarration: {
      height: sidePanelHeight,
      padding: 12,
      backgroundColor: "#fff9e6",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#ffd700",
    },
    combatNarrationScroll: {
      flex: 1,
    },
    lastCheckPanel: {
      height: sidePanelHeight,
      padding: 12,
      backgroundColor: "#e8f4f8",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#b3d9e6",
    },
    combatNarrationHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 8,
    },
    combatNarrationTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: "#856404",
    },
    combatNarrationToggle: {
      paddingHorizontal: 12,
      paddingVertical: 4,
      backgroundColor: "#ffd700",
      borderRadius: 4,
      borderWidth: 1,
      borderColor: "#856404",
    },
    combatNarrationToggleText: {
      fontSize: 12,
      fontWeight: "600",
      color: "#856404",
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
      padding: actionPadding,
      borderRadius: 8,
      alignItems: "center",
    },
    endTurnButtonText: {
      color: "#FFFFFF",
      fontSize: isPhone ? 14 : 16,
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
      fontSize: isPhone ? 16 : 18,
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
      alignSelf: "center",
      alignItems: "center",
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
      width: movePadCellSize,
      height: movePadCellSize,
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
      fontSize: isPhone ? 11 : 12,
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
    combatBlock: {
      marginTop: 16,
      marginBottom: 16,
      padding: 12,
      backgroundColor: "#f9f9f9",
      borderRadius: 8,
      borderWidth: 1,
      borderColor: "#ddd",
    },
    combatBlockFlex: {
      flex: 1,
      marginTop: 0,
      marginBottom: 0,
      marginHorizontal: 4,
    },
    mainRow: {
      flexDirection: "row",
      marginTop: 16,
      marginBottom: 16,
      gap: 12,
    },
    mainRowNarrow: {
      flexDirection: "column",
    },
    movementBlock: {
      flex: 1,
      marginTop: 0,
      marginBottom: 0,
      marginHorizontal: 0,
    },
    attacksBlock: {
      flex: 1,
      marginTop: 0,
      marginBottom: 0,
      marginHorizontal: 0,
    },
    stanceBlock: {
      flex: 1,
      marginTop: 0,
      marginBottom: 0,
      marginHorizontal: 0,
    },
    magicBlock: {
      flex: 1,
      marginTop: 0,
      marginBottom: 0,
      marginHorizontal: 0,
    },
    attackSection: {
      marginBottom: 16,
    },
    attackSectionTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: "#666",
      marginBottom: 8,
    },
    combatBlockTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: "#333",
      marginBottom: 12,
    },
    attackGroup: {
      marginBottom: 12,
    },
    attackGroupTitle: {
      fontSize: 13,
      fontWeight: "600",
      color: "#666",
      marginBottom: 8,
    },
    movementActions: {
      flexDirection: "column",
      gap: 8,
      marginTop: 12,
    },
    movementActionButton: {
      flex: 1,
      backgroundColor: "#28a745",
      padding: 10,
      borderRadius: 6,
      alignItems: "center",
    },
    movementActionText: {
      color: "#FFFFFF",
      fontSize: 13,
      fontWeight: "500",
    },
    stanceActions: {
      flexDirection: "column",
      gap: 8,
    },
    stanceButton: {
      flex: 1,
      backgroundColor: "#6c757d",
      padding: 12,
      borderRadius: 6,
      alignItems: "center",
    },
    stanceButtonText: {
      color: "#FFFFFF",
      fontSize: 14,
      fontWeight: "600",
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
    // Called Shot styles
    calledShotButton: {
      backgroundColor: "#dc2626",
    },
    calledShotHint: {
      fontSize: 10,
      color: "#888",
      marginTop: 2,
      fontStyle: "italic",
    },
    calledShotModal: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: "rgba(0, 0, 0, 0.7)",
      justifyContent: "center",
      alignItems: "center",
      zIndex: 1000,
    },
    calledShotModalContent: {
      backgroundColor: "#1a1a2e",
      borderRadius: 12,
      padding: 20,
      width: "90%",
      maxWidth: 400,
    },
    calledShotModalTitle: {
      fontSize: 18,
      fontWeight: "700",
      color: "#f0f0ff",
      textAlign: "center",
      marginBottom: 4,
    },
    calledShotModalSubtitle: {
      fontSize: 13,
      color: "#a0a0c0",
      textAlign: "center",
      marginBottom: 16,
    },
    calledShotZones: {
      gap: 10,
    },
    calledShotZoneButton: {
      backgroundColor: "#2d2d44",
      borderRadius: 10,
      padding: 14,
      borderWidth: 2,
      borderColor: "#4a4a6a",
    },
    calledShotZoneLabel: {
      fontSize: 16,
      fontWeight: "700",
      color: "#f0f0ff",
    },
    calledShotZonePenalty: {
      fontSize: 12,
      color: "#f87171",
      marginTop: 2,
    },
    calledShotZoneEffect: {
      fontSize: 11,
      color: "#a0a0c0",
      marginTop: 2,
      fontStyle: "italic",
    },
    calledShotCancelButton: {
      marginTop: 16,
      padding: 12,
      backgroundColor: "#3f3f5e",
      borderRadius: 8,
      alignItems: "center",
    },
    calledShotCancelText: {
      color: "#f0f0ff",
      fontWeight: "600",
    },
    gameOverPanel: {
      backgroundColor: "#1a1a1a",
      padding: 24,
      borderRadius: 8,
      marginTop: 16,
      marginBottom: 16,
      alignItems: "center",
      borderWidth: 2,
      borderColor: "#dc3545",
    },
    gameOverTitle: {
      fontSize: 24,
      fontWeight: "bold",
      color: "#dc3545",
      marginBottom: 12,
    },
    gameOverText: {
      fontSize: 16,
      color: "#FFFFFF",
      marginBottom: 20,
      textAlign: "center",
    },
    gameOverButton: {
      backgroundColor: "#dc3545",
      paddingHorizontal: 32,
      paddingVertical: 12,
      borderRadius: 6,
    },
    gameOverButtonText: {
      color: "#FFFFFF",
      fontSize: 16,
      fontWeight: "600",
    },
  });
};
