import type { ActorId, ConditionId, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { RNG } from "../../rng";
import { addConditionToActor, removeConditionFromActor } from "../../conditions";
import { getStatOrSkillValue } from "../../checks";
import { rollD100Check } from "../../checks/evaluation";
import { getUntouchableAuraImpact } from "../untouchableAura";
import { getUntouchableAuraRadius } from "../../characters/untouchable";
import { footprintDistanceBetweenActors } from "../footprint";

export function updateAuraEffects(save: GameSave, catalogs?: CharacterCatalogs): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;

  let updatedSave: GameSave = save;
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter ?? 0);
  let rngUsed = false;

  const partyIds = new Set(save.party?.actors ?? []);
  const isAlly = (casterId: ActorId, targetId: ActorId): boolean => {
    const casterIsParty = partyIds.has(casterId);
    return casterIsParty ? partyIds.has(targetId) : !partyIds.has(targetId);
  };

  const isUnderAntiMagic = (actorId: ActorId): boolean => {
    if (getUntouchableAuraImpact(save, catalogs, actorId)) return true;
    const selfRadius = getUntouchableAuraRadius(save, catalogs, actorId);
    return selfRadius > 0;
  };

  const desired: Record<
    string,
    Record<string, { stacks: number; untilTurnCounter?: number; params?: Record<string, any> }>
  > = {};
  const auraGroupWinners = new Map<ActorId, { kind: "sanctuary" | "cursed_earth"; power: number; sourceId: ActorId }>();

  for (const casterId of combat.participants) {
    const caster = save.actorsById[casterId];
    if (!caster?.conditions) continue;
    for (const [conditionId, instance] of Object.entries(caster.conditions)) {
      const aura = instance.params?.aura;
      if (!aura || typeof aura.radius !== "number") continue;
      if (isUnderAntiMagic(casterId)) continue;
      const radius = aura.radius;
      if (radius <= 0) continue;
      const includeCaster = aura.includeCaster !== false;
      const auraKind = instance.params?.auraKind as "sanctuary" | "cursed_earth" | "word_of_god" | undefined;
      const auraPower = typeof instance.params?.auraPower === "number" ? instance.params?.auraPower : 0;

      for (const targetId of combat.participants) {
        if (!includeCaster && targetId === casterId) continue;
        if (!isAlly(casterId, targetId) && auraKind !== "cursed_earth" && auraKind !== "sanctuary") continue;
        if (isUnderAntiMagic(targetId)) continue;
        const distance = footprintDistanceBetweenActors(save, casterId, targetId);
        if (distance > radius) continue;

        if (auraKind === "sanctuary" || auraKind === "cursed_earth") {
          const current = auraGroupWinners.get(targetId);
          if (!current || auraPower > current.power) {
            if (current) {
              const previousKey = current.kind === "sanctuary" ? "sanctuary" : "cursed_earth";
              if (desired[targetId]?.[previousKey]) {
                delete desired[targetId][previousKey];
              }
              if (current.kind === "sanctuary" && desired[targetId]?.["sanctuary_debuff"]) {
                delete desired[targetId]["sanctuary_debuff"];
              }
            }
            auraGroupWinners.set(targetId, { kind: auraKind, power: auraPower, sourceId: casterId });
          } else if (current && auraPower < current.power) {
            continue;
          }
        }

        if (auraKind === "sanctuary") {
          const targetActor = save.actorsById[targetId];
          const isDaemonic = targetActor?.traits?.["trait:daemonic"] !== undefined;
          if (isDaemonic && !isAlly(casterId, targetId)) {
            const wilBonus = typeof instance.params?.wilBonus === "number" ? instance.params?.wilBonus : 0;
            const overcast = typeof instance.params?.overcast === "number" ? instance.params?.overcast : 0;
            const entryPenalty = -5 * wilBonus;
            const targetValue = getStatOrSkillValue(targetActor, "WIL", save);
            const entryCheck = rollD100Check(
              `combat:sanctuary:entry:${targetId}`,
              targetId,
              targetValue + entryPenalty,
              undefined,
              rng,
            );
            rngUsed = true;
            if (!entryCheck || !entryCheck.success) {
              continue;
            }
            const debuffValue = -5 * wilBonus - 5 * overcast;
            desired[targetId] = desired[targetId] || {};
            desired[targetId]["sanctuary_debuff"] = {
              stacks: 1,
              untilTurnCounter: instance.untilTurnCounter,
              params: {
                auraKind: "sanctuary",
                auraPower,
                modifierId: `aura:sanctuary:${casterId}:${targetId}`,
                debuffValue,
              },
            };
            continue;
          }
        }

        if (auraKind === "cursed_earth") {
          const targetActor = save.actorsById[targetId];
          const isDaemonic = targetActor?.traits?.["trait:daemonic"] !== undefined;
          if (!isDaemonic) {
            continue;
          }
          const wilBonus = typeof instance.params?.wilBonus === "number" ? instance.params?.wilBonus : 0;
          const daemonicBonus = Math.ceil(wilBonus / 2);
          desired[targetId] = desired[targetId] || {};
          desired[targetId]["cursed_earth"] = {
            stacks: 1,
            untilTurnCounter: instance.untilTurnCounter,
            params: {
              auraKind: "cursed_earth",
              auraPower,
              daemonicBonus,
              ignoreInstability: true,
            },
          };
          continue;
        }

        desired[targetId] = desired[targetId] || {};
        const current = desired[targetId][conditionId];
        const stacks = instance.stacks ?? 1;
        const untilTurnCounter = instance.untilTurnCounter;
        const params = instance.params
          ? Object.fromEntries(Object.entries(instance.params).filter(([key]) => key !== "aura"))
          : undefined;
        if (!current || stacks > current.stacks || (untilTurnCounter ?? 0) > (current.untilTurnCounter ?? 0)) {
          desired[targetId][conditionId] = { stacks, untilTurnCounter, params };
        }
      }
    }
  }

  for (const actorId of combat.participants) {
    const actor = updatedSave.actorsById[actorId];
    if (!actor) continue;
    let updatedActor = actor;
    const wanted = desired[actorId] ?? {};

    if (actor.conditions) {
      for (const [conditionId, instance] of Object.entries(actor.conditions)) {
        if (instance.params?.aura && isUnderAntiMagic(actorId)) {
          updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
          continue;
        }
        if (!instance.params?.auraApplied) continue;
        if (isUnderAntiMagic(actorId)) {
          updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
          continue;
        }
        if (conditionId === "sanctuary_debuff" && instance.params?.modifierId) {
          const modifierId = instance.params.modifierId as string;
          const filteredMods = (updatedActor.status.tempModifiers || []).filter((mod) => mod.id !== modifierId);
          if (filteredMods.length !== (updatedActor.status.tempModifiers || []).length) {
            updatedActor = {
              ...updatedActor,
              status: {
                ...updatedActor.status,
                tempModifiers: filteredMods,
              },
            };
          }
        }
        if (!wanted[conditionId]) {
          updatedActor = removeConditionFromActor(updatedActor, conditionId as any);
          continue;
        }
        const desiredEntry = wanted[conditionId];
        updatedActor = addConditionToActor(
          updatedActor,
          conditionId as any,
          desiredEntry.stacks,
          desiredEntry.untilTurnCounter,
          instance.source,
          { ...(desiredEntry.params ?? {}), auraApplied: true },
        );
        delete wanted[conditionId];
      }
    }

    for (const [conditionId, data] of Object.entries(wanted)) {
      const conditionKey = conditionId as ConditionId;
      if (actor.conditions?.[conditionKey] && !actor.conditions?.[conditionKey]?.params?.auraApplied) {
        continue;
      }
      if (conditionId === "sanctuary_debuff" && data.params?.modifierId) {
        const modifierId = data.params.modifierId as string;
        const existingMods = (updatedActor.status.tempModifiers || []).filter((mod) => mod.id !== modifierId);
        updatedActor = {
          ...updatedActor,
          status: {
            ...updatedActor.status,
            tempModifiers: [
              ...existingMods,
              {
                id: modifierId,
                scope: "all",
                key: null,
                value: data.params?.debuffValue ?? 0,
                expires: data.untilTurnCounter,
              },
            ],
          },
        };
      }
      updatedActor = addConditionToActor(
        updatedActor,
        conditionKey as any,
        data.stacks,
        data.untilTurnCounter,
        "aura:applied",
        { ...(data.params ?? {}), auraApplied: true },
      );
    }

    if (updatedActor !== actor) {
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [actorId]: updatedActor,
        },
      };
    }
  }

  if (rngUsed) {
    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        rngCounter: rng.getCounter(),
      },
    };
  }

  return updatedSave;
}
