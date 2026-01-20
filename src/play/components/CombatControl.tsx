import { View, Text, Pressable } from "react-native";
import type { GameSave, Choice, Effect, StoryPack, Direction8 } from "@eg/engine";
import { hasUnlockedAction, loadCharacterCatalogs, getLearnedSpells } from "@eg/engine";
import { CombatUiModel } from "../hooks/useCombatUiModel";
import { useMemo, useState } from "react";
import { SpellPickerModal } from "./SpellPickerModal";

interface CombatControlProps {
  model: CombatUiModel | undefined;
  save: GameSave;
  combatChoices: Choice[];
  handleChoice: (choiceId: string) => void;
  applySystemEffects: (effects: Effect[]) => void;
  storyPack?: StoryPack;
  width: number;
  styles: any;
  onSpellTargetSelect: (spellId: string) => void;
  targetingInfo?: {
    spellName: string;
    previewValid: boolean;
    reason?: string;
    requiresDirection?: boolean;
    direction?: Direction8;
  };
  onTargetDirection?: (dir: Direction8) => void;
  onTargetConfirm?: () => void;
  onTargetCancel?: () => void;
}

// Called Shot zone type
type CalledShotZone = "head" | "arms" | "body" | "legs";

export function CombatControl({
  model,
  save,
  combatChoices,
  handleChoice,
  applySystemEffects,
  storyPack,
  width,
  styles,
  onSpellTargetSelect,
  targetingInfo,
  onTargetDirection,
  onTargetConfirm,
  onTargetCancel,
}: CombatControlProps) {
  const [spellPickerVisible, setSpellPickerVisible] = useState(false);
  const [activeSection, setActiveSection] = useState<"movement" | "attacks" | "stance" | "magic">("movement");
  const [calledShotPickerVisible, setCalledShotPickerVisible] = useState(false);
  const [pendingCalledShotMode, setPendingCalledShotMode] = useState<"MELEE" | "RANGED" | null>(null);
  const [calledShotWeaponId, setCalledShotWeaponId] = useState<string | null>(null);
  const [weaponPickerVisible, setWeaponPickerVisible] = useState(false);
  const [weaponPickerOptions, setWeaponPickerOptions] = useState<Array<{ id: string | null; name: string }>>([]);
  const [weaponPickerContext, setWeaponPickerContext] = useState<{
    kind: "melee" | "ranged" | "calledShot" | "swift";
    mode: "MELEE" | "RANGED";
  } | null>(null);

  if (!model || !model.isCombatActive) return null;

  const combat = save.runtime.combat;

  // Load catalogs for action unlock checks
  const catalogs = useMemo(() => {
    if (!storyPack?.skills && !storyPack?.talents && !storyPack?.traits) return undefined;
    return loadCharacterCatalogs({
      id: storyPack.id,
      weapons: storyPack.weapons || [],
      armors: storyPack.armors || [],
      skills: storyPack.skills || [],
      talents: storyPack.talents || [],
      traits: storyPack.traits || [],
    });
  }, [storyPack]);

  // Check if actions are unlocked
  const hasDisarmUnlock = catalogs
    ? hasUnlockedAction(save, catalogs, save.party.activeActorId, "combat:disarm")
    : false;
  const hasKnockdownUnlock = catalogs
    ? hasUnlockedAction(save, catalogs, save.party.activeActorId, "combat:knockdown")
    : true; // Default to true if no catalogs (backward compatibility)
  const hasSwiftAttackUnlock = catalogs
    ? hasUnlockedAction(save, catalogs, save.party.activeActorId, "combat:swiftAttack")
    : false;
  const hasMagicUnlock = catalogs ? hasUnlockedAction(save, catalogs, save.party.activeActorId, "magic:cast") : false;
  const hasCalledShotUnlock = catalogs
    ? hasUnlockedAction(save, catalogs, save.party.activeActorId, "combat:calledShot")
    : false;

  const activeActor = save.actorsById[save.party.activeActorId];
  const mainWeaponId = activeActor?.equipment?.mainHand?.kind === "weapon" ? activeActor.equipment.mainHand.id : null;
  const offWeaponId = activeActor?.equipment?.offHand?.kind === "weapon" ? activeActor.equipment.offHand.id : null;
  const mainWeapon = mainWeaponId ? save.weaponsById?.[mainWeaponId] : null;
  const offWeapon = offWeaponId ? save.weaponsById?.[offWeaponId] : null;
  const hasTwoWeaponWielder = (activeActor?.talents?.["talent:two_weapon_wielder"] ?? 0) > 0;

  const getWeaponOptionsForMode = (mode: "MELEE" | "RANGED") => {
    const options: Array<{ id: string | null; name: string }> = [];
    if (mode === "MELEE") {
      if (mainWeaponId) options.push({ id: mainWeaponId, name: mainWeapon?.name || mainWeaponId });
      if (offWeaponId) options.push({ id: offWeaponId, name: offWeapon?.name || offWeaponId });
    } else {
      if (mainWeaponId && mainWeapon?.kind === "RANGED") {
        options.push({ id: mainWeaponId, name: mainWeapon?.name || mainWeaponId });
      }
      if (offWeaponId && offWeapon?.kind === "RANGED") {
        options.push({ id: offWeaponId, name: offWeapon?.name || offWeaponId });
      }
    }
    return options;
  };

  const openWeaponPicker = (kind: "melee" | "ranged" | "calledShot" | "swift", mode: "MELEE" | "RANGED") => {
    const options = getWeaponOptionsForMode(mode);
    setWeaponPickerOptions(options);
    setWeaponPickerContext({ kind, mode });
    setWeaponPickerVisible(true);
  };

  const applyAttackWithWeapon = (
    kind: "melee" | "ranged" | "calledShot" | "swift",
    mode: "MELEE" | "RANGED",
    weaponId: string | null
  ) => {
    if (!model.selectedTargetId) return;
    if (kind === "swift") {
      applySystemEffects([
        {
          op: "combatSwiftAttack",
          attackerId: save.party.activeActorId,
          defenderId: model.selectedTargetId,
          weaponId,
        },
      ]);
      return;
    }
    if (kind === "calledShot") {
      setCalledShotWeaponId(weaponId);
      setPendingCalledShotMode(mode);
      setCalledShotPickerVisible(true);
      return;
    }
    applySystemEffects([
      {
        op: "combatRequestAttack",
        attackerId: save.party.activeActorId,
        defenderId: model.selectedTargetId,
        mode,
        weaponId,
      },
    ]);
  };
  // Get learned spells
  const learnedSpells = catalogs ? getLearnedSpells(save, save.party.activeActorId, catalogs) : [];
  const hasLearnedSpells = learnedSpells.length > 0;

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

  const moveDirToDirection8: Record<string, Direction8> = {
    n: "N",
    ne: "NE",
    e: "E",
    se: "SE",
    s: "S",
    sw: "SW",
    w: "W",
    nw: "NW",
  };

  // Determine if we should use row layout (wide screen)
  const useRowLayout = width >= 900;
  // Determine if we should stack attacks and stance vertically (narrow screen)
  const useNarrowLayout = width < 600;
  const isPhone = width < 420;

  const SectionHeader = ({ id, title }: { id: "movement" | "attacks" | "stance" | "magic"; title: string }) => (
    <Pressable
      style={{
        marginTop: 8,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: activeSection === id ? "#e8f2ff" : "#f3f4f6",
        borderWidth: 1,
        borderColor: activeSection === id ? "#4a90e2" : "#e5e7eb",
      }}
      onPress={() => setActiveSection(id)}
    >
      <Text style={{ fontWeight: "800", color: "#111827", fontSize: isPhone ? 16 : 14 }}>{title}</Text>
    </Pressable>
  );

  return (
    <View style={styles.combatControl}>
      {/* Header */}
      <View style={styles.combatControlHeader}>
        <Text style={styles.combatControlTitle}>Combat Control</Text>
        <Text style={styles.combatControlInfo}>
          Round: {combat?.round ?? 0} | Turn: {model.currentTurnActor?.name || model.currentTurnActorId || "Unknown"}
        </Text>
        {model.distance !== null && <Text style={styles.combatControlInfo}>Distance: {model.distance}</Text>}
        {model.isPlayerTurn && (
          <View style={styles.combatControlEconomy}>
            <Text style={styles.combatControlEconomyText}>
              Move: {model.moveRemaining}/{model.agiBonus} | Action: {model.actionAvailable ? "Available" : "Spent"} |
              Stance: {model.stance}
            </Text>
          </View>
        )}
      </View>

      {/* A) Movement, Attacks, and Stance Blocks */}
      {model.isPlayerTurn && (
        <View style={[styles.mainRow, useNarrowLayout && styles.mainRowNarrow]}>
          {/* Movement Block */}
          <View style={[styles.combatBlock, styles.movementBlock, isPhone && { padding: 10 }]}>
            {isPhone ? (
              <SectionHeader id="movement" title="Movement" />
            ) : (
              <Text style={styles.combatBlockTitle}>Movement</Text>
            )}
            {(!isPhone || activeSection === "movement") && (
              <View style={styles.movePadContainer}>
                <View style={styles.movePadGrid}>
                  {moveGrid.map((row, rowIndex) => (
                    <View key={rowIndex} style={styles.movePadRow}>
                      {row.map((move, colIndex) => {
                        if (move === null) {
                          return <View key={`center-${rowIndex}-${colIndex}`} style={styles.movePadCell} />;
                        }

                        return (
                          <View key={move.dir} style={styles.movePadCell}>
                            <Pressable
                              style={[styles.movePadButton, !model.canMove && styles.movePadButtonDisabled]}
                              onPress={() => {
                                if (model.canMove) {
                                  applySystemEffects([
                                    {
                                      op: "combatMove",
                                      dir: move.dir.toUpperCase() as "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW",
                                      actorId: save.party.activeActorId,
                                    },
                                  ]);
                                }
                              }}
                              disabled={!model.canMove}
                            >
                              <Text
                                style={[styles.movePadButtonText, !model.canMove && styles.movePadButtonTextDisabled]}
                              >
                                {move.label}
                              </Text>
                            </Pressable>
                            {!model.canMove && model.moveDisabledReason && (
                              <Text style={styles.movePadReason}>{model.moveDisabledReason}</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  ))}
                </View>
                {/* Movement Actions */}
                <View style={styles.movementActions}>
                  <Pressable
                    style={[styles.movementActionButton, model.moveRemaining <= 0 && styles.attackButtonDisabled]}
                    onPress={() => {
                      if (model.moveRemaining > 0) {
                        const hasProne = model.pcActor?.conditions?.prone;
                        if (hasProne) {
                          applySystemEffects([{ op: "combatStandUp", actorId: save.party.activeActorId }]);
                        } else {
                          applySystemEffects([{ op: "combatGetProne", actorId: save.party.activeActorId }]);
                        }
                      }
                    }}
                    disabled={model.moveRemaining <= 0}
                  >
                    <Text
                      style={[styles.movementActionText, model.moveRemaining <= 0 && styles.attackButtonTextDisabled]}
                    >
                      {model.pcActor?.conditions?.prone ? "Stand Up" : "Get Prone"}
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[styles.movementActionButton, model.moveRemaining <= 0 && styles.attackButtonDisabled]}
                    onPress={() => {
                      if (model.moveRemaining > 0) {
                        applySystemEffects([{ op: "combatPickup", actorId: save.party.activeActorId }]);
                      }
                    }}
                    disabled={model.moveRemaining <= 0}
                  >
                    <Text
                      style={[styles.movementActionText, model.moveRemaining <= 0 && styles.attackButtonTextDisabled]}
                    >
                      Pickup
                    </Text>
                  </Pressable>
                </View>
              </View>
            )}
          </View>
          {/* Attacks Block - Contains Melee and Ranged sections */}
          <View style={[styles.combatBlock, styles.attacksBlock, isPhone && { padding: 10 }]}>
            {isPhone ? (
              <SectionHeader id="attacks" title="Attacks" />
            ) : (
              <Text style={styles.combatBlockTitle}>Attacks</Text>
            )}
            {(!isPhone || activeSection === "attacks") && (
              <>
                {/* Melee Attacks Section */}
                <View style={styles.attackSection}>
                  <Text style={styles.attackSectionTitle}>Melee Attacks</Text>
                  {model.meleeChoice && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          (model.meleeDisabled || !model.selectedTargetId) && styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (!model.meleeDisabled && model.selectedTargetId) {
                            const options = getWeaponOptionsForMode("MELEE");
                            if (!hasTwoWeaponWielder && options.length > 1) {
                              openWeaponPicker("melee", "MELEE");
                            } else {
                              const chosen = options[0]?.id ?? null;
                              applyAttackWithWeapon("melee", "MELEE", chosen);
                            }
                          }
                        }}
                        disabled={model.meleeDisabled || !model.selectedTargetId}
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (model.meleeDisabled || !model.selectedTargetId) && styles.attackButtonTextDisabled,
                          ]}
                        >
                          Melee Attack
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  <View style={styles.attackButtonItem}>
                    <Pressable
                      style={[styles.attackButton, model.allOutDisabled && styles.attackButtonDisabled]}
                      onPress={() => {
                        if (!model.allOutDisabled && model.selectedTargetId) {
                          applySystemEffects([{ op: "combatAllOut", targetId: model.selectedTargetId }]);
                        }
                      }}
                      disabled={model.allOutDisabled}
                    >
                      <Text style={[styles.attackButtonText, model.allOutDisabled && styles.attackButtonTextDisabled]}>
                        All-Out Attack
                      </Text>
                    </Pressable>
                  </View>
                  {hasKnockdownUnlock && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                            styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (model.actionAvailable && model.canMelee && model.selectedTargetId) {
                            applySystemEffects([
                              {
                                op: "combatKnockdown",
                                attackerId: save.party.activeActorId,
                                defenderId: model.selectedTargetId,
                              },
                            ]);
                          }
                        }}
                        disabled={!model.actionAvailable || !model.canMelee || !model.selectedTargetId}
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                              styles.attackButtonTextDisabled,
                          ]}
                        >
                          Knockdown
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  {hasSwiftAttackUnlock && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                            styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (model.actionAvailable && model.canMelee && model.selectedTargetId) {
                            const options = getWeaponOptionsForMode("MELEE");
                            if (!hasTwoWeaponWielder && options.length > 1) {
                              openWeaponPicker("swift", "MELEE");
                            } else {
                              const chosen = options[0]?.id ?? null;
                              applyAttackWithWeapon("swift", "MELEE", chosen);
                            }
                          }
                        }}
                        disabled={!model.actionAvailable || !model.canMelee || !model.selectedTargetId}
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                              styles.attackButtonTextDisabled,
                          ]}
                        >
                          Swift Attack
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  {hasDisarmUnlock && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          (!model.actionAvailable ||
                            !model.canMelee ||
                            !model.selectedTargetId ||
                            !model.npcWeapon?.weapon) &&
                            styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (
                            model.actionAvailable &&
                            model.canMelee &&
                            model.selectedTargetId &&
                            model.npcWeapon?.weapon
                          ) {
                            applySystemEffects([
                              {
                                op: "combatDisarm",
                                attackerId: save.party.activeActorId,
                                defenderId: model.selectedTargetId,
                              },
                            ]);
                          }
                        }}
                        disabled={
                          !model.actionAvailable ||
                          !model.canMelee ||
                          !model.selectedTargetId ||
                          !model.npcWeapon?.weapon
                        }
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (!model.actionAvailable ||
                              !model.canMelee ||
                              !model.selectedTargetId ||
                              !model.npcWeapon?.weapon) &&
                              styles.attackButtonTextDisabled,
                          ]}
                        >
                          Disarm
                        </Text>
                      </Pressable>
                    </View>
                  )}
                  {/* Called Shot (Melee) - only shows if talent is unlocked */}
                  {hasCalledShotUnlock && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          styles.calledShotButton,
                          (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                            styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (model.actionAvailable && model.canMelee && model.selectedTargetId) {
                            const options = getWeaponOptionsForMode("MELEE");
                            if (!hasTwoWeaponWielder && options.length > 1) {
                              openWeaponPicker("calledShot", "MELEE");
                            } else {
                              const chosen = options[0]?.id ?? null;
                              setCalledShotWeaponId(chosen);
                              setPendingCalledShotMode("MELEE");
                              setCalledShotPickerVisible(true);
                            }
                          }
                        }}
                        disabled={!model.actionAvailable || !model.canMelee || !model.selectedTargetId}
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (!model.actionAvailable || !model.canMelee || !model.selectedTargetId) &&
                              styles.attackButtonTextDisabled,
                          ]}
                        >
                          Called Shot (Melee)
                        </Text>
                      </Pressable>
                      <Text style={styles.calledShotHint}>Target specific body part</Text>
                    </View>
                  )}
                </View>

                {/* Ranged Attacks Section */}
                <View style={styles.attackSection}>
                  <Text style={styles.attackSectionTitle}>Ranged Attacks</Text>
                  <View style={styles.attackButtonItem}>
                    <Pressable
                      style={[
                        styles.attackButton,
                        (model.rangedDisabled || !model.selectedTargetId) && styles.attackButtonDisabled,
                      ]}
                      onPress={() => {
                        if (!model.rangedDisabled && model.selectedTargetId) {
                          const options = getWeaponOptionsForMode("RANGED");
                          if (!hasTwoWeaponWielder && options.length > 1) {
                            openWeaponPicker("ranged", "RANGED");
                          } else {
                            const chosen = options[0]?.id ?? null;
                            applyAttackWithWeapon("ranged", "RANGED", chosen);
                          }
                        }
                      }}
                      disabled={model.rangedDisabled || !model.selectedTargetId}
                    >
                      <Text
                        style={[
                          styles.attackButtonText,
                          (model.rangedDisabled || !model.selectedTargetId) && styles.attackButtonTextDisabled,
                        ]}
                      >
                        Ranged Attack
                      </Text>
                    </Pressable>
                    {model.rangedDisabled && model.rangedDisabledReason && (
                      <Text style={styles.attackButtonReason}>{model.rangedDisabledReason}</Text>
                    )}
                  </View>
                  {/* Called Shot - only shows if talent is unlocked */}
                  {hasCalledShotUnlock && (
                    <View style={styles.attackButtonItem}>
                      <Pressable
                        style={[
                          styles.attackButton,
                          styles.calledShotButton,
                          (!model.actionAvailable || !model.selectedTargetId) && styles.attackButtonDisabled,
                        ]}
                        onPress={() => {
                          if (model.actionAvailable && model.selectedTargetId) {
                            const options = getWeaponOptionsForMode("RANGED");
                            if (!hasTwoWeaponWielder && options.length > 1) {
                              openWeaponPicker("calledShot", "RANGED");
                            } else {
                              const chosen = options[0]?.id ?? null;
                              setCalledShotWeaponId(chosen);
                              setPendingCalledShotMode("RANGED");
                              setCalledShotPickerVisible(true);
                            }
                          }
                        }}
                        disabled={!model.actionAvailable || !model.selectedTargetId}
                      >
                        <Text
                          style={[
                            styles.attackButtonText,
                            (!model.actionAvailable || !model.selectedTargetId) && styles.attackButtonTextDisabled,
                          ]}
                        >
                          Called Shot (Ranged)
                        </Text>
                      </Pressable>
                      <Text style={styles.calledShotHint}>Target specific body part</Text>
                    </View>
                  )}
                </View>
              </>
            )}
          </View>

          {/* Stance Block */}
          <View style={[styles.combatBlock, styles.stanceBlock, isPhone && { padding: 10 }]}>
            {isPhone ? (
              <SectionHeader id="stance" title="Stance" />
            ) : (
              <Text style={styles.combatBlockTitle}>Stance</Text>
            )}
            {(!isPhone || activeSection === "stance") && (
              <View style={styles.stanceActions}>
                <Pressable
                  style={[styles.stanceButton, !model.actionAvailable && styles.attackButtonDisabled]}
                  onPress={() => {
                    if (model.actionAvailable) {
                      applySystemEffects([{ op: "combatDefend" }]);
                    }
                  }}
                  disabled={!model.actionAvailable}
                >
                  <Text style={[styles.stanceButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                    Defend
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.stanceButton, !model.actionAvailable && styles.attackButtonDisabled]}
                  onPress={() => {
                    if (model.actionAvailable) {
                      applySystemEffects([{ op: "combatAim" }]);
                    }
                  }}
                  disabled={!model.actionAvailable}
                >
                  <Text style={[styles.stanceButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                    Aim
                  </Text>
                </Pressable>
              </View>
            )}
          </View>

          {/* Magic Block */}
          <View style={[styles.combatBlock, styles.magicBlock, isPhone && { padding: 10 }]}>
            {isPhone ? <SectionHeader id="magic" title="Magic" /> : <Text style={styles.combatBlockTitle}>Magic</Text>}
            {(!isPhone || activeSection === "magic") && (
              <>
                <View style={styles.stanceActions}>
                  <Pressable
                    style={[styles.stanceButton, !model.actionAvailable && styles.attackButtonDisabled]}
                    onPress={() => {
                      if (model.actionAvailable) {
                        applySystemEffects([{ op: "combatChannel", actorId: save.party.activeActorId }]);
                      }
                    }}
                    disabled={!model.actionAvailable}
                  >
                    <Text style={[styles.stanceButtonText, !model.actionAvailable && styles.attackButtonTextDisabled]}>
                      Channel
                    </Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.stanceButton,
                      (!hasMagicUnlock || !hasLearnedSpells || !model.actionAvailable) && styles.attackButtonDisabled,
                    ]}
                    onPress={() => {
                      if (hasMagicUnlock && hasLearnedSpells) {
                        setSpellPickerVisible(true);
                      }
                    }}
                    disabled={!hasMagicUnlock || !hasLearnedSpells || !model.actionAvailable}
                  >
                    <Text
                      style={[
                        styles.attackButtonText,
                        (!hasMagicUnlock || !hasLearnedSpells) && styles.attackButtonTextDisabled,
                      ]}
                    >
                      Cast Spell
                    </Text>
                  </Pressable>
                  {!hasMagicUnlock && (
                    <Text style={{ fontSize: 10, color: "#ff6b6b", marginTop: 4 }}>Richiede tratto magico</Text>
                  )}
                  {hasMagicUnlock && !hasLearnedSpells && (
                    <Text style={{ fontSize: 10, color: "#ff6b6b", marginTop: 4 }}>Nessun incantesimo imparato</Text>
                  )}
                </View>
                {targetingInfo && (
                  <View
                    style={{
                      marginTop: 10,
                      padding: 10,
                      borderRadius: 8,
                      backgroundColor: "#eef2ff",
                      gap: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: "#111827" }}>Targeting: {targetingInfo.spellName}</Text>
                    <Text
                      style={{
                        color: targetingInfo.previewValid ? "#16a34a" : "#dc2626",
                        fontSize: 12,
                      }}
                    >
                      {targetingInfo.previewValid
                        ? "Pronto a confermare"
                        : targetingInfo.reason || "Seleziona bersaglio"}
                    </Text>
                    {targetingInfo.requiresDirection && (
                      <View style={{ alignItems: "center", gap: 4 }}>
                        <Text style={{ fontSize: 12, color: "#374151" }}>Direzione</Text>
                        <View style={{ gap: 4 }}>
                          {moveGrid.map((row, rowIdx) => (
                            <View
                              key={`tgt-row-${rowIdx}`}
                              style={{ flexDirection: "row", gap: isPhone ? 3 : 4, justifyContent: "center" }}
                            >
                              {row.map((move, colIdx) => {
                                if (!move) {
                                  const s = isPhone ? 32 : 40;
                                  return <View key={`tgt-empty-${rowIdx}-${colIdx}`} style={{ width: s, height: s }} />;
                                }
                                const dir = moveDirToDirection8[move.dir];
                                const isSelected = targetingInfo.direction === dir;
                                const s = isPhone ? 36 : 44;
                                return (
                                  <Pressable
                                    key={move.dir}
                                    style={{
                                      width: s,
                                      height: s,
                                      borderRadius: 6,
                                      alignItems: "center",
                                      justifyContent: "center",
                                      backgroundColor: isSelected ? "#4a90e2" : "#f0f0f0",
                                      borderWidth: 1,
                                      borderColor: isSelected ? "#2563eb" : "#d1d5db",
                                    }}
                                    onPress={() => onTargetDirection && onTargetDirection(dir)}
                                  >
                                    <Text
                                      style={{
                                        color: isSelected ? "#fff" : "#111827",
                                        fontWeight: "700",
                                        fontSize: isPhone ? 11 : 14,
                                      }}
                                    >
                                      {move.label}
                                    </Text>
                                  </Pressable>
                                );
                              })}
                            </View>
                          ))}
                        </View>
                      </View>
                    )}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Pressable
                        style={{
                          flex: 1,
                          padding: 10,
                          borderRadius: 6,
                          backgroundColor: "#e5e7eb",
                          alignItems: "center",
                        }}
                        onPress={onTargetCancel}
                      >
                        <Text style={{ fontWeight: "700", color: "#111827" }}>Annulla</Text>
                      </Pressable>
                      <Pressable
                        style={{
                          flex: 1,
                          padding: 10,
                          borderRadius: 6,
                          backgroundColor: targetingInfo.previewValid ? "#4a90e2" : "#9ca3af",
                          alignItems: "center",
                        }}
                        disabled={!targetingInfo.previewValid}
                        onPress={onTargetConfirm}
                      >
                        <Text style={{ fontWeight: "700", color: "#fff" }}>Conferma</Text>
                      </Pressable>
                    </View>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      )}

      {/* D) End Turn */}
      {model.isPlayerTurn && (
        <View style={styles.endTurnContainer}>
          <Pressable
            style={styles.endTurnButton}
            onPress={() => {
              applySystemEffects([{ op: "combatEndTurn" }]);
            }}
          >
            <Text style={styles.endTurnButtonText}>End Turn</Text>
          </Pressable>
        </View>
      )}

      {/* Spell Picker Modal */}
      <SpellPickerModal
        visible={spellPickerVisible}
        save={save}
        actorId={save.party.activeActorId}
        actionAvailable={model.actionAvailable}
        onClose={() => setSpellPickerVisible(false)}
        onSelectSpell={(spellId) => {
          onSpellTargetSelect(spellId);
          setSpellPickerVisible(false);
        }}
      />

      {/* Weapon Picker Modal */}
      {weaponPickerVisible && weaponPickerContext && (
        <View style={styles.calledShotModal}>
          <View style={styles.calledShotModalContent}>
            <Text style={styles.calledShotModalTitle}>Choose Weapon</Text>
            <Text style={styles.calledShotModalSubtitle}>
              {weaponPickerContext.mode === "MELEE" ? "Melee Attack" : "Ranged Attack"}
            </Text>

            <View style={styles.calledShotZones}>
              {weaponPickerOptions.map((option) => (
                <Pressable
                  key={option.id ?? "unarmed"}
                  style={styles.calledShotZoneButton}
                  onPress={() => {
                    const weaponId = option.id ?? null;
                    if (weaponPickerContext.kind === "calledShot") {
                      setCalledShotWeaponId(weaponId);
                      setPendingCalledShotMode(weaponPickerContext.mode);
                      setCalledShotPickerVisible(true);
                    } else {
                      applyAttackWithWeapon(weaponPickerContext.kind, weaponPickerContext.mode, weaponId);
                    }
                    setWeaponPickerVisible(false);
                    setWeaponPickerContext(null);
                  }}
                >
                  <Text style={styles.calledShotZoneLabel}>{option.name}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              style={styles.calledShotCancelButton}
              onPress={() => {
                setWeaponPickerVisible(false);
                setWeaponPickerContext(null);
              }}
            >
              <Text style={styles.calledShotCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Called Shot Zone Picker Modal */}
      {calledShotPickerVisible && (
        <View style={styles.calledShotModal}>
          <View style={styles.calledShotModalContent}>
            <Text style={styles.calledShotModalTitle}>Called Shot - Select Target Zone</Text>
            <Text style={styles.calledShotModalSubtitle}>
              {pendingCalledShotMode === "MELEE" ? "Melee Attack" : "Ranged Attack"}
            </Text>

            <View style={styles.calledShotZones}>
              {(["head", "arms", "body", "legs"] as CalledShotZone[]).map((zone) => {
                const zoneInfo: Record<CalledShotZone, { label: string; penalty: string; effect: string }> = {
                  head: { label: "Head", penalty: "-30", effect: "Double damage" },
                  arms: { label: "Arms", penalty: "-20", effect: "Disarm" },
                  body: { label: "Body", penalty: "-20", effect: "Standard" },
                  legs: { label: "Legs", penalty: "-20", effect: "Prone + Halved Move" },
                };
                const info = zoneInfo[zone];
                return (
                  <Pressable
                    key={zone}
                    style={styles.calledShotZoneButton}
                    onPress={() => {
                      if (model.selectedTargetId && pendingCalledShotMode) {
                        applySystemEffects([
                          {
                            op: "combatRequestAttack",
                            attackerId: save.party.activeActorId,
                            defenderId: model.selectedTargetId,
                            mode: pendingCalledShotMode,
                            weaponId: calledShotWeaponId,
                            modifiers: {
                              calledShot: true,
                              calledShotZone: zone,
                            },
                          },
                        ]);
                      }
                      setCalledShotPickerVisible(false);
                      setPendingCalledShotMode(null);
                      setCalledShotWeaponId(null);
                    }}
                  >
                    <Text style={styles.calledShotZoneLabel}>{info.label}</Text>
                    <Text style={styles.calledShotZonePenalty}>{info.penalty} to hit</Text>
                    <Text style={styles.calledShotZoneEffect}>{info.effect}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              style={styles.calledShotCancelButton}
              onPress={() => {
                setCalledShotPickerVisible(false);
                setPendingCalledShotMode(null);
                setCalledShotWeaponId(null);
              }}
            >
              <Text style={styles.calledShotCancelText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
