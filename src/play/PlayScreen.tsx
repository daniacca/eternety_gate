import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  useWindowDimensions,
  Pressable,
  ImageBackground,
  Modal,
} from "react-native";
import {
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
  type CombatAttackCheck,
  buildSpellTargetSpec,
  computeTargetPreview,
  getSpellById,
  getEffectById,
  type TargetSpec,
  type TargetSelection,
  type TargetPreview,
  type Direction8,
  type Position,
  useItem,
  getNaturalAbilityWeaponById,
  spendActorXp,
  type StatKey,
} from "@eg/engine";
import { withCatalogs } from "../storypacks";
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
import { SkillShop } from "./components/SkillShop";
import { StatShop } from "./components/StatShop";
import { useCombatUiModel } from "./hooks/useCombatUiModel";
import { resolveSceneBackground, type BackgroundSourceConfig } from "./story/sceneBackgrounds";

type AutosaveReason = "scene" | "combat" | "progression";

type PlayScreenProps = {
  initialSave: GameSave;
  storyPack: StoryPack;
  contentPack?: ContentPack;
  onAutosave?: (save: GameSave, reasons: AutosaveReason[]) => void;
  onStorySwitch?: (nextStoryId: string, currentSave: GameSave) => void;
  onReturnToHub?: (currentSave: GameSave) => void;
};

export function PlayScreen({
  initialSave,
  storyPack,
  contentPack = sigilContentPack as ContentPack,
  onAutosave,
  onStorySwitch,
  onReturnToHub,
}: PlayScreenProps) {
  const storyPackWithCatalogs = useMemo(() => withCatalogs(storyPack), [storyPack]);

  type ActionTargetingState = {
    kind: "spell" | "item" | "ranged";
    spellId?: string;
    label: string;
    itemRef?: ItemRef;
    weaponId?: string | null;
    modifiers?: CombatAttackCheck["modifiers"];
    targetSpec: TargetSpec;
    selection: Partial<TargetSelection>;
    preview: TargetPreview;
  };
  type EquipmentSlot = "mainHand" | "offHand" | "armor" | "helmet" | "boots" | "cloak" | "necklace" | "ring1" | "ring2";
  type ChoiceResolution = {
    title: string;
    lines: string[];
    pendingSave: GameSave;
  };

  const [save, setSave] = useState<GameSave>(initialSave);
  const [playerSheetVisible, setPlayerSheetVisible] = useState(false);
  const [playerSheetSpellMode, setPlayerSheetSpellMode] = useState(false);
  const [talentShopVisible, setTalentShopVisible] = useState(false);
  const [equipmentVisible, setEquipmentVisible] = useState(false);
  const [skillShopVisible, setSkillShopVisible] = useState(false);
  const [statShopVisible, setStatShopVisible] = useState(false);
  const [actionTargeting, setActionTargeting] = useState<ActionTargetingState | null>(null);
  const [pendingChoice, setPendingChoice] = useState<ChoiceResolution | null>(null);
  const { width, height } = useWindowDimensions();
  const normalizedBaseStatsRef = useRef(false);

  useEffect(() => {
    normalizedBaseStatsRef.current = false;
    setSave(initialSave);
  }, [initialSave]);

  useEffect(() => {
    setPlayerSheetVisible(false);
    setPlayerSheetSpellMode(false);
    setTalentShopVisible(false);
    setEquipmentVisible(false);
    setSkillShopVisible(false);
    setStatShopVisible(false);
    setActionTargeting(null);
    setPendingChoice(null);
  }, [storyPack.id]);

  useEffect(() => {
    if (normalizedBaseStatsRef.current) return;
    const actorEntries = Object.entries(save.actorsById);
    const needsInit = actorEntries.some(([, actor]) => !actor.resources?.baseStats);
    if (!needsInit) {
      normalizedBaseStatsRef.current = true;
      return;
    }
    const updatedActors: GameSave["actorsById"] = {};
    for (const [actorId, actor] of actorEntries) {
      if (actor.resources?.baseStats) {
        updatedActors[actorId] = actor;
        continue;
      }
      updatedActors[actorId] = {
        ...actor,
        resources: {
          ...actor.resources,
          baseStats: { ...actor.stats },
        },
      };
    }
    normalizedBaseStatsRef.current = true;
    commitSave(
      {
        ...save,
        actorsById: {
          ...save.actorsById,
          ...updatedActors,
        },
      },
      save
    );
  }, [save]);

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

  const backgroundConfig: BackgroundSourceConfig = useMemo(
    () => ({
      mode: "asset",
    }),
    [],
  );

  const hasProgressionChange = (prevSave: GameSave, nextSave: GameSave): boolean => {
    const actorIds = new Set([...prevSave.party.actors, ...nextSave.party.actors]);
    const recordChanged = (a: Record<string, any> | undefined, b: Record<string, any> | undefined) => {
      const aKeys = Object.keys(a ?? {});
      const bKeys = Object.keys(b ?? {});
      if (aKeys.length !== bKeys.length) return true;
      return aKeys.some((key) => (a ?? {})[key] !== (b ?? {})[key]);
    };

    for (const actorId of actorIds) {
      const prevActor = prevSave.actorsById[actorId];
      const nextActor = nextSave.actorsById[actorId];
      if (!prevActor || !nextActor) continue;
      if ((prevActor.resources.xp ?? 0) !== (nextActor.resources.xp ?? 0)) return true;
      if (recordChanged(prevActor.talents, nextActor.talents)) return true;
      if (recordChanged(prevActor.skills, nextActor.skills)) return true;
      if (recordChanged(prevActor.spells ?? {}, nextActor.spells ?? {})) return true;
      if (recordChanged(prevActor.stats, nextActor.stats)) return true;
    }
    return false;
  };

  const maybeAutosave = (prevSave: GameSave, nextSave: GameSave) => {
    if (!onAutosave) return;
    const reasons: AutosaveReason[] = [];
    if (prevSave.runtime.currentSceneId !== nextSave.runtime.currentSceneId) {
      reasons.push("scene");
    }
    if (prevSave.runtime.combat?.active && !nextSave.runtime.combat?.active) {
      reasons.push("combat");
    }
    if (hasProgressionChange(prevSave, nextSave)) {
      reasons.push("progression");
    }
    if (reasons.length > 0) {
      onAutosave(nextSave, reasons);
    }
  };

  const commitSave = (nextSave: GameSave, prevSave?: GameSave) => {
    const previous = prevSave ?? save;
    setSave(nextSave);
    maybeAutosave(previous, nextSave);
  };

  const handleChoice = (choiceId: string) => {
    if (pendingChoice) return;
    if (choiceId === "HUB_START_BRUNHOLT") {
      onStorySwitch?.("oneshot_brunholt", save);
      return;
    }
    if (choiceId === "HUB_OPEN_TALENTS") {
      setTalentShopVisible(true);
      return;
    }
    if (choiceId === "HUB_OPEN_SPELLS") {
      setPlayerSheetSpellMode(true);
      setPlayerSheetVisible(true);
      return;
    }
    if (choiceId === "HUB_OPEN_SKILLS") {
      setSkillShopVisible(true);
      return;
    }
    if (choiceId === "HUB_OPEN_STATS") {
      setStatShopVisible(true);
      return;
    }
    const activeScene = storyPackWithCatalogs.scenes.find((entry) => entry.id === save.runtime.currentSceneId);
    const activeChoice = activeScene?.choices.find((entry) => entry.id === choiceId);
    const hasChecks = Boolean(activeChoice?.checks && activeChoice.checks.length > 0);

    if (hasChecks) {
      const cachedCheck = save.runtime.choiceCheckResults?.[choiceId];
      if (cachedCheck) {
        const choiceLabel = choices.find((entry) => entry.id === choiceId)?.label ?? choiceId;
        const lines: string[] = [`Hai scelto: ${choiceLabel}`];
        const matchingCheck = activeChoice?.checks?.find((check) => check.id === cachedCheck.checkId);
        const outcome = cachedCheck.success ? "riuscita" : "fallita";
        const checkLabel = matchingCheck?.id ?? cachedCheck.checkId;

        lines.push(`Prova (${checkLabel}) ${outcome}: d100 ${cachedCheck.roll} contro ${cachedCheck.target}.`);

        const detailLines = cachedCheck.success ? matchingCheck?.successText : matchingCheck?.failureText;
        if (detailLines && detailLines.length > 0) {
          lines.push(...detailLines);
        }
        if (activeChoice?.feedbackText && activeChoice.feedbackText.length > 0) {
          lines.push(...activeChoice.feedbackText);
        }

        setPendingChoice({
          title: "Esito della scelta",
          lines,
          pendingSave: save,
        });
        return;
      }
    }

    const newSave = applyChoice(storyPackWithCatalogs, save, choiceId, contentPack);
    const choiceLabel = choices.find((entry) => entry.id === choiceId)?.label ?? choiceId;

    const lines: string[] = [`Hai scelto: ${choiceLabel}`];
    const nextSceneId = newSave.runtime.currentSceneId;
    const previousSceneId = save.runtime.currentSceneId;
    const nextScene = storyPackWithCatalogs.scenes.find((entry) => entry.id === nextSceneId);

    const resolvedCheck =
      newSave.runtime.choiceCheckResults?.[choiceId] ?? newSave.runtime.lastPlayerCheck ?? newSave.runtime.lastCheck;

    if (resolvedCheck) {
      const outcome = resolvedCheck.success ? "riuscita" : "fallita";
      const previousScene = storyPackWithCatalogs.scenes.find((entry) => entry.id === previousSceneId);
      const previousChoice = previousScene?.choices.find((entry) => entry.id === choiceId);
      const matchingCheck = previousChoice?.checks?.find((check) => check.id === resolvedCheck.checkId);
      const checkLabel = matchingCheck?.id ?? resolvedCheck.checkId;

      lines.push(`Prova (${checkLabel}) ${outcome}: d100 ${resolvedCheck.roll} contro ${resolvedCheck.target}.`);

      const detailLines = resolvedCheck.success ? matchingCheck?.successText : matchingCheck?.failureText;
      if (detailLines && detailLines.length > 0) {
        lines.push(...detailLines);
      }
    }

    if (activeChoice?.feedbackText && activeChoice.feedbackText.length > 0) {
      lines.push(...activeChoice.feedbackText);
    }

    if (!save.runtime.combat?.active && newSave.runtime.combat?.active) {
      lines.push("Inizia un combattimento.");
    }

    if (!hasChecks) {
      const gotoEffect = activeChoice?.effects?.find((effect) => effect.op === "goto");
      if (gotoEffect && "sceneId" in gotoEffect) {
        const targetSceneId = gotoEffect.sceneId;
        const targetScene = storyPackWithCatalogs.scenes.find((entry) => entry.id === targetSceneId);
        lines.push(`Ti dirigi verso ${targetScene?.title ?? targetSceneId}.`);
      }
    }

    if (nextSceneId !== previousSceneId) {
      lines.push(`Si passa a: ${nextScene?.title ?? nextSceneId}.`);
    } else if (lines.length === 1) {
      lines.push("Azione registrata.");
    }

    setPendingChoice({
      title: "Esito della scelta",
      lines,
      pendingSave: newSave,
    });
  };

  const applySystemEffects = (effects: Effect[]) => {
    const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
    let newSave = applyEffects(effects, storyPackWithCatalogs, save, rng, contentPack);

    // Ensure RNG counter is always saved back to the game state
    // This prevents RNG values from being reused
    newSave = {
      ...newSave,
      runtime: {
        ...newSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };

    commitSave(newSave);
  };

  const handleToggleFateProtection = useCallback(
    (actorId: string, active: boolean) => {
      applySystemEffects([{ op: "setFateProtection", actorId, active }]);
    },
    [applySystemEffects],
  );

  const applyItemUse = (itemRef: ItemRef, targetSelection?: TargetSelection) => {
    const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
    const result = useItem(save, save.party.activeActorId, itemRef, {
      storyPack: storyPackWithCatalogs,
      rng,
      targetSelection,
    });
    const updatedSave = {
      ...result.save,
      runtime: {
        ...result.save.runtime,
        rngCounter: rng.getCounter(),
      },
    };
    commitSave(updatedSave);
  };

  const handleTrainSkill = (skillId: string, cost: number) => {
    const actorId = save.party.activeActorId;
    const actor = save.actorsById[actorId];
    if (!actor) return;
    const spendResult = spendActorXp(save, actorId, cost);
    if (spendResult.error) return;
    const currentRank = actor.skills?.[skillId] ?? 0;
    const updatedActor = {
      ...actor,
      skills: {
        ...actor.skills,
        [skillId]: currentRank + 1,
      },
    };
    const updatedSave = {
      ...spendResult.save,
      actorsById: {
        ...spendResult.save.actorsById,
        [actorId]: updatedActor,
      },
    };
    commitSave(updatedSave);
  };

  const handleIncreaseStat = (stat: StatKey, cost: number) => {
    const actorId = save.party.activeActorId;
    const actor = save.actorsById[actorId];
    if (!actor) return;
    const spendResult = spendActorXp(save, actorId, cost);
    if (spendResult.error) return;
    const updatedActorBase = spendResult.save.actorsById[actorId];
    if (!updatedActorBase) return;
    const updatedActor = {
      ...updatedActorBase,
      stats: {
        ...updatedActorBase.stats,
        [stat]: (updatedActorBase.stats[stat] ?? 0) + 1,
      },
    };
    const updatedSave = {
      ...spendResult.save,
      actorsById: {
        ...spendResult.save.actorsById,
        [actorId]: updatedActor,
      },
    };
    commitSave(updatedSave);
  };

  const handleUseItem = (itemRef: ItemRef) => {
    const itemDef = save.itemsById?.[itemRef.id];
    const actionId = itemDef?.consumable?.actionId;
    if (actionId === "item:scroll_cast" && save.runtime.combat?.active) {
      startItemTargeting(itemRef);
      return;
    }
    applyItemUse(itemRef);
  };

  const handleEquipItem = (slot: EquipmentSlot, itemRef: ItemRef) => {
    applySystemEffects([
      {
        op: "combatEquipItem",
        actorId: save.party.activeActorId,
        itemRef,
        slot,
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

  const handleSpawnTestGear = useCallback(() => {
    setSave((currentSave) => {
      const actorId = currentSave.party.activeActorId;
      const actor = currentSave.actorsById[actorId];
      if (!actor) return currentSave;

      const itemsById = currentSave.itemsById ?? {};
      const inventory = actor.inventory ? [...actor.inventory] : [];
      const equipment = actor.equipment ?? {};

      const getQty = (ref: ItemRef) => ref.qty ?? 1;
      const getInventoryQty = (kind: ItemRef["kind"], id: string) =>
        inventory.reduce((total, entry) => {
          if (entry.kind !== kind || entry.id !== id) return total;
          return total + getQty(entry);
        }, 0);
      const isEquipped = (kind: ItemRef["kind"], id: string) =>
        Object.values(equipment).some((entry) => entry && entry.kind === kind && entry.id === id);
      const hasItem = (kind: ItemRef["kind"], id: string) =>
        inventory.some((entry) => entry.kind === kind && entry.id === id) || isEquipped(kind, id);

      const addStackable = (itemId: string, qty: number) => {
        if (qty <= 0) return;
        const def = itemsById[itemId];
        const maxStack = def?.maxStack ?? 1;
        if (maxStack <= 1) {
          for (let i = 0; i < qty; i += 1) {
            inventory.push({ kind: "item", id: itemId });
          }
          return;
        }
        let remaining = qty;
        for (let i = 0; i < inventory.length && remaining > 0; i += 1) {
          const entry = inventory[i];
          if (entry.kind !== "item" || entry.id !== itemId) continue;
          const currentQty = getQty(entry);
          const space = maxStack - currentQty;
          if (space <= 0) continue;
          const add = Math.min(space, remaining);
          remaining -= add;
          inventory[i] = { ...entry, qty: currentQty + add };
        }
        while (remaining > 0) {
          const stackQty = Math.min(maxStack, remaining);
          remaining -= stackQty;
          inventory.push({ kind: "item", id: itemId, qty: stackQty });
        }
      };

      const addIfMissing = (ref: ItemRef) => {
        if (hasItem(ref.kind, ref.id)) return;
        inventory.push(ref);
      };

      addIfMissing({ kind: "weapon", id: "longsword" });
      addIfMissing({ kind: "weapon", id: "greatsword" });
      addIfMissing({ kind: "item", id: "shield:wooden" });
      addIfMissing({ kind: "weapon", id: "shortbow" });
      addIfMissing({ kind: "armor", id: "leather" });
      addIfMissing({ kind: "armor", id: "fullplate" });
      addIfMissing({ kind: "item", id: "ring:clarity" });
      addIfMissing({ kind: "item", id: "ring:aegis" });
      addIfMissing({ kind: "item", id: "necklace:focus" });
      addIfMissing({ kind: "item", id: "cloak:shadow" });
      addIfMissing({ kind: "item", id: "helmet:spiked" });
      addIfMissing({ kind: "item", id: "boots:agility" });
      addIfMissing({ kind: "item", id: "robe:wraithbone" });
      addIfMissing({ kind: "item", id: "necklace:iron" });
      addIfMissing({ kind: "item", id: "cloak:traveler" });
      addIfMissing({ kind: "item", id: "boots:leather" });
      addIfMissing({ kind: "item", id: "helmet:leather" });
      addIfMissing({ kind: "item", id: "scroll:soothe_wounds" });

      const healPotionQty = getInventoryQty("item", "potion:healing");
      const fatiguePotionQty = getInventoryQty("item", "potion:fatigue");
      if (healPotionQty < 2) addStackable("potion:healing", 2 - healPotionQty);
      if (fatiguePotionQty < 2) addStackable("potion:fatigue", 2 - fatiguePotionQty);

      const arrowQty = getInventoryQty("item", "ammo:arrow");
      const desiredArrows = 20;
      if (arrowQty < desiredArrows) {
        addStackable("ammo:arrow", desiredArrows - arrowQty);
      }

      const updatedActor = {
        ...actor,
        inventory,
      };

      return {
        ...currentSave,
        actorsById: {
          ...currentSave.actorsById,
          [actorId]: updatedActor,
        },
      };
    });
  }, []);

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

  const getEnemyTargetIds = (preview: TargetPreview) => {
    const partyIds = new Set(save.party.actors);
    return preview.affectedActorIds.filter((actorId) => {
      const actor = save.actorsById[actorId];
      if (!actor) return false;
      const isParty = partyIds.has(actorId) || actor.kind === "PC";
      return !isParty;
    });
  };

  const buildRangedTargetSpec = (weaponId: string | null): TargetSpec | null => {
    if (!weaponId) return null;
    const actor = save.actorsById[save.party.activeActorId];
    const weapon = save.weaponsById?.[weaponId] || (actor ? getNaturalAbilityWeaponById(actor, weaponId) : null);
    if (!weapon || weapon.kind !== "RANGED") return null;

    const hasSpray = weapon.qualities?.some((q) => q.id === "spray");
    const blastQuality = weapon.qualities?.find((q) => q.id === "blast");
    const blastRank = typeof blastQuality?.rank === "number" ? blastQuality.rank : 1;
    const grid = save.runtime.combat?.grid;
    const rangeSquares = weapon.range ?? (grid ? Math.max(grid.width, grid.height) : 0);

    if (hasSpray) {
      return {
        shape: { kind: "cone", range: rangeSquares, depth: 4 },
        requiresDirection: true,
        requiresActor: true,
      };
    }

    if (blastQuality) {
      return {
        shape: { kind: "radius", range: rangeSquares, radius: blastRank },
        requiresPoint: true,
        requiresActor: true,
      };
    }

    return {
      shape: { kind: "single", range: rangeSquares },
      requiresPoint: true,
      requiresActor: true,
    };
  };

  const startRangedTargeting = (weaponId: string | null, modifiers?: CombatAttackCheck["modifiers"]) => {
    const targetSpec = buildRangedTargetSpec(weaponId);
    const weapon = weaponId ? save.weaponsById?.[weaponId] : null;
    if (!targetSpec || !weapon) return;

    const selection = buildInitialSelection(targetSpec);
    let preview = computeTargetPreview(save, save.party.activeActorId, targetSpec, selection);
    const enemyTargets = getEnemyTargetIds(preview);
    if (targetSpec.requiresActor && enemyTargets.length === 0) {
      preview = { ...preview, valid: false, reason: "no_targets" };
    }

    setActionTargeting({
      kind: "ranged",
      label: weapon.name || "Ranged Attack",
      weaponId,
      modifiers,
      targetSpec,
      selection,
      preview,
    });
  };

  const startSpellTargeting = (spellId: string) => {
    const spell = getSpellById(spellId);
    const effectDef = spell ? getEffectById(spell.effectId) : null;
    if (!spell || !effectDef) return;
    const cnBase = spell.baseCN;
    const targetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
    const selection = buildInitialSelection(targetSpec);
    const preview = computeTargetPreview(save, save.party.activeActorId, targetSpec, selection);
    setActionTargeting({
      kind: "spell",
      spellId,
      label: spell.name,
      targetSpec,
      selection,
      preview,
    });
  };

  const startItemTargeting = (itemRef: ItemRef) => {
    const itemDef = save.itemsById?.[itemRef.id];
    const spellId = itemDef?.consumable?.spellId;
    if (!spellId) return;
    const spell = getSpellById(spellId);
    const effectDef = spell ? getEffectById(spell.effectId) : null;
    if (!spell || !effectDef) return;
    const cnBase = spell.baseCN;
    const targetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
    const selection = buildInitialSelection(targetSpec);
    const preview = computeTargetPreview(save, save.party.activeActorId, targetSpec, selection);
    setActionTargeting({
      kind: "item",
      spellId,
      label: itemDef?.name || spell.name,
      itemRef,
      targetSpec,
      selection,
      preview,
    });
  };

  const handleTargetDirection = (dir: Direction8) => {
    setActionTargeting((current) => {
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
        let preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        if (current.kind === "ranged") {
          const enemyTargets = getEnemyTargetIds(preview);
          if (current.targetSpec.requiresActor && enemyTargets.length === 0) {
            preview = { ...preview, valid: false, reason: "no_targets" };
          }
        }
        return { ...current, selection, preview };
      }
      return current;
    });
  };

  const handleCellTarget = (pos: Position) => {
    setActionTargeting((current) => {
      if (!current) return current;
      const kind = current.targetSpec.shape.kind;
      if (kind === "single") {
        const selection: TargetSelection = { kind: "single", targetPos: pos };
        let preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        if (current.kind === "ranged") {
          const enemyTargets = getEnemyTargetIds(preview);
          if (current.targetSpec.requiresActor && enemyTargets.length === 0) {
            preview = { ...preview, valid: false, reason: "no_targets" };
          }
        }
        return { ...current, selection, preview };
      }
      if (kind === "radius") {
        const selection: TargetSelection = { kind: "radius", centerPos: pos };
        let preview = computeTargetPreview(save, save.party.activeActorId, current.targetSpec, selection);
        if (current.kind === "ranged") {
          const enemyTargets = getEnemyTargetIds(preview);
          if (current.targetSpec.requiresActor && enemyTargets.length === 0) {
            preview = { ...preview, valid: false, reason: "no_targets" };
          }
        }
        return { ...current, selection, preview };
      }
      return current;
    });
  };

  const confirmSpellTargeting = () => {
    if (!actionTargeting || !actionTargeting.preview.valid) return;
    if (actionTargeting.kind === "spell" && actionTargeting.spellId) {
      applySystemEffects([
        {
          op: "combatCastSpell",
          actorId: save.party.activeActorId,
          spellId: actionTargeting.spellId,
          targetSelection: actionTargeting.selection as TargetSelection,
        },
      ]);
    } else if (actionTargeting.kind === "item" && actionTargeting.itemRef) {
      applyItemUse(actionTargeting.itemRef, actionTargeting.selection as TargetSelection);
    } else if (actionTargeting.kind === "ranged") {
      const enemyTargets = getEnemyTargetIds(actionTargeting.preview);
      if (enemyTargets.length === 0) return;
      applySystemEffects([
        {
          op: "combatRequestAttack",
          attackerId: save.party.activeActorId,
          defenderId: enemyTargets[0],
          mode: "RANGED",
          weaponId: actionTargeting.weaponId ?? null,
          targetSelection: actionTargeting.selection as TargetSelection,
          modifiers: actionTargeting.modifiers,
        },
      ]);
    }
    setActionTargeting(null);
  };

  const cancelSpellTargeting = () => setActionTargeting(null);

  const lastCheck = save.runtime.lastPlayerCheck || save.runtime.lastCheck;
  const tags = lastCheck && lastCheck !== null ? lastCheck.tags : [];
  const combat = save.runtime.combat;
  const targetingInfo = actionTargeting
    ? {
        spellName: actionTargeting.label,
        previewValid: actionTargeting.preview.valid,
        reason: actionTargeting.preview.reason,
        requiresDirection: actionTargeting.targetSpec.requiresDirection,
        direction: "direction" in actionTargeting.selection ? (actionTargeting.selection as any).direction : undefined,
      }
    : undefined;

  // Filter out combat-related choices from generic choices list - ALWAYS exclude combat choices
  const nonCombatChoices = choices.filter(
    (choice) =>
      !choice.id.startsWith("combat_move_") &&
      !choice.id.startsWith("combat_melee") &&
      !choice.id.startsWith("combat_ranged_") &&
      choice.id !== "start_combat" &&
      choice.id !== "combat_end_turn",
  );

  // Get combat-specific choices
  const combatChoices = choices.filter(
    (choice) =>
      choice.id.startsWith("combat_move_") ||
      choice.id === "combat_melee" ||
      choice.id.startsWith("combat_melee_") ||
      choice.id.startsWith("combat_ranged_") ||
      choice.id === "combat_end_turn",
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

    const background = resolveSceneBackground(storyPackWithCatalogs.id, scene, backgroundConfig);

    return (
      <View style={styles.gameAreaContainer} onLayout={onLayout}>
        {dimensions.width > 0 && dimensions.height > 0 ? (
          combat?.active ? (
            <CombatGrid
              containerWidth={dimensions.width}
              containerHeight={dimensions.height}
              combat={combat}
              save={save}
              styles={styles}
              targetingPreview={actionTargeting?.preview}
              onCellPress={actionTargeting ? handleCellTarget : undefined}
            />
          ) : (
            <ImageBackground
              source={background.source}
              style={styles.sceneBackground}
              imageStyle={styles.sceneBackgroundImage}
              resizeMode="stretch"
            >
              <View style={styles.sceneBackgroundOverlay}>
                <Text style={styles.sceneBackgroundLabel}>Scena</Text>
                <Text style={styles.sceneBackgroundTitle}>{scene.title}</Text>
              </View>
            </ImageBackground>
          )
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
              commitSave(initialSave, save);
            }}
          >
            <Text style={styles.gameOverButtonText}>Restart</Text>
          </Pressable>
        </View>
      )}

      {save.runtime.storyEnded && onReturnToHub && (
        <View style={styles.gameOverPanel}>
          <Text style={styles.gameOverTitle}>Quest Complete</Text>
          <Text style={styles.gameOverText}>Return to the Sigil Hub to continue your journey.</Text>
          <Pressable
            style={styles.gameOverButton}
            onPress={() => {
              onReturnToHub(save);
            }}
          >
            <Text style={styles.gameOverButtonText}>Return to Hub</Text>
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
      <ChoiceList
        choices={nonCombatChoices}
        handleChoice={handleChoice}
        styles={styles}
        disabled={Boolean(pendingChoice)}
      />
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
        onRangedTargetSelect={startRangedTargeting}
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
        onOpenSheet={() => {
          setPlayerSheetSpellMode(false);
          setPlayerSheetVisible(true);
        }}
        onOpenTalentShop={() => setTalentShopVisible(true)}
        onOpenEquipment={() => setEquipmentVisible(true)}
        onToggleFateProtection={handleToggleFateProtection}
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
        onClose={() => {
          setPlayerSheetVisible(false);
          setPlayerSheetSpellMode(false);
        }}
        applySystemEffects={applySystemEffects}
        onUseItem={handleUseItem}
        onDebugSpawnGear={__DEV__ ? handleSpawnTestGear : undefined}
        openSpellShop={playerSheetSpellMode}
      />

      {/* Talent Shop Modal */}
      <TalentShop
        visible={talentShopVisible}
        save={save}
        actor={save.actorsById[save.party.activeActorId]}
        onClose={() => setTalentShopVisible(false)}
        applySystemEffects={applySystemEffects}
      />

      <SkillShop
        visible={skillShopVisible}
        save={save}
        actor={save.actorsById[save.party.activeActorId]}
        onClose={() => setSkillShopVisible(false)}
        onTrainSkill={handleTrainSkill}
      />

      <StatShop
        visible={statShopVisible}
        save={save}
        actor={save.actorsById[save.party.activeActorId]}
        onClose={() => setStatShopVisible(false)}
        onIncreaseStat={handleIncreaseStat}
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

      {/* Choice Resolution Modal */}
      {pendingChoice && (
        <Modal visible transparent animationType="fade">
          <View style={styles.choiceModalOverlay}>
            <View style={styles.choiceModalContent}>
              <Text style={styles.choiceModalTitle}>{pendingChoice.title}</Text>
              {pendingChoice.lines.map((line, index) => (
                <Text key={`${line}-${index}`} style={styles.choiceModalText}>
                  {line}
                </Text>
              ))}
              <Pressable
                style={styles.choiceModalButton}
                onPress={() => {
                  commitSave(pendingChoice.pendingSave, save);
                  setPendingChoice(null);
                }}
              >
                <Text style={styles.choiceModalButtonText}>Continua</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
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
    sceneBackground: {
      flex: 1,
      width: "100%",
      justifyContent: "flex-end",
    },
    sceneBackgroundImage: {
      borderRadius: 8,
    },
    sceneBackgroundOverlay: {
      backgroundColor: "rgba(0, 0, 0, 0.45)",
      padding: 12,
      borderBottomLeftRadius: 8,
      borderBottomRightRadius: 8,
    },
    sceneBackgroundLabel: {
      fontSize: 12,
      textTransform: "uppercase",
      letterSpacing: 1,
      color: "#e5e7eb",
      marginBottom: 4,
    },
    sceneBackgroundTitle: {
      fontSize: isPhone ? 18 : 20,
      fontWeight: "700",
      color: "#fff",
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
    choiceModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0, 0, 0, 0.6)",
      justifyContent: "center",
      alignItems: "center",
      padding: 20,
    },
    choiceModalContent: {
      width: "100%",
      maxWidth: 420,
      backgroundColor: "#ffffff",
      borderRadius: 12,
      padding: 20,
      borderWidth: 1,
      borderColor: "#e5e7eb",
      gap: 8,
    },
    choiceModalTitle: {
      fontSize: isPhone ? 18 : 20,
      fontWeight: "700",
      color: "#111827",
      marginBottom: 4,
    },
    choiceModalText: {
      fontSize: 14,
      color: "#374151",
      lineHeight: 20,
    },
    choiceModalButton: {
      marginTop: 12,
      backgroundColor: "#2563eb",
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: "center",
    },
    choiceModalButtonText: {
      color: "#ffffff",
      fontSize: 16,
      fontWeight: "700",
    },
  });
};
