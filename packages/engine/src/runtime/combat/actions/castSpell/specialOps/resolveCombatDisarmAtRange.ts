import type { ActorId, ItemRef, SingleCheck } from "../../../../types";
import { appendCombatLog } from "../../../narration";
import { performCheckWithSave } from "../../../../checks";
import { posKey } from "../../../../items";

import type { SpecialOpParams, SpecialOpResult } from "../types";

export function resolveCombatDisarmAtRange(params: SpecialOpParams): SpecialOpResult | null {
  const {
    save,
    storyPack,
    rng,
    combat,
    turnActorId,
    spell,
    effectDef,
    effectiveDoS,
    validTargetActors,
  } = params;
  if (effectDef.specialOp !== "combatDisarmAtRange" || validTargetActors.length === 0) {
    return null;
  }

  let updatedSave = save;
  const disarmedTargetIds = new Set<ActorId>();

  for (const target of validTargetActors) {
    const opposedStat = effectDef.opposedStat || "STR";
    const opposedDifficulty = effectDef.opposedDifficulty || "-20";

    const defenderCheck: SingleCheck = {
      id: `combat:cast:disarm:opposed:${spell.id}:${target.actorId}`,
      kind: "single",
      actorRef: { mode: "byId", actorId: target.actorId },
      key: opposedStat,
      difficulty: opposedDifficulty,
    };

    const { result: defenderResult, save: saveAfterDefenderCheck } = performCheckWithSave(
      defenderCheck,
      storyPack,
      updatedSave,
      rng,
      `res:disarm:opposed:${spell.id}:${target.actorId}`
    );

    updatedSave = saveAfterDefenderCheck;

    if (!defenderResult) {
      const targetName = target.actor.name || target.actorId;
      updatedSave = appendCombatLog(updatedSave, `${targetName} resiste al disarmo a distanza`);
      continue;
    }

    const attackerDoS = effectiveDoS;
    const defenderDoS = defenderResult.success ? defenderResult.dos : -1;

    if (attackerDoS > defenderDoS) {
      const defender = target.actor;
      const defenderMainHand = defender.equipment?.mainHand;
      const defenderWeaponId = defenderMainHand?.kind === "weapon" ? defenderMainHand.id : null;

      if (defenderWeaponId && defenderWeaponId !== "unarmed") {
        const weaponItemRef: ItemRef = { kind: "weapon", id: defenderWeaponId };

        const updatedDefender = {
          ...defender,
          equipment: {
            ...defender.equipment,
            mainHand: null,
          },
        };

        const defenderPos = combat.positions[target.actorId];
        if (defenderPos) {
          const posKeyStr = posKey(defenderPos);
          const currentGroundItemsByPos = combat.groundItemsByPos || {};
          const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
          const updatedGroundItemsByPos = {
            ...currentGroundItemsByPos,
            [posKeyStr]: [...itemsAtPos, weaponItemRef],
          };

          const updatedCombat = {
            ...updatedSave.runtime.combat!,
            groundItemsByPos: updatedGroundItemsByPos,
          };

          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [target.actorId]: updatedDefender,
            },
            runtime: {
              ...updatedSave.runtime,
              combat: updatedCombat,
            },
          };

          const attacker = updatedSave.actorsById[turnActorId];
          const attackerName = attacker?.name || turnActorId;
          const targetName = target.actor.name || target.actorId;
          const weaponName = updatedSave.weaponsById?.[defenderWeaponId]?.name || "l'arma";
          const disarmLog =
            attacker?.kind === "PC"
              ? `Disarmi ${targetName} a distanza! ${weaponName} cade a terra.`
              : `${attackerName} disarma ${targetName} a distanza! ${weaponName} cade a terra.`;
          updatedSave = appendCombatLog(updatedSave, disarmLog);
          disarmedTargetIds.add(target.actorId);
        }
      }
    }
  }

  const filteredTargets = validTargetActors.filter((t) => !disarmedTargetIds.has(t.actorId));
  if (filteredTargets.length === 0) {
    return { handled: true, save: updatedSave };
  }

  return { handled: false, save: updatedSave };
}
