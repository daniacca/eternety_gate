import type { SpecialOpParams, SpecialOpResult } from "../types";
import { appendCombatLog, appendRuntimeLog, nextRuntimeSeq } from "../../../narration";
import { addConditionToActor } from "../../../../conditions";
import { calculateMaxHp } from "../../../../characters/hp";
import { getInitiativeBonus } from "../../../../characters/bonuses";
import { getAllSpells } from "../../../../magic/catalogs";
import { buildSummonedBaseActor, buildSummonStats, findSummonPosition } from "./summonHelpers";

export function resolveCombatSummonDivine(params: SpecialOpParams): SpecialOpResult | null {
  const { save, catalogs, combat, rng, turnActorId, spell, effectDef, effectStatBonus, getOvercastForTarget, terrainContentPack } =
    params;
  if (effectDef.specialOp !== "combatSummonDivine") {
    return null;
  }

  let updatedSave = save;
  const targetOvercast = getOvercastForTarget(turnActorId);
  const scaling = effectStatBonus + targetOvercast;
  const s = Math.max(0, scaling);

  const { save: saveWithSeq, seq } = nextRuntimeSeq(updatedSave);
  updatedSave = saveWithSeq;
  const summonId = `SUMMON_DIVINE_${turnActorId}_${seq}`;
  const duration = Math.max(1, effectStatBonus + targetOvercast);

  const stats = buildSummonStats({
    base: 25 + 5 * s,
    wil: 35 + 5 * s,
    wsBs: 35 + 5 * s,
    cha: 25,
  });

  const spells = getAllSpells()
    .filter((spellDef) => spellDef.discipline === "SANTIC")
    .reduce<Record<string, boolean>>((acc, spellDef) => {
      acc[spellDef.id] = true;
      return acc;
    }, { "spell:corpus_mend": true });

  const summonActor = buildSummonedBaseActor({
    id: summonId,
    name: "Spirito Divino",
    stats,
    traits: {
      "trait:weaver": true,
      "trait:flyer": { x: Math.max(1, s) },
      "trait:natural_armour": { armor: Math.ceil(s / 2) },
      "trait:divine": { x: s },
      "trait:size": { size: 5 },
    },
    skills: {
      "skill:parry": s,
      "skill:dodge": Math.floor(s / 2),
      "skill:channeling": s,
    },
    talents: {
      "talent:swift_attack": 1,
      "talent:disarm": 1,
      "talent:channelling_focus": 1,
    },
    spells,
    equipment: {
      mainHand: { kind: "weapon", id: "sanctified_greatblade" },
      offHand: null,
      armor: null,
      helmet: null,
      boots: null,
      cloak: null,
      necklace: null,
      ring1: null,
      ring2: null,
    },
  });

  const actorWithCondition = addConditionToActor(
    summonActor,
    "summoned",
    1,
    combat.turnCounter + duration,
    `spell:${spell.id}`,
    { summonedBy: turnActorId }
  );

  const saveWithActor = {
    ...updatedSave,
    actorsById: {
      ...updatedSave.actorsById,
      [summonId]: actorWithCondition,
    },
  };

  const summonPos = findSummonPosition({
    save: saveWithActor,
    casterId: turnActorId,
    summonId,
    contentPack: terrainContentPack,
  });
  if (!summonPos) {
    updatedSave = appendCombatLog(updatedSave, "Non c'è spazio per evocare lo spirito divino.");
    return { handled: true, save: updatedSave };
  }

  const casterIsParty = (updatedSave.party?.actors ?? []).includes(turnActorId);
  const partyActors = updatedSave.party?.actors ?? [];
  const updatedPartyActors = casterIsParty ? [...partyActors, summonId] : partyActors;

  const iniBonus = catalogs ? getInitiativeBonus(saveWithActor, summonId, catalogs) : 0;
  const iniRoll = rng.nextInt(1, 10);
  const iniScore = iniBonus + iniRoll;
  const existingInitiative = updatedSave.runtime.combat?.initiativeByActorId ?? {};
  const initiativeByActorId = {
    ...existingInitiative,
    [summonId]: { iniBonus, iniRoll, iniScore },
  };

  const currentParticipants = [...updatedSave.runtime.combat!.participants];
  let insertIndex = currentParticipants.length;
  for (let i = 0; i < currentParticipants.length; i += 1) {
    const existingId = currentParticipants[i];
    const existing = initiativeByActorId[existingId];
    if (!existing) continue;
    if (
      iniScore > existing.iniScore ||
      (iniScore === existing.iniScore && (iniBonus > existing.iniBonus || (iniBonus === existing.iniBonus && summonId < existingId)))
    ) {
      insertIndex = i;
      break;
    }
  }
  const updatedParticipants = [
    ...currentParticipants.slice(0, insertIndex),
    summonId,
    ...currentParticipants.slice(insertIndex),
  ];
  const currentIndex = updatedSave.runtime.combat!.currentIndex;
  const updatedCurrentIndex = insertIndex <= currentIndex ? currentIndex + 1 : currentIndex;

  const maxHp = catalogs ? calculateMaxHp(saveWithActor, actorWithCondition, catalogs) : undefined;
  const initialHpByActorId = {
    ...(updatedSave.runtime.combat?.initialHpByActorId ?? {}),
    ...(maxHp ? { [summonId]: maxHp } : {}),
  };

  updatedSave = {
    ...saveWithActor,
    party: {
      ...updatedSave.party,
      actors: updatedPartyActors,
      activeActorId: updatedSave.party?.activeActorId ?? turnActorId,
    },
    runtime: {
      ...updatedSave.runtime,
      combat: {
        ...updatedSave.runtime.combat!,
        participants: updatedParticipants,
        currentIndex: updatedCurrentIndex,
        positions: {
          ...updatedSave.runtime.combat!.positions,
          [summonId]: summonPos,
        },
        initialHpByActorId,
        initiativeByActorId,
      },
    },
  };

  updatedSave = appendCombatLog(updatedSave, "Evoci uno Spirito Divino.");
  if (casterIsParty) {
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "initiative",
      actorId: summonId,
      iniBonus,
      iniRoll,
      iniScore,
      turnCounter: combat.turnCounter,
    });
  }
  return { handled: true, save: updatedSave };
}
