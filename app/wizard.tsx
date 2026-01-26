import { useMemo, useState, useEffect } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, TextInput, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import {
  createNewGame,
  evaluatePrerequisites,
  loadCharacterCatalogs,
  canLearnSpell,
  getSkillTrainingCost,
  type Actor,
  type ItemRef,
  type StatKey,
} from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";
import weaponsCatalog from "@eg/content/src/catalogs/weapons.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import spellsCatalog from "@eg/content/src/catalogs/spells.json";
import { upsertSaveSlot } from "../src/storage/gameSaves";
import { getStoryPackById } from "../src/storypacks";
import { hashToSeed } from "../src/utils/seed";

type Difficulty = "easy" | "normal" | "hard";
type TraitChoice = "weaver" | "soulless" | "none";
type StatMethod = "manual" | "random";

const STAT_KEYS: StatKey[] = ["STR", "TOU", "AGI", "INT", "WIL", "CHA", "WS", "BS", "INI", "PER"];

const DIFFICULTY_BASE: Record<Difficulty, number> = {
  easy: 20,
  normal: 15,
  hard: 10,
};

const ARCHETYPES = ["Human", "Elf", "Dwarf", "Halfling"] as const;

export default function NewGameWizard() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isNarrow = width < 720;
  const [step, setStep] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const [name, setName] = useState("");
  const [archetype, setArchetype] = useState<(typeof ARCHETYPES)[number] | null>(null);
  const [traitChoice, setTraitChoice] = useState<TraitChoice>("none");
  const [statMethod, setStatMethod] = useState<StatMethod>("manual");
  const [manualStats, setManualStats] = useState<Record<StatKey, number>>(
    Object.fromEntries(STAT_KEYS.map((key) => [key, DIFFICULTY_BASE.normal])) as Record<StatKey, number>
  );
  const [randomStats, setRandomStats] = useState<Record<StatKey, number> | null>(null);
  const [selectedTalents, setSelectedTalents] = useState<Record<string, number>>({});
  const [selectedTalentParams, setSelectedTalentParams] = useState<Record<string, Record<string, string>>>({});
  const [selectedTalentParamRanks, setSelectedTalentParamRanks] = useState<Record<string, Record<string, number>>>({});
  const [selectedTalentId, setSelectedTalentId] = useState<string | null>(null);
  const [selectedSpells, setSelectedSpells] = useState<string[]>([]);
  const [activeSpellDiscipline, setActiveSpellDiscipline] = useState<string | null>(null);
  const [skillRanks, setSkillRanks] = useState<Record<string, number>>({});

  const baseStat = DIFFICULTY_BASE[difficulty];
  const xpBudget = archetype === "Human" ? 2000 : 1500;
  const catalogs = useMemo(() => loadCharacterCatalogs(sigilContentPack as any), []);
  const isWeaver = traitChoice === "weaver";

  useEffect(() => {
    const base = DIFFICULTY_BASE[difficulty];
    setManualStats(Object.fromEntries(STAT_KEYS.map((key) => [key, base])) as Record<StatKey, number>);
    setRandomStats(null);
  }, [difficulty]);

  useEffect(() => {
    if (!isWeaver && selectedSpells.length > 0) {
      setSelectedSpells([]);
    }
  }, [isWeaver, selectedSpells.length]);

  const pointsRemaining = useMemo(() => {
    const spent = STAT_KEYS.reduce((sum, key) => sum + (manualStats[key] - baseStat), 0);
    return 250 - spent;
  }, [manualStats, baseStat]);

  const totalSkillRanks = useMemo(() => {
    return Object.values(skillRanks).reduce((sum, value) => sum + value, 0);
  }, [skillRanks]);

  const totalTalentRanks = useMemo(() => {
    return Object.values(selectedTalents).reduce((sum, value) => sum + value, 0);
  }, [selectedTalents]);

  const totalTalentXp = useMemo(() => {
    return Object.entries(selectedTalents).reduce((sum, [talentId, rank]) => {
      if (rank <= 0) return sum;
      const talent = (talentsCatalog as Array<{ id: string; xpCost?: number }>).find((entry) => entry.id === talentId);
      return sum + (talent?.xpCost ?? 0) * rank;
    }, 0);
  }, [selectedTalents]);

  const totalSkillXp = useMemo(() => {
    return Object.values(skillRanks).reduce((sum, rank) => {
      let skillTotal = 0;
      for (let r = 1; r <= rank; r += 1) {
        skillTotal += getSkillTrainingCost(r - 1);
      }
      return sum + skillTotal;
    }, 0);
  }, [skillRanks]);

  const totalSpellXp = useMemo(() => {
    return selectedSpells.reduce((sum, spellId) => {
      const spell = (spellsCatalog as Array<{ id: string; xpCost?: number }>).find((entry) => entry.id === spellId);
      return sum + (spell?.xpCost ?? 0);
    }, 0);
  }, [selectedSpells]);

  const totalSpentXp = totalTalentXp + totalSkillXp + totalSpellXp;
  const remainingXp = Math.max(0, xpBudget - totalSpentXp);

  const selectedSpellsRecord = useMemo(() => {
    const record: Record<string, boolean> = {};
    selectedSpells.forEach((spellId) => {
      record[spellId] = true;
    });
    return record;
  }, [selectedSpells]);

  const stepOrder = useMemo(() => {
    const base = ["difficulty", "name", "trait", "stats", "talents"];
    if (isWeaver) {
      base.push("spells");
    }
    base.push("skills", "loadout");
    return base;
  }, [isWeaver]);
  const currentStep = stepOrder[step] ?? stepOrder[0];
  const lastStepIndex = stepOrder.length - 1;

  useEffect(() => {
    if (step > lastStepIndex) {
      setStep(lastStepIndex);
    }
  }, [lastStepIndex, step]);

  const talentParamStorage = useMemo(() => {
    const paramsById: Record<string, Record<string, Record<string, string>>> = {};
    const ranksById: Record<string, Record<string, number>> = {};
    const uniquenessKeys: string[] = [];

    (talentsCatalog as Array<{ id: string; uniquenessKey?: string; chosenParam?: { paramKey: string } }>).forEach((talent) => {
      if (!talent.chosenParam || !talent.uniquenessKey) return;
      const paramKey = talent.chosenParam.paramKey;
      const paramRanks = selectedTalentParamRanks[talent.id];
      if (!paramRanks) return;
      for (const [paramValue, rank] of Object.entries(paramRanks)) {
        if (rank <= 0) continue;
        const resolvedKey = talent.uniquenessKey.replace(`<${paramKey}>`, paramValue);
        if (!paramsById[talent.id]) paramsById[talent.id] = {};
        if (!ranksById[talent.id]) ranksById[talent.id] = {};
        paramsById[talent.id][resolvedKey] = { [paramKey]: paramValue };
        ranksById[talent.id][resolvedKey] = rank;
        if (!uniquenessKeys.includes(resolvedKey)) {
          uniquenessKeys.push(resolvedKey);
        }
      }
    });

    return { paramsById, ranksById, uniquenessKeys };
  }, [selectedTalentParamRanks]);

  const rollRandomStats = () => {
    const rollStat = () => {
      const rolls = Array.from({ length: 5 }, () => Math.floor(Math.random() * 10) + 1);
      rolls.sort((a, b) => b - a);
      return baseStat + rolls.slice(0, 3).reduce((sum, value) => sum + value, 0);
    };
    const next: Record<StatKey, number> = Object.fromEntries(
      STAT_KEYS.map((key) => [key, rollStat()])
    ) as Record<StatKey, number>;
    setRandomStats(next);
  };

  const applyArchetypeModifiers = (stats: Record<StatKey, number>, chosenArchetype: (typeof ARCHETYPES)[number]) => {
    const next = { ...stats };
    const addAll = (value: number) => {
      STAT_KEYS.forEach((key) => {
        next[key] += value;
      });
    };

    switch (chosenArchetype) {
      case "Human":
        addAll(5);
        break;
      case "Elf":
        next.WS += 10;
        next.BS += 10;
        next.WIL += 10;
        next.AGI += 10;
        next.INT += 10;
        next.INI += 20;
        break;
      case "Dwarf":
        next.WS += 10;
        next.TOU += 10;
        next.WIL += 20;
        next.PER += 10;
        next.AGI -= 10;
        next.CHA -= 10;
        break;
      case "Halfling":
        next.BS += 10;
        next.WIL += 10;
        next.CHA += 10;
        next.INI += 10;
        next.PER += 10;
        next.STR -= 10;
        break;
      default:
        break;
    }

    return next;
  };

  const selectedStats = statMethod === "random" ? randomStats : manualStats;
  const effectiveStats =
    selectedStats && archetype ? applyArchetypeModifiers(selectedStats, archetype) : selectedStats;

  const prereqActor = useMemo<Actor | null>(() => {
    if (!effectiveStats || !archetype) return null;
    const size = archetype === "Halfling" ? 3 : 4;
    const traits: Record<string, any> = {
      "trait:size": { size },
    };
    if (traitChoice === "weaver") traits["trait:weaver"] = true;
    if (traitChoice === "soulless") traits["trait:untouchable"] = true;

    return {
      id: "PC_1",
      name: name.trim() || "Player",
      kind: "PC",
      tags: [`archetype:${archetype.toLowerCase()}`],
      stats: effectiveStats,
      resources: { wounds: 0, rf: 0, fatePoints: 4, xp: 0, gold: 10 },
      skills: skillRanks,
      talents: selectedTalents,
      traits,
      spells: selectedSpellsRecord,
      equipment: {},
      status: { conditions: [], tempModifiers: [] },
      talentParams: selectedTalentParams,
      talentParamsById: talentParamStorage.paramsById,
      talentUniquenessRanksById: talentParamStorage.ranksById,
      talentUniquenessKeys: talentParamStorage.uniquenessKeys.length > 0 ? talentParamStorage.uniquenessKeys : undefined,
    } as Actor;
  }, [
    effectiveStats,
    archetype,
    traitChoice,
    skillRanks,
    selectedTalents,
    selectedTalentParams,
    name,
    talentParamStorage,
    selectedSpellsRecord,
  ]);

  const prereqSave = useMemo(() => {
    if (!prereqActor) return null;
    const storyPack = getStoryPackById("sigil_hub");
    if (!storyPack) return null;
    return createNewGame(storyPack, 1, { actors: [prereqActor.id], activeActorId: prereqActor.id }, { [prereqActor.id]: prereqActor }, sigilContentPack as any);
  }, [prereqActor]);

  const spellPrereqActor = useMemo<Actor | null>(() => {
    if (!prereqActor) return null;
    return {
      ...prereqActor,
      resources: {
        ...prereqActor.resources,
        xp: 9999,
      },
      spells: selectedSpellsRecord,
    };
  }, [prereqActor, selectedSpellsRecord]);

  const spellPrereqSave = useMemo(() => {
    if (!spellPrereqActor) return null;
    const storyPack = getStoryPackById("sigil_hub");
    if (!storyPack) return null;
    return createNewGame(
      storyPack,
      1,
      { actors: [spellPrereqActor.id], activeActorId: spellPrereqActor.id },
      { [spellPrereqActor.id]: spellPrereqActor },
      sigilContentPack as any
    );
  }, [spellPrereqActor]);

  const availableTalents = useMemo(() => {
    if (!prereqActor || !prereqSave) return [];
    return (talentsCatalog as Array<{ id: string; name: string; prerequisites?: any[]; maxRank?: number }>).filter((talent) => {
      const prerequisites = talent.prerequisites || [];
      const currentRank = selectedTalents[talent.id] ?? 0;
      const maxRank = talent.maxRank ?? 1;
      if (prerequisites.length === 0) return true;
      return evaluatePrerequisites(prereqSave, catalogs, prereqActor, prerequisites).valid;
    });
  }, [prereqActor, prereqSave, catalogs, selectedTalents]);

  useEffect(() => {
    setSelectedTalents((current) => {
      const next: Record<string, number> = {};
      Object.entries(current).forEach(([id, rank]) => {
        if (availableTalents.some((talent) => talent.id === id)) {
          next[id] = rank;
        }
      });
      return next;
    });
    setSelectedTalentParams((current) => {
      const next: Record<string, Record<string, string>> = {};
      Object.entries(current).forEach(([id, params]) => {
        if (availableTalents.some((talent) => talent.id === id)) {
          next[id] = params;
        }
      });
      return next;
    });
    setSelectedTalentParamRanks((current) => {
      const next: Record<string, Record<string, number>> = {};
      Object.entries(current).forEach(([id, ranks]) => {
        if (availableTalents.some((talent) => talent.id === id)) {
          next[id] = ranks;
        }
      });
      return next;
    });
  }, [availableTalents]);

  const canContinue = () => {
    switch (currentStep) {
      case "difficulty":
        return true;
      case "name":
        return name.trim().length > 0 && archetype !== null;
      case "trait":
        return traitChoice !== null;
      case "stats":
        return statMethod === "manual" ? pointsRemaining === 0 : Boolean(randomStats);
      case "talents":
        return totalSpentXp <= xpBudget;
      case "spells":
        return totalSpentXp <= xpBudget;
      case "skills":
        return totalSpentXp <= xpBudget;
      default:
        return true;
    }
  };

  const adjustStat = (key: StatKey, delta: number) => {
    setManualStats((current) => {
      const nextValue = current[key] + delta;
      if (nextValue < baseStat) return current;
      const spent = STAT_KEYS.reduce((sum, statKey) => {
        const value = statKey === key ? nextValue : current[statKey];
        return sum + (value - baseStat);
      }, 0);
      if (spent > 250) return current;
      return { ...current, [key]: nextValue };
    });
  };

  const addTalentRank = (talent: { id: string; maxRank?: number; chosenParam?: { paramKey: string }; xpCost?: number }) => {
    const maxRank = talent.maxRank ?? 1;
    const hasParam = Boolean(talent.chosenParam);
    const cost = talent.xpCost ?? 0;
    if (remainingXp < cost) return;
    if (hasParam) {
      const paramKey = talent.chosenParam?.paramKey || "";
      const paramValue = selectedTalentParams[talent.id]?.[paramKey];
      if (!paramValue) return;
      const paramRanks = selectedTalentParamRanks[talent.id] || {};
      const currentParamRank = paramRanks[paramValue] ?? 0;
      if (currentParamRank >= maxRank) return;
      const nextParamRanks = { ...paramRanks, [paramValue]: currentParamRank + 1 };
      const nextTotalRank = Object.values(nextParamRanks).reduce((sum, value) => sum + value, 0);
      setSelectedTalentParamRanks((current) => ({ ...current, [talent.id]: nextParamRanks }));
      setSelectedTalents((current) => ({ ...current, [talent.id]: nextTotalRank }));
      setSelectedTalentId(talent.id);
      return;
    }

    setSelectedTalents((current) => {
      const currentRank = current[talent.id] ?? 0;
      if (currentRank >= maxRank) return current;
      return { ...current, [talent.id]: currentRank + 1 };
    });
    setSelectedTalentId(talent.id);
  };

  const removeTalentRank = (talent: { id: string; chosenParam?: { paramKey: string } }) => {
    const hasParam = Boolean(talent.chosenParam);
    if (hasParam) {
      const paramKey = talent.chosenParam?.paramKey || "";
      const paramValue = selectedTalentParams[talent.id]?.[paramKey];
      const paramRanks = selectedTalentParamRanks[talent.id] || {};
      const valueToRemove =
        paramValue && paramRanks[paramValue] ? paramValue : Object.keys(paramRanks).find((key) => paramRanks[key] > 0);
      if (!valueToRemove) return;
      const nextParamRank = Math.max(0, (paramRanks[valueToRemove] ?? 0) - 1);
      const nextParamRanks = { ...paramRanks, [valueToRemove]: nextParamRank };
      if (nextParamRank === 0) {
        delete nextParamRanks[valueToRemove];
      }
      const nextTotalRank = Object.values(nextParamRanks).reduce((sum, value) => sum + value, 0);
      setSelectedTalentParamRanks((current) => ({ ...current, [talent.id]: nextParamRanks }));
      setSelectedTalents((current) => {
        if (nextTotalRank <= 0) {
          const { [talent.id]: _, ...rest } = current;
          return rest;
        }
        return { ...current, [talent.id]: nextTotalRank };
      });
      return;
    }

    const currentRank = selectedTalents[talent.id] ?? 0;
    setSelectedTalents((current) => {
      if (currentRank <= 1) {
        const { [talent.id]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [talent.id]: currentRank - 1 };
    });
  };

  const setTalentParam = (talentId: string, paramKey: string, value: string) => {
    setSelectedTalentParams((current) => ({
      ...current,
      [talentId]: {
        ...(current[talentId] || {}),
        [paramKey]: value,
      },
    }));
  };

  const adjustSkillRank = (skillId: string, delta: number) => {
    setSkillRanks((current) => {
      const currentRank = current[skillId] ?? 0;
      const nextRank = Math.max(0, currentRank + delta);
      if (delta > 0) {
        const cost = getSkillTrainingCost(currentRank);
        if (remainingXp < cost) return current;
      }
      if (nextRank === 0) {
        const { [skillId]: _, ...rest } = current;
        return rest;
      }
      return { ...current, [skillId]: nextRank };
    });
  };

  const spellDisciplines = useMemo(() => {
    const values = Array.from(new Set((spellsCatalog as Array<{ discipline: string }>).map((spell) => spell.discipline)));
    return values.sort();
  }, []);

  useEffect(() => {
    if (!activeSpellDiscipline && spellDisciplines.length > 0) {
      setActiveSpellDiscipline(spellDisciplines[0]);
    }
  }, [activeSpellDiscipline, spellDisciplines]);

  const spellsByDiscipline = useMemo(() => {
    const grouped: Record<string, Array<any>> = {};
    (spellsCatalog as Array<any>).forEach((spell) => {
      grouped[spell.discipline] = grouped[spell.discipline] || [];
      grouped[spell.discipline].push(spell);
    });
    Object.keys(grouped).forEach((discipline) => {
      grouped[discipline].sort((a, b) => a.name.localeCompare(b.name));
    });
    return grouped;
  }, []);

  const toggleSpellSelection = (spellId: string) => {
    if (!spellPrereqSave || !spellPrereqActor) return;
    const isSelected = selectedSpells.includes(spellId);
    if (isSelected) {
      setSelectedSpells((current) => current.filter((id) => id !== spellId));
      return;
    }
    const spell = (spellsCatalog as Array<{ id: string; xpCost?: number }>).find((entry) => entry.id === spellId);
    const cost = spell?.xpCost ?? 0;
    if (remainingXp < cost) return;
    const canLearn = canLearnSpell(spellPrereqSave, catalogs, spellPrereqActor.id, spellId);
    if (!canLearn.canLearn) return;
    setSelectedSpells((current) => [...current, spellId]);
  };

  const buildLoadout = () => {
    if (traitChoice === "weaver") {
      return {
        equipment: {
          mainHand: { kind: "weapon" as const, id: "staff" },
          armor: { kind: "armor" as const, id: "leather" },
        },
        inventory: [
          { kind: "weapon" as const, id: "crossbow" },
          { kind: "item" as const, id: "ammo:bolt", qty: 10 },
          { kind: "item" as const, id: "potion:healing", qty: 1 },
          { kind: "item" as const, id: "potion:fatigue", qty: 1 },
        ],
      };
    }
    return {
      equipment: {
        mainHand: { kind: "weapon" as const, id: "longsword" },
        offHand: { kind: "item" as const, id: "shield:wooden" },
        armor: { kind: "armor" as const, id: "plate" },
      },
      inventory: [
        { kind: "weapon" as const, id: "longbow" },
        { kind: "item" as const, id: "ammo:arrow", qty: 10 },
        { kind: "item" as const, id: "potion:healing", qty: 1 },
        { kind: "item" as const, id: "potion:fatigue", qty: 1 },
      ],
    };
  };

  const ensureAmmoForWeapons = (equipment: Actor["equipment"], inventory: ItemRef[]) => {
    const ammoByWeaponId = new Map<string, string>();
    (weaponsCatalog as Array<{ id: string; ammo?: { itemId: string } }>).forEach((weapon) => {
      if (weapon.ammo?.itemId) {
        ammoByWeaponId.set(weapon.id, weapon.ammo.itemId);
      }
    });

    const addAmmo = (weaponId: string) => {
      const ammoId = ammoByWeaponId.get(weaponId);
      if (!ammoId) return;
      const hasAmmo = inventory.some((entry) => entry.kind === "item" && entry.id === ammoId);
      if (!hasAmmo) {
        inventory.push({ kind: "item", id: ammoId, qty: 10 });
      }
    };

    const weaponIds: string[] = [];
    [equipment.mainHand, equipment.offHand]
      .filter((entry): entry is ItemRef => Boolean(entry && entry.kind === "weapon"))
      .forEach((entry) => weaponIds.push(entry.id));
    inventory
      .filter((entry) => entry.kind === "weapon")
      .forEach((entry) => weaponIds.push(entry.id));

    weaponIds.forEach(addAmmo);
  };

  const handleCreateGame = async () => {
    if (!selectedStats || !archetype) return;
    const hubPack = getStoryPackById("sigil_hub");
    if (!hubPack) return;
    const loadout = buildLoadout();
    const inventory = [...loadout.inventory];
    ensureAmmoForWeapons(loadout.equipment, inventory);
    const size = archetype === "Halfling" ? 3 : 4;
    const traits: Record<string, any> = {
      "trait:size": { size },
    };
    if (traitChoice === "weaver") traits["trait:weaver"] = true;
    if (traitChoice === "soulless") traits["trait:untouchable"] = true;

    const legacyTalentParams =
      Object.keys(talentParamStorage.paramsById).length > 0
        ? Object.fromEntries(
            Object.entries(talentParamStorage.paramsById).map(([talentId, entries]) => [talentId, Object.values(entries)[0]])
          )
        : undefined;

    const actor: Actor = {
      id: "PC_1",
      name: name.trim(),
      kind: "PC",
      tags: [`archetype:${archetype.toLowerCase()}`],
      stats: applyArchetypeModifiers(selectedStats, archetype),
      resources: {
        wounds: 0,
        rf: 0,
        fatePoints: 4,
        xp: remainingXp,
        xpEarned: xpBudget,
        xpSpent: totalSpentXp,
        gold: 10,
        baseStats: applyArchetypeModifiers(selectedStats, archetype),
      },
      skills: skillRanks,
      talents: selectedTalents,
      traits,
      spells: selectedSpellsRecord,
      equipment: loadout.equipment,
      inventory,
      status: { conditions: [], tempModifiers: [] },
      talentParams: legacyTalentParams,
      talentParamsById: Object.keys(talentParamStorage.paramsById).length > 0 ? talentParamStorage.paramsById : undefined,
      talentUniquenessRanksById: Object.keys(talentParamStorage.ranksById).length > 0 ? talentParamStorage.ranksById : undefined,
      talentUniquenessKeys:
        talentParamStorage.uniquenessKeys.length > 0 ? talentParamStorage.uniquenessKeys : undefined,
    } as Actor;

    const party = {
      actors: [actor.id],
      activeActorId: actor.id,
    };

    const seedSource = JSON.stringify({
      name: actor.name,
      archetype,
      traitChoice,
      difficulty,
      stats: selectedStats,
    });
    const seed = hashToSeed(seedSource);

    const save = createNewGame(hubPack, seed, party, { [actor.id]: actor }, sigilContentPack as any);

    const now = new Date().toISOString();
    const slotId = `save_${Date.now()}`;
    await upsertSaveSlot({
      id: slotId,
      name: actor.name,
      createdAt: now,
      updatedAt: now,
      save,
    });

    router.replace(`/play?saveId=${slotId}`);
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>New Game Wizard</Text>
      <Text style={styles.stepLabel}>
        Step {Math.min(step + 1, stepOrder.length)} of {stepOrder.length}
      </Text>

      {currentStep === "difficulty" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Choose Difficulty</Text>
          {(["easy", "normal", "hard"] as Difficulty[]).map((level) => (
            <Pressable
              key={level}
              style={[styles.choiceButton, difficulty === level && styles.choiceButtonActive]}
              onPress={() => setDifficulty(level)}
            >
              <Text style={styles.choiceText}>{level.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {currentStep === "name" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Name & Archetype</Text>
          <TextInput
            style={styles.input}
            placeholder="Character name"
            placeholderTextColor="#94a3b8"
            value={name}
            onChangeText={setName}
          />
          <View style={styles.choiceGrid}>
            {ARCHETYPES.map((option) => (
              <Pressable
                key={option}
                style={[styles.choiceButton, archetype === option && styles.choiceButtonActive]}
                onPress={() => setArchetype(option)}
              >
                <Text style={styles.choiceText}>{option}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {currentStep === "trait" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Core Trait</Text>
          {(["weaver", "soulless", "none"] as TraitChoice[]).map((option) => (
            <Pressable
              key={option}
              style={[styles.choiceButton, traitChoice === option && styles.choiceButtonActive]}
              onPress={() => setTraitChoice(option)}
            >
              <Text style={styles.choiceText}>{option.toUpperCase()}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {currentStep === "stats" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Starting Stats</Text>
          <Text style={styles.summaryText}>Base value: {baseStat}</Text>
          {archetype && <Text style={styles.summaryText}>Archetype modifiers applied: {archetype}</Text>}
          <View style={styles.choiceGrid}>
            {(["manual", "random"] as StatMethod[]).map((option) => (
              <Pressable
                key={option}
                style={[styles.choiceButton, statMethod === option && styles.choiceButtonActive]}
                onPress={() => setStatMethod(option)}
              >
                <Text style={styles.choiceText}>{option.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>

          {statMethod === "random" ? (
            <View style={styles.randomSection}>
              <Pressable style={styles.primaryButton} onPress={rollRandomStats}>
                <Text style={styles.primaryButtonText}>Roll Stats</Text>
              </Pressable>
              {effectiveStats && (
                <View style={styles.statsList}>
                  {STAT_KEYS.map((key) => (
                    <View key={key} style={styles.statRow}>
                      <Text style={styles.statLabel}>{key}</Text>
                      <Text style={styles.statValue}>{effectiveStats[key]}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ) : (
            <View>
              <Text style={styles.pointsRemaining}>Points remaining: {pointsRemaining}</Text>
              <View style={styles.statsList}>
                {STAT_KEYS.map((key) => (
                  <View key={key} style={styles.statRow}>
                    <Text style={styles.statLabel}>{key}</Text>
                    <View style={styles.statControls}>
                      <Pressable style={styles.statButton} onPress={() => adjustStat(key, -5)}>
                        <Text style={styles.statButtonText}>-5</Text>
                      </Pressable>
                      <Pressable style={styles.statButton} onPress={() => adjustStat(key, -1)}>
                        <Text style={styles.statButtonText}>-1</Text>
                      </Pressable>
                      <Text style={styles.statValue}>{effectiveStats ? effectiveStats[key] : manualStats[key]}</Text>
                      <Pressable style={styles.statButton} onPress={() => adjustStat(key, 1)}>
                        <Text style={styles.statButtonText}>+1</Text>
                      </Pressable>
                      <Pressable style={styles.statButton} onPress={() => adjustStat(key, 5)}>
                        <Text style={styles.statButtonText}>+5</Text>
                      </Pressable>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
        </View>
      )}

      {currentStep === "talents" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Starting Talents</Text>
          <Text style={styles.summaryText}>
            XP Budget: {xpBudget} · Spent: {totalSpentXp} · Remaining: {remainingXp}
          </Text>

          <View style={[styles.talentColumns, isNarrow && styles.talentColumnsStacked]}>
            <View style={styles.talentDetail}>
              {(() => {
                const talent = availableTalents.find((entry) => entry.id === selectedTalentId) ?? availableTalents[0];
                if (!talent) {
                  return <Text style={styles.emptyText}>No talents available for this character.</Text>;
                }
                const currentRank = selectedTalents[talent.id] ?? 0;
                const isSelected = currentRank > 0;
                const prereqs = talent.prerequisites || [];
                const grants = talent.grants || [];
                const maxRank = talent.maxRank ?? 1;
                const chosenParam = talent.chosenParam;
                const paramValue = chosenParam ? selectedTalentParams[talent.id]?.[chosenParam.paramKey] : undefined;
                const paramRanks = chosenParam ? selectedTalentParamRanks[talent.id] || {} : {};
                const talentCost = talent.xpCost ?? 0;
                const formatPrereq = (prereq: any) => {
                  switch (prereq.type) {
                    case "statAtLeast":
                      return `${prereq.stat} ≥ ${prereq.value}`;
                    case "hasTalent":
                      return `Talent: ${prereq.talentId}`;
                    case "hasTalentRank":
                      return `Talent: ${prereq.talentId} (Rank ${prereq.minRank}+)`;
                    case "hasTrait":
                      return `Trait: ${prereq.traitId}`;
                    case "hasSpell":
                      return `Spell: ${prereq.spellId}`;
                    default:
                      return "Special requirement";
                  }
                };
                const formatGrant = (grant: any) => {
                  if (grant.type === "modifier") {
                    const suffix = grant.valueRef ? ` (${grant.valueRef})` : "";
                    return `Modifier: ${grant.key} ${grant.op} ${grant.value}${suffix}`;
                  }
                  if (grant.type === "unlockAction") {
                    return `Unlocks: ${grant.actionId}`;
                  }
                  if (grant.type === "skillRank") {
                    return `Skill Rank: ${grant.skillId} +${grant.value}`;
                  }
                  if (grant.type === "hpMaxFlat") {
                    return `HP Max +${grant.value}`;
                  }
                  if (grant.type === "hook") {
                    return `Special: ${grant.hookId}`;
                  }
                  return "Effect";
                };
                return (
                  <View>
                    <Text style={styles.sectionTitle}>{talent.name}</Text>
                    <Text style={styles.summaryText}>{talent.description || "No description provided."}</Text>
                    <Text style={styles.subTitle}>Effects</Text>
                    {grants.length === 0 ? (
                      <Text style={styles.summaryText}>No direct effects.</Text>
                    ) : (
                      grants.map((grant: any, idx: number) => (
                        <Text key={`${talent.id}-grant-${idx}`} style={styles.summaryText}>
                          • {formatGrant(grant)}
                        </Text>
                      ))
                    )}
                    <Text style={styles.subTitle}>Prerequisites</Text>
                    {prereqs.length === 0 ? (
                      <Text style={styles.summaryText}>None</Text>
                    ) : (
                      prereqs.map((prereq: any, idx: number) => (
                        <Text key={`${talent.id}-req-${idx}`} style={styles.summaryText}>
                          • {formatPrereq(prereq)}
                        </Text>
                      ))
                    )}
                    {chosenParam && (
                      <>
                        <Text style={styles.subTitle}>Choose {chosenParam.label || chosenParam.paramKey}</Text>
                        <View style={styles.choiceGrid}>
                          {chosenParam.options.map((option: string) => (
                            <Pressable
                              key={`${talent.id}-${option}`}
                              style={[
                                styles.choiceButton,
                                paramValue === option && styles.choiceButtonActive,
                              ]}
                              onPress={() => setTalentParam(talent.id, chosenParam.paramKey, option)}
                            >
                              <Text style={styles.choiceText}>
                                {option}
                                {paramRanks[option] ? ` · Rank ${paramRanks[option]}` : ""}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </>
                    )}
                    <View style={styles.talentControls}>
                      <Pressable
                        style={[styles.statButton, currentRank === 0 && styles.buttonDisabled]}
                        onPress={() => removeTalentRank(talent)}
                        disabled={currentRank === 0}
                      >
                        <Text style={styles.statButtonText}>-1</Text>
                      </Pressable>
                      <Text style={styles.statValue}>{currentRank}</Text>
                      <Pressable
                        style={[
                          styles.statButton,
                          (remainingXp < talentCost ||
                            (chosenParam && (!paramValue || (paramRanks[paramValue] ?? 0) >= maxRank))) &&
                            styles.buttonDisabled,
                        ]}
                        onPress={() => addTalentRank(talent)}
                        disabled={
                          remainingXp < talentCost ||
                          (chosenParam && (!paramValue || (paramRanks[paramValue] ?? 0) >= maxRank))
                        }
                      >
                        <Text style={styles.statButtonText}>+1</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })()}
            </View>
            <View style={styles.talentList}>
              <Text style={styles.subTitle}>Choose Talents</Text>
              <ScrollView contentContainerStyle={styles.talentListContent} style={styles.talentListScroll}>
                {availableTalents.map((talent) => {
                  const currentRank = selectedTalents[talent.id] ?? 0;
                  const isSelected = currentRank > 0;
                  return (
                    <Pressable
                      key={talent.id}
                      style={[
                        styles.choiceButton,
                        isSelected && styles.choiceButtonActive,
                        selectedTalentId === talent.id && styles.talentActive,
                      ]}
                      onPress={() => setSelectedTalentId(talent.id)}
                    >
                      <Text style={styles.choiceText}>{talent.name}</Text>
                      <Text style={styles.skillMeta}>
                        Tier {talent.tier} {isSelected ? `· Rank ${currentRank}` : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </View>
      )}

      {currentStep === "spells" && isWeaver && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Starting Spells</Text>
          <Text style={styles.summaryText}>
            XP Budget: {xpBudget} · Spent: {totalSpentXp} · Remaining: {remainingXp}
          </Text>
          <View style={styles.choiceGrid}>
            {spellDisciplines.map((discipline) => (
              <Pressable
                key={discipline}
                style={[
                  styles.choiceButton,
                  activeSpellDiscipline === discipline && styles.choiceButtonActive,
                ]}
                onPress={() => setActiveSpellDiscipline(discipline)}
              >
                <Text style={styles.choiceText}>{discipline}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.talentList}>
            <ScrollView contentContainerStyle={styles.talentListContent} style={styles.talentListScroll}>
              {(spellsByDiscipline[activeSpellDiscipline || ""] || []).map((spell) => {
                const isSelected = selectedSpells.includes(spell.id);
                const spellCost = spell.xpCost ?? 0;
                const canLearnResult =
                  !isSelected && spellPrereqSave && spellPrereqActor
                    ? canLearnSpell(spellPrereqSave, catalogs, spellPrereqActor.id, spell.id)
                    : { canLearn: true };
                const isDisabled =
                  (!isSelected && !canLearnResult.canLearn) || (!isSelected && remainingXp < spellCost);
                return (
                  <Pressable
                    key={spell.id}
                    style={[
                      styles.choiceButton,
                      isSelected && styles.choiceButtonActive,
                      isDisabled && styles.buttonDisabled,
                    ]}
                    onPress={() => toggleSpellSelection(spell.id)}
                    disabled={isDisabled}
                  >
                    <Text style={styles.choiceText}>{spell.name}</Text>
                    <Text style={styles.skillMeta}>
                      {spell.discipline} • CN {spell.baseCN} · {spellCost} XP
                    </Text>
                    {!isSelected && !canLearnResult.canLearn && (
                      <Text style={styles.skillMeta}>{canLearnResult.reason}</Text>
                    )}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      )}

      {currentStep === "skills" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Starting Skills</Text>
          <Text style={styles.summaryText}>
            XP Budget: {xpBudget} · Spent: {totalSpentXp} · Remaining: {remainingXp}
          </Text>

          <Text style={styles.subTitle}>Assign Skill Ranks</Text>
          <View style={styles.statsList}>
            {(skillsCatalog as Array<{ id: string; name: string; baseStat: string; prerequisites?: any[] }>).map((skill) => {
              const rank = skillRanks[skill.id] ?? 0;
              const trainingCost = getSkillTrainingCost(rank);
              const prerequisites = skill.prerequisites || [];
              const skillAllowed =
                prerequisites.length === 0 ||
                (prereqActor &&
                  prereqSave &&
                  evaluatePrerequisites(prereqSave, catalogs, prereqActor, prerequisites).valid);
              return (
                <View key={skill.id} style={styles.statRow}>
                  <View style={styles.skillInfo}>
                    <Text style={styles.statLabel}>{skill.name}</Text>
                    <Text style={styles.skillMeta}>
                      Base {skill.baseStat} · {trainingCost} XP
                    </Text>
                    {!skillAllowed && <Text style={styles.skillMeta}>Requires prerequisites</Text>}
                  </View>
                  <View style={styles.statControls}>
                    <Pressable
                      style={[styles.statButton, !skillAllowed && styles.buttonDisabled]}
                      onPress={() => adjustSkillRank(skill.id, -1)}
                      disabled={!skillAllowed}
                    >
                      <Text style={styles.statButtonText}>-1</Text>
                    </Pressable>
                    <Text style={styles.statValue}>{rank}</Text>
                    <Pressable
                      style={[
                        styles.statButton,
                        (!skillAllowed || remainingXp < trainingCost) && styles.buttonDisabled,
                      ]}
                      onPress={() => adjustSkillRank(skill.id, 1)}
                      disabled={!skillAllowed || remainingXp < trainingCost}
                    >
                      <Text style={styles.statButtonText}>+1</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}

      {currentStep === "loadout" && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Starting Loadout</Text>
          <Text style={styles.summaryText}>Trait: {traitChoice}</Text>
          <Text style={styles.summaryText}>Archetype: {archetype ?? "Unknown"}</Text>
          <Text style={styles.summaryText}>
            Equipment: {traitChoice === "weaver" ? "Staff, Leather Armor" : "Longsword, Shield, Plate Armor"}
          </Text>
          <Text style={styles.summaryText}>
            Inventory: {traitChoice === "weaver" ? "Crossbow, Bolts" : "Longbow, Arrows"}
          </Text>
          <Text style={styles.summaryText}>Consumables: Healing Potion, Fatigue Potion</Text>

          <Pressable style={styles.primaryButton} onPress={handleCreateGame}>
            <Text style={styles.primaryButtonText}>Create Game</Text>
          </Pressable>
        </View>
      )}

      <View style={styles.navRow}>
        <Pressable
          style={[styles.secondaryButton, step === 0 && styles.buttonDisabled]}
          disabled={step === 0}
          onPress={() => setStep((current) => Math.max(0, current - 1))}
        >
          <Text style={styles.secondaryButtonText}>Back</Text>
        </Pressable>
        {step < lastStepIndex && (
          <Pressable
            style={[styles.primaryButton, !canContinue() && styles.buttonDisabled]}
            disabled={!canContinue()}
            onPress={() => setStep((current) => Math.min(lastStepIndex, current + 1))}
          >
            <Text style={styles.primaryButtonText}>Next</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    gap: 16,
    backgroundColor: "#0f172a",
  },
  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#f8fafc",
  },
  stepLabel: {
    fontSize: 12,
    color: "#94a3b8",
  },
  section: {
    gap: 12,
    backgroundColor: "#0b1220",
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#f1f5f9",
  },
  choiceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  choiceButton: {
    backgroundColor: "#1e293b",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#334155",
  },
  choiceButtonActive: {
    backgroundColor: "#2563eb",
    borderColor: "#1d4ed8",
  },
  choiceText: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  input: {
    backgroundColor: "#0f172a",
    borderColor: "#334155",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    color: "#f8fafc",
  },
  randomSection: {
    gap: 12,
  },
  pointsRemaining: {
    color: "#94a3b8",
    fontSize: 14,
  },
  statsList: {
    gap: 8,
  },
  statRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  statLabel: {
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "600",
  },
  statValue: {
    color: "#f8fafc",
    fontSize: 14,
    fontWeight: "700",
    minWidth: 36,
    textAlign: "center",
  },
  statControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  statButton: {
    backgroundColor: "#1e293b",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "#334155",
  },
  statButtonText: {
    color: "#e2e8f0",
    fontSize: 12,
    fontWeight: "600",
  },
  primaryButton: {
    backgroundColor: "#2563eb",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    flex: 1,
  },
  primaryButtonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  secondaryButton: {
    backgroundColor: "#1e293b",
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: "center",
    flex: 1,
    borderWidth: 1,
    borderColor: "#334155",
  },
  secondaryButtonText: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  navRow: {
    flexDirection: "row",
    gap: 12,
    justifyContent: "space-between",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  summaryText: {
    color: "#e2e8f0",
    fontSize: 14,
  },
  subTitle: {
    color: "#94a3b8",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 8,
  },
  skillInfo: {
    flex: 1,
    marginRight: 12,
  },
  skillMeta: {
    color: "#64748b",
    fontSize: 11,
  },
  talentColumns: {
    flexDirection: "row",
    gap: 16,
  },
  talentColumnsStacked: {
    flexDirection: "column",
  },
  talentDetail: {
    flex: 1,
    backgroundColor: "#0f172a",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#1f2937",
  },
  talentList: {
    flex: 1,
  },
  talentListScroll: {
    maxHeight: 320,
  },
  talentListContent: {
    gap: 8,
  },
  talentActive: {
    borderColor: "#f8fafc",
  },
  talentControls: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
});
