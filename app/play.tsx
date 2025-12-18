import { useState, useMemo, useCallback } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, useWindowDimensions } from "react-native";
import {
  createNewGame,
  getCurrentScene,
  listAvailableChoices,
  applyChoice,
  getCurrentTurnActorId,
  type GameSave,
  type StoryPack,
} from "@eg/engine";
import brunholt from "../stories/brunholt.story.json";

export default function PlayScreen() {
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
        equipped: {
          weaponMainId: null,
          weaponOffId: null,
          armorId: null,
          accessoryIds: [],
        },
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

    return createNewGame(
      brunholt as StoryPack,
      123456, // fixed seed
      party,
      { PC_1: minimalActor },
      {} // empty item catalog for now
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

  // Combat UI helpers
  const currentTurnActorId = combat?.active ? getCurrentTurnActorId(save) : null;
  const isPlayerTurn = combat?.active && currentTurnActorId === save.party.activeActorId;
  const currentTurnActor = currentTurnActorId ? save.actorsById[currentTurnActorId] : null;

  // Calculate distance if in combat
  let distance: number | null = null;
  if (combat?.active) {
    const pcPos = combat.positions[save.party.activeActorId];
    const npcIds = combat.participants.filter((id) => id !== save.party.activeActorId);
    if (pcPos && npcIds.length > 0) {
      const npcPos = combat.positions[npcIds[0]];
      if (npcPos) {
        const dx = Math.abs(pcPos.x - npcPos.x);
        const dy = Math.abs(pcPos.y - npcPos.y);
        distance = Math.max(dx, dy);
      }
    }
  }

  // Dynamic action gating
  const isCombatActive = combat?.active ?? false;
  const hasMoved = combat?.turn.hasMoved ?? false;
  const hasAttacked = combat?.turn.hasAttacked ?? false;
  const canMelee = distance !== null && distance <= 1;
  const canRanged = distance !== null && distance > 1 && distance <= 8;

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

  // CombatGrid component
  const CombatGrid = ({ containerWidth, containerHeight }: { containerWidth: number; containerHeight: number }) => {
    if (!combat?.active) {
      return (
        <View style={styles.gameArea}>
          <Text style={styles.gameAreaTitle}>Game Area</Text>
          <Text style={styles.gameAreaSubtitle}>No combat active</Text>
        </View>
      );
    }

    const { grid, positions, round } = combat;
    const currentTurnActorId = getCurrentTurnActorId(save);

    // Calculate grid size: smallest of width/height minus padding
    const padding = 32;
    const availableWidth = containerWidth - padding;
    const availableHeight = containerHeight - padding;
    const gridSize = Math.min(availableWidth, availableHeight);

    // Calculate cell size
    const cellWidth = gridSize / grid.width;
    const cellHeight = gridSize / grid.height;

    // Get PC and NPC positions for overlay
    const pcPos = positions[save.party.activeActorId];
    const npcIds = combat.participants.filter((id) => id !== save.party.activeActorId);
    const npcPos = npcIds.length > 0 ? positions[npcIds[0]] : null;

    // Calculate Chebyshev distance
    let distance: number | null = null;
    if (pcPos && npcPos) {
      const dx = Math.abs(pcPos.x - npcPos.x);
      const dy = Math.abs(pcPos.y - npcPos.y);
      distance = Math.max(dx, dy);
    }

    // Clamp position to grid bounds
    const clampPosition = (pos: { x: number; y: number }) => ({
      x: Math.max(0, Math.min(grid.width - 1, pos.x)),
      y: Math.max(0, Math.min(grid.height - 1, pos.y)),
    });

    return (
      <View style={styles.gameArea}>
        <View style={[styles.gridContainer, { width: gridSize, height: gridSize }]}>
          {/* Grid background with cell borders - simplified approach */}
          <View style={styles.gridBackground}>
            {/* Vertical lines */}
            {Array.from({ length: grid.width + 1 }).map((_, col) => (
              <View
                key={`v-${col}`}
                style={[
                  styles.gridLine,
                  {
                    left: (col * gridSize) / grid.width,
                    width: 1,
                    height: gridSize,
                  },
                ]}
              />
            ))}
            {/* Horizontal lines */}
            {Array.from({ length: grid.height + 1 }).map((_, row) => (
              <View
                key={`h-${row}`}
                style={[
                  styles.gridLine,
                  {
                    top: (row * gridSize) / grid.height,
                    width: gridSize,
                    height: 1,
                  },
                ]}
              />
            ))}
          </View>

          {/* Tokens */}
          {combat.participants.map((actorId) => {
            const actor = save.actorsById[actorId];
            const pos = clampPosition(positions[actorId]);
            const isPC = actor?.kind === "PC";

            // Position token at cell center
            const tokenX = (pos.x / grid.width) * gridSize + cellWidth / 2;
            const tokenY = (pos.y / grid.height) * gridSize + cellHeight / 2;

            return (
              <View
                key={actorId}
                style={[
                  styles.token,
                  {
                    left: tokenX,
                    top: tokenY,
                    backgroundColor: isPC ? "#007AFF" : "#DC3545",
                  },
                ]}
              >
                <Text style={styles.tokenText} numberOfLines={1}>
                  {actorId}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Overlay text */}
        <View style={styles.gridOverlay}>
          <Text style={styles.overlayText}>Round: {round}</Text>
          <Text style={styles.overlayText}>Turn: {currentTurnActorId || "N/A"}</Text>
          {pcPos && (
            <Text style={styles.overlayText}>
              PC pos: ({pcPos.x}, {pcPos.y})
            </Text>
          )}
          {npcPos && (
            <Text style={styles.overlayText}>
              NPC pos: ({npcPos.x}, {npcPos.y})
            </Text>
          )}
          {distance !== null && <Text style={styles.overlayText}>distChebyshev = {distance}</Text>}
        </View>
      </View>
    );
  };

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
          <CombatGrid containerWidth={dimensions.width} containerHeight={dimensions.height} />
        ) : (
          <View style={styles.gameArea}>
            <Text style={styles.gameAreaTitle}>Game Area</Text>
            <Text style={styles.gameAreaSubtitle}>Loading...</Text>
          </View>
        )}
      </View>
    );
  };

  // CombatControl component
  const CombatControl = () => {
    if (!combat?.active) return null;

    const pcActor = save.actorsById["PC_1"];
    const npcActor = save.actorsById["NPC_DUMMY"];
    const pcHp = pcActor?.resources.hp ?? 0;
    const pcFatigue = pcActor?.resources.rf ?? 0;
    const npcHp = npcActor?.resources.hp ?? 0;
    const npcFatigue = npcActor?.resources.rf ?? 0;

    // Get attack choices
    // Prioritize standard combat_melee over variants
    const meleeChoice =
      combatChoices.find((c) => c.id === "combat_melee") || combatChoices.find((c) => c.id.startsWith("combat_melee_"));
    const rangedLongChoice = combatChoices.find((c) => c.id === "combat_ranged_long_heavy");
    const rangedCalledChoice = combatChoices.find((c) => c.id === "combat_ranged_called_shot");

    // Move pad grid structure: 3x3 with blank center
    const moveGrid = [
      [
        { dir: "nw", label: "NW" },
        { dir: "n", label: "N" },
        { dir: "ne", label: "NE" },
      ],
      [{ dir: "w", label: "W" }, null, { dir: "e", label: "E" }],
      [
        { dir: "sw", label: "SW" },
        { dir: "s", label: "S" },
        { dir: "se", label: "SE" },
      ],
    ];

    // Determine if we should use row layout (wide screen)
    const useRowLayout = width >= 900;

    return (
      <View style={styles.combatControl}>
        {/* Header */}
        <View style={styles.combatControlHeader}>
          <Text style={styles.combatControlTitle}>Combat Control</Text>
          <Text style={styles.combatControlInfo}>
            Round: {combat.round} | Turn: {currentTurnActor?.name || currentTurnActorId || "Unknown"}
          </Text>
          {distance !== null && <Text style={styles.combatControlInfo}>Distance: {distance}</Text>}
          <View style={styles.combatControlStats}>
            <Text style={styles.combatControlStat}>
              PC_1: HP {pcHp} / RF {pcFatigue}
            </Text>
            <Text style={styles.combatControlStat}>
              NPC_DUMMY: HP {npcHp} / RF {npcFatigue}
            </Text>
          </View>
        </View>

        {/* Controls Row: MovePad + Attacks */}
        <View style={[styles.controlsRow, useRowLayout && styles.controlsRowHorizontal]}>
          {/* MovePad */}
          <View style={styles.movePadContainer}>
            <Text style={styles.movePadTitle}>Move</Text>
            <View style={styles.movePadGrid}>
              {moveGrid.map((row, rowIndex) => (
                <View key={rowIndex} style={styles.movePadRow}>
                  {row.map((move, colIndex) => {
                    if (move === null) {
                      return <View key={`center-${rowIndex}-${colIndex}`} style={styles.movePadCell} />;
                    }
                    const moveChoice = combatChoices.find((c) => c.id === `combat_move_${move.dir}`);
                    const disabled = !isPlayerTurn || hasMoved;
                    const disabledReason = !isPlayerTurn ? "Not your turn" : hasMoved ? "Already moved" : "";

                    return (
                      <View key={move.dir} style={styles.movePadCell}>
                        <Pressable
                          style={[styles.movePadButton, disabled && styles.movePadButtonDisabled]}
                          onPress={() => !disabled && moveChoice && handleChoice(moveChoice.id)}
                          disabled={disabled}
                        >
                          <Text style={[styles.movePadButtonText, disabled && styles.movePadButtonTextDisabled]}>
                            {move.label}
                          </Text>
                        </Pressable>
                        {disabled && disabledReason && <Text style={styles.movePadReason}>{disabledReason}</Text>}
                      </View>
                    );
                  })}
                </View>
              ))}
            </View>
          </View>

          {/* Attack Buttons */}
          <View style={styles.attackButtonsContainer}>
            <Text style={styles.attackButtonsTitle}>Attacks</Text>
            {meleeChoice && (
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[
                    styles.attackButton,
                    (!isPlayerTurn || hasAttacked || !canMelee) && styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (isPlayerTurn && !hasAttacked && canMelee) {
                      handleChoice(meleeChoice.id);
                    }
                  }}
                  disabled={!isPlayerTurn || hasAttacked || !canMelee}
                >
                  <Text
                    style={[
                      styles.attackButtonText,
                      (!isPlayerTurn || hasAttacked || !canMelee) && styles.attackButtonTextDisabled,
                    ]}
                  >
                    Melee attack
                  </Text>
                </Pressable>
                {(!isPlayerTurn || hasAttacked || !canMelee) && (
                  <Text style={styles.attackButtonReason}>
                    {!isPlayerTurn
                      ? "Not your turn"
                      : hasAttacked
                      ? "Already attacked"
                      : !canMelee
                      ? "Requires melee range"
                      : ""}
                  </Text>
                )}
              </View>
            )}
            {rangedLongChoice && (
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[
                    styles.attackButton,
                    (!isPlayerTurn || hasAttacked || !canRanged) && styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (isPlayerTurn && !hasAttacked && canRanged) {
                      handleChoice(rangedLongChoice.id);
                    }
                  }}
                  disabled={!isPlayerTurn || hasAttacked || !canRanged}
                >
                  <Text
                    style={[
                      styles.attackButtonText,
                      (!isPlayerTurn || hasAttacked || !canRanged) && styles.attackButtonTextDisabled,
                    ]}
                  >
                    Ranged (LONG + cover)
                  </Text>
                </Pressable>
                {(!isPlayerTurn || hasAttacked || !canRanged) && (
                  <Text style={styles.attackButtonReason}>
                    {!isPlayerTurn
                      ? "Not your turn"
                      : hasAttacked
                      ? "Already attacked"
                      : !canRanged
                      ? distance !== null && distance <= 1
                        ? "In melee"
                        : "Out of range"
                      : ""}
                  </Text>
                )}
              </View>
            )}
            {rangedCalledChoice && (
              <View style={styles.attackButtonItem}>
                <Pressable
                  style={[
                    styles.attackButton,
                    (!isPlayerTurn || hasAttacked || !canRanged) && styles.attackButtonDisabled,
                  ]}
                  onPress={() => {
                    if (isPlayerTurn && !hasAttacked && canRanged) {
                      handleChoice(rangedCalledChoice.id);
                    }
                  }}
                  disabled={!isPlayerTurn || hasAttacked || !canRanged}
                >
                  <Text
                    style={[
                      styles.attackButtonText,
                      (!isPlayerTurn || hasAttacked || !canRanged) && styles.attackButtonTextDisabled,
                    ]}
                  >
                    Called shot (SHORT)
                  </Text>
                </Pressable>
                {(!isPlayerTurn || hasAttacked || !canRanged) && (
                  <Text style={styles.attackButtonReason}>
                    {!isPlayerTurn
                      ? "Not your turn"
                      : hasAttacked
                      ? "Already attacked"
                      : !canRanged
                      ? distance !== null && distance <= 1
                        ? "In melee"
                        : "Out of range"
                      : ""}
                  </Text>
                )}
              </View>
            )}
          </View>
        </View>

        {/* End Turn Button */}
        {isPlayerTurn && (
          <View style={styles.endTurnContainer}>
            <Pressable style={styles.endTurnButton} onPress={() => handleChoice("combat_end_turn")}>
              <Text style={styles.endTurnButtonText}>End Turn</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  // Get combat narration from combatLog (turn-scoped: only current turn)
  const combatLog = save.runtime.combatLog || [];
  const turnStartIndex = save.runtime.combatTurnStartIndex ?? 0;
  // Clamp turnStartIndex to valid range in case log was trimmed
  const safeStart = Math.min(turnStartIndex, combatLog.length);
  const combatNarration = combatLog.slice(safeStart);

  // Determine which scene the combat narration belongs to
  const narrationSceneId = save.runtime.combatLogSceneId ?? combat?.startedBySceneId;
  const showNarration = narrationSceneId && narrationSceneId === save.runtime.currentSceneId;

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
        {showNarration && (
          <View style={styles.combatNarration}>
            <Text style={styles.combatNarrationTitle}>
              Combat Narration [DEBUG: combatLog.length={combatLog.length}, turnStartIndex={turnStartIndex}]
            </Text>
            {combatNarration.length > 0 ? (
              combatNarration.map((entry, index) => (
                <Text key={index} style={styles.combatNarrationText}>
                  {entry}
                </Text>
              ))
            ) : (
              <Text style={styles.combatNarrationText}>Il combattimento è iniziato.</Text>
            )}
          </View>
        )}

        {/* CombatControl Panel */}
        <CombatControl />

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
        {nonCombatChoices.length > 0 && (
          <View style={styles.choicesContainer}>
            <Text style={styles.choicesTitle}>Choices:</Text>
            {nonCombatChoices.map((choice) => (
              <Pressable key={choice.id} style={styles.choiceButton} onPress={() => handleChoice(choice.id)}>
                <Text style={styles.choiceText}>{choice.label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {(() => {
          // Prefer lastPlayerCheck for player combat checks, fallback to lastCheck
          const checkToShow = save.runtime.lastPlayerCheck || save.runtime.lastCheck;
          if (!checkToShow) return null;
          const checkTags = checkToShow.tags || [];
          return (
            <View style={styles.checkInfo}>
              <Text style={styles.checkLabel}>Last Check {save.runtime.lastPlayerCheck ? "(Player Combat)" : ""}:</Text>
              <Text style={styles.checkText}>
                Roll: {checkToShow.roll} vs Target: {checkToShow.target}
              </Text>
              <Text style={styles.checkText}>{checkToShow.success ? "✓ Success" : "✗ Failure"}</Text>
              <Text style={styles.checkText}>
                DoS: {checkToShow.dos} | DoF: {checkToShow.dof}
              </Text>
              {checkToShow.critical !== "none" && (
                <Text style={styles.checkText}>Critical: {checkToShow.critical}</Text>
              )}

              {/* Target breakdown (debug UI) */}
              {(() => {
                const calcTags = checkTags.filter((t) => t.startsWith("calc:"));
                const attCalcTags = tags.filter((t) => t.startsWith("att:calc:"));
                const defCalcTags = tags.filter((t) => t.startsWith("def:calc:"));

                if (calcTags.length > 0 || attCalcTags.length > 0) {
                  return (
                    <View style={styles.breakdownContainer}>
                      <Text style={styles.breakdownLabel}>Target Breakdown:</Text>
                      {calcTags.length > 0 && (
                        <View>
                          {calcTags.map((tag, idx) => {
                            const [key, value] = tag.split("=");
                            const label = key.replace("calc:", "");
                            return (
                              <Text key={idx} style={styles.breakdownText}>
                                {label}: {value}
                              </Text>
                            );
                          })}
                        </View>
                      )}
                      {attCalcTags.length > 0 && (
                        <View style={styles.breakdownSection}>
                          <Text style={styles.breakdownSubLabel}>Attacker:</Text>
                          {attCalcTags.map((tag, idx) => {
                            const [key, value] = tag.split("=");
                            const label = key.replace("att:calc:", "");
                            return (
                              <Text key={idx} style={styles.breakdownText}>
                                {label}: {value}
                              </Text>
                            );
                          })}
                        </View>
                      )}
                      {defCalcTags.length > 0 && (
                        <View style={styles.breakdownSection}>
                          <Text style={styles.breakdownSubLabel}>Defender:</Text>
                          {defCalcTags.map((tag, idx) => {
                            const [key, value] = tag.split("=");
                            const label = key.replace("def:calc:", "");
                            return (
                              <Text key={idx} style={styles.breakdownText}>
                                {label}: {value}
                              </Text>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  );
                }
                return null;
              })()}

              {/* Combat Debug (debug UI) */}
              {(() => {
                const combatTags = checkTags.filter((t) => t.startsWith("combat:"));

                if (combatTags.length > 0) {
                  // Extract key combat values
                  const getCombatValue = (prefix: string): string | null => {
                    const tag = combatTags.find((t) => t.startsWith(`combat:${prefix}=`));
                    return tag ? tag.split("=")[1] : null;
                  };

                  const attackStat = getCombatValue("attackStat");
                  const attackTarget = getCombatValue("attackTarget");
                  const attackRoll = getCombatValue("attackRoll");
                  const attackDoS = getCombatValue("attackDoS");
                  const defense = getCombatValue("defense");
                  const defTarget = getCombatValue("defTarget");
                  const defRoll = getCombatValue("defRoll");
                  const defDoS = getCombatValue("defDoS");
                  const defSuccess = getCombatValue("defSuccess");
                  const tie = combatTags.some((t) => t === "combat:tie=1");

                  return (
                    <View style={styles.breakdownContainer}>
                      <Text style={styles.breakdownLabel}>Combat Debug:</Text>
                      {attackStat && <Text style={styles.breakdownText}>Attack Stat: {attackStat}</Text>}
                      {attackTarget && <Text style={styles.breakdownText}>Attack Target: {attackTarget}</Text>}
                      {attackRoll && <Text style={styles.breakdownText}>Attack Roll: {attackRoll}</Text>}
                      {attackDoS !== null && <Text style={styles.breakdownText}>Attack DoS: {attackDoS}</Text>}
                      {defense && <Text style={styles.breakdownText}>Defense: {defense}</Text>}
                      {defTarget && <Text style={styles.breakdownText}>Defense Target: {defTarget}</Text>}
                      {defRoll && <Text style={styles.breakdownText}>Defense Roll: {defRoll}</Text>}
                      {defDoS !== null && <Text style={styles.breakdownText}>Defense DoS: {defDoS}</Text>}
                      {defSuccess && (
                        <Text style={styles.breakdownText}>Defense Success: {defSuccess === "1" ? "Yes" : "No"}</Text>
                      )}
                      {tie && <Text style={styles.breakdownText}>Tie: Yes (Defender wins)</Text>}
                    </View>
                  );
                }
                return null;
              })()}

              {checkTags.length > 0 && (
                <View style={styles.breakdownContainer}>
                  <Text style={styles.breakdownLabel}>Tags:</Text>
                  {checkTags.map((t, i) => (
                    <Text key={i} style={styles.breakdownText}>
                      {t}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })()}
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
});
