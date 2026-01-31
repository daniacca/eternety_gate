import type { ActorId } from "../../../types";
import type { TargetSelection, TargetPreview, TargetSpec } from "../../targeting/types";
import type { ContentPack } from "../../../../content/types";
import { buildSpellTargetSpec, computeTargetPreview } from "../../targeting/computeTargeting";
import { getActorsInRange } from "../../../targeting/getActorsInRange";
import { appendCombatLog, appendRuntimeLog } from "../../narration";
import { getMagicResistanceAgainstSpell } from "../../../magic/resistance";
import { getBestResistStat, hasDenyTheWitch, performDenyTheWitchCheck } from "../../../magic/denyTheWitch";
import { performCheckWithSave } from "../../../checks";
import { getResistanceBonus } from "../../../characters/talentModifiers";
import { getUntouchableDenyBonus } from "../../../characters/untouchable";

import type { TargetResolutionParams, TargetResolutionResult } from "./types";

export function resolveSpellTargets(params: TargetResolutionParams): TargetResolutionResult {
  const {
    save,
    storyPack,
    rng,
    catalogs,
    combat,
    turnActorId,
    spell,
    effectDef,
    cnBase,
    overcast,
    resolutionId,
    effectStatBonus,
    targetSelection: initialSelection,
    phenomenaResult,
    skipPhenomenaTargetRandomization,
  } = params;

  let updatedSave = save;
  let targetSelection: TargetSelection = initialSelection;

  const terrainContentPack: ContentPack | undefined =
    storyPack.grids || storyPack.tiles
      ? {
          id: storyPack.id,
          grids: storyPack.grids,
          tiles: storyPack.tiles,
        }
      : undefined;

  const spellTargetSpec: TargetSpec = buildSpellTargetSpec(spell, effectDef, cnBase);
  if (effectDef.radiusFromEffectStat && spellTargetSpec.shape.kind === "radius") {
    spellTargetSpec.shape = {
      ...spellTargetSpec.shape,
      radius: Math.max(0, effectStatBonus),
    };
  }
  if (effectDef.centerOnCaster && spellTargetSpec.shape.kind === "radius") {
    const casterPos = updatedSave.runtime.combat?.positions[turnActorId];
    if (casterPos) {
      targetSelection = { kind: "radius", centerPos: casterPos };
    }
  }

  let targetPreview: TargetPreview = computeTargetPreview(updatedSave, turnActorId, spellTargetSpec, targetSelection);

  if (
    !skipPhenomenaTargetRandomization &&
    phenomenaResult?.kind === "targetRandomization" &&
    spellTargetSpec.shape.kind === "single"
  ) {
    const rangeSquares = spellTargetSpec.shape.range;
    if (rangeSquares > 0) {
      const candidates = getActorsInRange(updatedSave, turnActorId, rangeSquares, {
        includeCaster: false,
        allowFriendlyFire: true,
      });
      if (candidates.length > 0) {
        const randomIndex = rng.nextInt(0, candidates.length - 1);
        const randomTargetId = candidates[randomIndex];
        const randomPos = updatedSave.runtime.combat?.positions[randomTargetId];
        if (randomPos) {
          const randomizedSelection: TargetSelection = { kind: "single", targetPos: randomPos };
          targetSelection = randomizedSelection;
          targetPreview = computeTargetPreview(updatedSave, turnActorId, spellTargetSpec, randomizedSelection);

          const phenomenonMessage = "La Trama sfugge al controllo: il bersaglio cambia!";
          updatedSave = appendCombatLog(updatedSave, phenomenonMessage);

          const tags: string[] = [
            "magic:phenomena=targetRandomization",
            `magic:spell=${spell.id}`,
            `magic:caster=${turnActorId}`,
            `magic:randomTarget=${randomTargetId}`,
            `magic:randomPos=${randomPos.x},${randomPos.y}`,
          ];

          const affected = targetPreview.affectedActorIds ?? [];
          for (const id of affected.slice(0, 5)) {
            tags.push(`magic:affectedActor=${id}`);
          }
          if (affected.length > 5) {
            tags.push(`magic:affectedActorsMore=${affected.length - 5}`);
          }

          updatedSave = appendRuntimeLog(updatedSave, {
            kind: "system",
            message: phenomenonMessage,
            turnCounter: combat.turnCounter,
            resolutionId,
            tags,
          });
        }
      }
    }
  }

  if (!targetPreview.valid) {
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Targeting failed: ${targetPreview.reason || "invalid"}`,
      turnCounter: combat.turnCounter,
      resolutionId,
    });
    return {
      handled: true,
      save: updatedSave,
    };
  }

  let targetActors = targetPreview.affectedActorIds
    .map((id) => ({
      actorId: id,
      actor: updatedSave.actorsById[id],
    }))
    .filter((t): t is { actorId: ActorId; actor: NonNullable<typeof updatedSave.actorsById[string]> } => !!t.actor);

  if (effectDef.aura?.applyToAllies && effectDef.aura.includeCaster !== false) {
    if (!targetActors.some((target) => target.actorId === turnActorId)) {
      const casterActor = updatedSave.actorsById[turnActorId];
      if (casterActor) {
        targetActors = [{ actorId: turnActorId, actor: casterActor }, ...targetActors];
      }
    }
  }

  const partyIds = new Set(updatedSave.party?.actors ?? []);
  const isAlly = (casterId: ActorId, targetId: ActorId): boolean => {
    const casterIsParty = partyIds.has(casterId);
    return casterIsParty ? partyIds.has(targetId) : !partyIds.has(targetId);
  };

  if (effectDef.aura?.applyToAllies || effectDef.specialOp === "combatPurgeConditions") {
    targetActors = targetActors.filter((t) => isAlly(turnActorId, t.actorId));
  }

  if (effectDef.specialOp === "combatControlMind" || effectDef.specialOp === "combatVisionOfTerror") {
    targetActors = targetActors.filter((t) => !isAlly(turnActorId, t.actorId));
  }

  if (targetActors.length > 0) {
    const targetNames = targetActors.map((t) => t.actor.name || t.actorId).join(", ");
    updatedSave = appendCombatLog(updatedSave, `Bersagli: ${targetNames}`);
  }

  let validTargetActors = [...targetActors];

  const targetOvercastById = new Map<ActorId, number>();
  const manifestedPM = cnBase + overcast;

  if (catalogs && targetActors.length > 0) {
    const resistedByMr = new Set<ActorId>();

    for (const target of targetActors) {
      const mr = getMagicResistanceAgainstSpell(updatedSave, target.actorId, turnActorId, catalogs);
      if (mr >= manifestedPM) {
        resistedByMr.add(target.actorId);
        const targetName = target.actor.name || target.actorId;
        const resistedLog = `${targetName} resiste alla magia (RM ${mr} >= PM ${manifestedPM}).`;
        updatedSave = appendCombatLog(updatedSave, resistedLog);

        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `Magic resistance: ${target.actorId} resists ${spell.id} (MR ${mr} >= PM ${manifestedPM})`,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: [
            "magic:resisted",
            `magic:mr=${mr}`,
            `magic:pm=${manifestedPM}`,
            `magic:spell=${spell.id}`,
            `magic:target=${target.actorId}`,
          ],
        });
        continue;
      }

      const effectiveOvercastForTarget = mr > 0 ? Math.max(0, overcast - mr) : overcast;
      targetOvercastById.set(target.actorId, effectiveOvercastForTarget);
    }

    validTargetActors = targetActors.filter((t) => !resistedByMr.has(t.actorId));
  }

  if (spell.discipline === "MENTIS" && validTargetActors.length > 0) {
    const immuneTargets = new Set<ActorId>();
    for (const target of validTargetActors) {
      if (target.actor.traits?.["trait:from_beyond"] !== undefined) {
        immuneTargets.add(target.actorId);
      }
    }
    if (immuneTargets.size > 0) {
      validTargetActors = validTargetActors.filter((t) => !immuneTargets.has(t.actorId));
      for (const targetId of immuneTargets) {
        const targetName = updatedSave.actorsById[targetId]?.name || targetId;
        updatedSave = appendCombatLog(updatedSave, `${targetName} è immune agli effetti mentali.`);
        updatedSave = appendRuntimeLog(updatedSave, {
          kind: "system",
          message: `From Beyond: ${targetId} resists MENTIS spell ${spell.id}`,
          turnCounter: combat.turnCounter,
          resolutionId,
          tags: ["trait:from_beyond", "magic:discipline=MENTIS", `magic:spell=${spell.id}`],
        });
      }
    }
  }

  const getOvercastForTarget = (actorId: ActorId): number => targetOvercastById.get(actorId) ?? overcast;

  if (
    effectDef.opposed &&
    effectDef.specialOp !== "combatDisarmAtRange" &&
    effectDef.specialOp !== "combatHaemorrhage" &&
    effectDef.specialOp !== "combatControlMind" &&
    effectDef.specialOp !== "combatVisionOfTerror" &&
    effectDef.specialOp !== "combatDaemonbane" &&
    effectDef.specialOp !== "combatInfernalGaze" &&
    validTargetActors.length > 0
  ) {
    const baseOpposedStat = effectDef.opposedStat || effectDef.castingStat;
    const opposedDifficulty = effectDef.opposedDifficulty || "Challenging";

    const resistedTargetIds = new Set<ActorId>();

    for (const target of validTargetActors) {
      const opposedStat = catalogs
        ? getBestResistStat(target.actor, baseOpposedStat, updatedSave, catalogs)
        : baseOpposedStat;

      const magicResistanceBonus = catalogs ? getResistanceBonus(updatedSave, catalogs, target.actorId, "magic") : 0;
      const untouchableDenyBonus = catalogs ? getUntouchableDenyBonus(updatedSave, catalogs, target.actorId) : 0;

      const defenderCheck = {
        id: `combat:cast:opposed:${spell.id}:${target.actorId}`,
        kind: "single" as const,
        actorRef: { mode: "byId" as const, actorId: target.actorId },
        key: opposedStat,
        difficulty: opposedDifficulty,
        modifier: magicResistanceBonus + untouchableDenyBonus,
      };

      const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
        defenderCheck,
        storyPack,
        updatedSave,
        rng,
        `res:opposed:${spell.id}:${target.actorId}`
      );

      updatedSave = saveAfterDefenderCheck;

      if (!defenderResult) {
        resistedTargetIds.add(target.actorId);
        continue;
      }

      const attackerDoS = params.effectiveDoS;
      const defenderDoS = defenderResult.success ? defenderResult.dos : -1;
      const usedDenyTheWitch =
        catalogs && opposedStat === "WIL" && baseOpposedStat !== "WIL" && hasDenyTheWitch(target.actor, catalogs, updatedSave);

      if (attackerDoS > defenderDoS) {
        const targetName = target.actor.name || target.actorId;
        const statLabel = usedDenyTheWitch ? `${opposedStat} (Rifiuto della Strega)` : opposedStat;
        const opposedLog = `${targetName} resiste con ${statLabel} ma fallisce (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
        updatedSave = appendCombatLog(updatedSave, opposedLog);
      } else {
        const targetName = target.actor.name || target.actorId;
        const statLabel = usedDenyTheWitch ? `${opposedStat} (Rifiuto della Strega)` : opposedStat;
        const resistedLog = `${targetName} resiste con successo usando ${statLabel} (DoS attaccante: ${attackerDoS}, DoS difensore: ${defenderDoS})`;
        updatedSave = appendCombatLog(updatedSave, resistedLog);
        resistedTargetIds.add(target.actorId);
      }
    }

    validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
  }

  if (!effectDef.opposed && validTargetActors.length > 0 && catalogs) {
    const resistedTargetIds = new Set<ActorId>();

    for (const target of validTargetActors) {
      if (!hasDenyTheWitch(target.actor, catalogs, updatedSave)) {
        continue;
      }

      const magicResistanceBonus = getResistanceBonus(updatedSave, catalogs, target.actorId, "magic");
      const untouchableDenyBonus = getUntouchableDenyBonus(updatedSave, catalogs, target.actorId);

      const denyResult = performDenyTheWitchCheck(
        target.actor,
        params.effectiveDoS,
        updatedSave,
        rng,
        spell.id,
        catalogs,
        magicResistanceBonus + untouchableDenyBonus
      );

      updatedSave = denyResult.save;

      const targetName = target.actor.name || target.actorId;
      if (denyResult.success) {
        updatedSave = appendCombatLog(updatedSave, `${targetName} nega gli effetti dell'incantesimo con Rifiuto della Strega!`);
        resistedTargetIds.add(target.actorId);
      } else if (denyResult.checkResult) {
        updatedSave = appendCombatLog(updatedSave, `${targetName} tenta di resistere con Rifiuto della Strega ma fallisce.`);
      }
    }

    validTargetActors = validTargetActors.filter((t) => !resistedTargetIds.has(t.actorId));
  }

  return {
    handled: false,
    save: updatedSave,
    targetSelection,
    targetPreview,
    targetActors,
    validTargetActors,
    targetOvercastById,
    getOvercastForTarget,
    terrainContentPack,
    spellTargetSpec,
  };
}
