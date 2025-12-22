import type { StoryPack, GameSave, ActorId, CombatAttackCheck, CheckResult } from "../types";
import { RNG, type IRNG } from "../rng";
import { performCheck, resolveActor } from "../checks";
import { distanceChebyshev, clampToGrid } from "./movement";
import { appendCombatLog } from "./narration";
import { calculateWeaponDamage, getActorArmor, getActorWeapon } from "./equipment";

/**
 * Applies combat damage when a combatAttack check hits
 */
function applyCombatDamageIfHit(check: any, result: CheckResult, save: GameSave, rng: IRNG): GameSave {
  if (!result || check.kind !== "combatAttack" || !result.success) return save;

  const combatCheck = check as CombatAttackCheck;
  const attacker = resolveActor(combatCheck.attacker.actorRef, save);
  const defender = resolveActor(combatCheck.defender.actorRef, save);

  if (!attacker || !defender) {
    // Attacker or defender not found, skip damage application
    return save;
  }

  // Get weapon ID from check or actor equipment
  const weaponId = combatCheck.attacker.weaponId ?? attacker.equipment?.weaponId ?? null;

  // Calculate raw damage with weapon (using passed RNG for determinism)
  const { rawDamage, weaponName, weaponId: finalWeaponId } = calculateWeaponDamage(save, attacker, weaponId, rng);

  // Get defender armor soak
  const { soak, armorId, name: armorName } = getActorArmor(save, defender);

  // Calculate final damage after soak
  const finalDamage = Math.max(0, rawDamage - soak);

  // Get current HP
  const hpBefore = defender.resources.hp;
  const hpAfter = Math.max(0, hpBefore - finalDamage);

  // Update defender immutably
  const updatedDefender = {
    ...defender,
    resources: {
      ...defender.resources,
      hp: hpAfter,
    },
  };

  // Update actorsById immutably
  const updatedActorsById = {
    ...save.actorsById,
    [defender.id]: updatedDefender,
  };

  // Update lastCheck tags immutably
  const lastCheck = save.runtime.lastCheck;
  const prevTags = lastCheck && lastCheck !== null ? lastCheck.tags : [];

  const updatedLastCheck =
    lastCheck && lastCheck !== null
      ? {
          ...lastCheck,
          tags: [
            ...prevTags,
            `combat:damage:raw=${rawDamage}`,
            `combat:soak=${soak}`,
            `combat:damage:final=${finalDamage}`,
            `combat:weapon=${finalWeaponId}`,
            `combat:armor=${armorId}`,
            `combat:defHpBefore=${hpBefore}`,
            `combat:defHpAfter=${hpAfter}`,
            ...(hpAfter === 0 ? ["combat:defDown=1"] : []),
          ],
        }
      : lastCheck; // if null/undefined, leave it as is

  return {
    ...save,
    actorsById: updatedActorsById,
    runtime: {
      ...save.runtime,
      lastCheck: updatedLastCheck,
      rngCounter: rng.getCounter(),
    },
  };
}

/**
 * Runs an NPC turn (auto-attack or move)
 */
export function runNpcTurn(storyPack: StoryPack, save: GameSave, npcId: ActorId): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
  const combat = save.runtime.combat;

  if (!combat?.active) {
    return save;
  }

  // Target is always the active party member
  const targetId = save.party.activeActorId;

  // Backward compatibility: if positions not initialized, use old behavior (MELEE attack)
  if (!combat.positions) {
    // Old combat state without positions - use MELEE attack
    const check: CombatAttackCheck = {
      id: `combat:npcTurn:${npcId}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: npcId },
        mode: "MELEE",
        weaponId: null,
      },
      defender: {
        actorRef: { mode: "byId", actorId: targetId },
      },
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };

    // Mark as attacked (backward compatibility: if turn undefined, create default)
    const combatWithAttacked = {
      ...combat,
      turn: combat.turn
        ? {
            ...combat.turn,
            actionAvailable: false,
          }
        : {
            moveRemaining: 0,
            actionAvailable: false,
            stance: "normal" as const,
          },
    };

    const result = performCheck(
      check,
      storyPack,
      { ...save, runtime: { ...save.runtime, combat: combatWithAttacked } },
      rng
    );

    if (!result) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          combat: combatWithAttacked,
          rngCounter: rng.getCounter(),
        },
      };
    }

    let currentSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: combatWithAttacked,
        rngCounter: rng.getCounter(),
        lastCheck: {
          ...result,
          tags: [...result.tags, "combat:npcTurn=1", `combat:npcId=${npcId}`],
        },
      },
    };

    currentSave = applyCombatDamageIfHit(check, result, currentSave, rng);
    return currentSave;
  }

  // Get positions
  const npcPos = combat.positions[npcId];
  const targetPos = combat.positions[targetId];

  if (!npcPos || !targetPos) {
    return save;
  }

  const dist = distanceChebyshev(npcPos, targetPos);

  // Get NPC weapon to determine attack mode and range
  const npc = save.actorsById[npcId];
  const { weapon, weaponId: npcWeaponId } = getActorWeapon(save, npc);
  const npcHasRanged = weapon?.kind === "RANGED";
  const weaponRange = weapon?.range;

  // Decision logic:
  // 1. If dist <= 1: MELEE attack (or RANGED if weapon is ranged and in melee, but that's blocked by rules)
  // 2. Else if npcHasRanged && dist <= weapon.range.long: RANGED attack
  // 3. Else: MOVE toward target

  if (dist <= 1) {
    // MELEE attack
    const check: CombatAttackCheck = {
      id: `combat:npcTurn:${npcId}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: npcId },
        mode: "MELEE",
        weaponId: npcWeaponId === "unarmed" ? null : npcWeaponId,
      },
      defender: {
        actorRef: { mode: "byId", actorId: targetId },
      },
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };

    // Consume action
    const combatWithAttacked = {
      ...combat,
      turn: {
        ...combat.turn,
        actionAvailable: false,
      },
    };

    // Perform check
    const result = performCheck(
      check,
      storyPack,
      { ...save, runtime: { ...save.runtime, combat: combatWithAttacked } },
      rng
    );

    if (!result) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          combat: combatWithAttacked,
          rngCounter: rng.getCounter(),
        },
      };
    }

    // Update RNG counter and mark as attacked
    let currentSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: combatWithAttacked,
        rngCounter: rng.getCounter(),
        lastCheck: {
          ...result,
          tags: [...result.tags, "combat:npcTurn=1", `combat:npcId=${npcId}`],
        },
      },
    };

    // Apply damage if hit
    currentSave = applyCombatDamageIfHit(check, result, currentSave, rng);

    // Add narration
    const npc = save.actorsById[npcId];
    if (result.success) {
      const rawDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:raw="));
      const soakTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:soak="));
      const finalDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:final="));
      const weaponTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:weapon="));
      
      const rawDamage = rawDamageTag ? parseInt(rawDamageTag.split("=")[1]) : 0;
      const soak = soakTag ? parseInt(soakTag.split("=")[1]) : 0;
      const finalDamage = finalDamageTag ? parseInt(finalDamageTag.split("=")[1]) : 0;
      const weaponId = weaponTag ? weaponTag.split("=")[1] : "unarmed";
      const weaponName = weaponId === "unarmed" ? "i pugni" : (currentSave.weaponsById?.[weaponId]?.name || "l'arma");

      if (finalDamage === 0) {
        currentSave = appendCombatLog(
          currentSave,
          `${npc?.name || npcId} ti colpisce con ${weaponName} ma l'armatura assorbe tutto il colpo (${rawDamage} - ${soak}).`
        );
      } else {
        currentSave = appendCombatLog(
          currentSave,
          `${npc?.name || npcId} ti colpisce con ${weaponName} e infligge ${finalDamage} danni (${rawDamage} - ${soak}).`
        );
      }
    } else {
      currentSave = appendCombatLog(currentSave, `${npc?.name || npcId} manca il colpo.`);
      // Check for successful defense
      const defenseTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:defense="));
      if (defenseTag) {
        const defenseType = defenseTag.split("=")[1];
        if (defenseType === "parry") {
          currentSave = appendCombatLog(currentSave, `Pari il colpo.`);
        } else if (defenseType === "dodge") {
          currentSave = appendCombatLog(currentSave, `Schivi il colpo.`);
        }
      }
    }

    return currentSave;
  } else if (npcHasRanged && weaponRange && dist <= weaponRange.long) {
    // RANGED attack (only if NPC has ranged weapon and distance is within range)
    const check: CombatAttackCheck = {
      id: `combat:npcTurn:${npcId}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: npcId },
        mode: "RANGED",
        weaponId: npcWeaponId === "unarmed" ? null : npcWeaponId,
      },
      defender: {
        actorRef: { mode: "byId", actorId: targetId },
      },
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };

    // Set rangeBand for ranged attacks based on weapon range
    const rangeBand = dist <= weaponRange.short ? "SHORT" : "LONG";
    check.modifiers = {
      rangeBand: rangeBand as any,
    };

    // Consume action
    const combatWithAttacked = {
      ...combat,
      turn: {
        ...combat.turn,
        actionAvailable: false,
      },
    };

    // Perform check
    const result = performCheck(
      check,
      storyPack,
      { ...save, runtime: { ...save.runtime, combat: combatWithAttacked } },
      rng
    );

    if (!result) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          combat: combatWithAttacked,
          rngCounter: rng.getCounter(),
        },
      };
    }

    // Update RNG counter and mark as attacked
    let currentSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: combatWithAttacked,
        rngCounter: rng.getCounter(),
        lastCheck: {
          ...result,
          tags: [...result.tags, "combat:npcTurn=1", `combat:npcId=${npcId}`],
        },
      },
    };

    // Apply damage if hit
    currentSave = applyCombatDamageIfHit(check, result, currentSave, rng);

    // Add narration
    const npc = save.actorsById[npcId];
    if (result.success) {
      const rawDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:raw="));
      const soakTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:soak="));
      const finalDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:final="));
      const weaponTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:weapon="));
      
      const rawDamage = rawDamageTag ? parseInt(rawDamageTag.split("=")[1]) : 0;
      const soak = soakTag ? parseInt(soakTag.split("=")[1]) : 0;
      const finalDamage = finalDamageTag ? parseInt(finalDamageTag.split("=")[1]) : 0;
      const weaponId = weaponTag ? weaponTag.split("=")[1] : "unarmed";
      const weaponName = weaponId === "unarmed" ? "i pugni" : (currentSave.weaponsById?.[weaponId]?.name || "l'arma");

      if (finalDamage === 0) {
        currentSave = appendCombatLog(
          currentSave,
          `${npc?.name || npcId} ti colpisce con ${weaponName} ma l'armatura assorbe tutto il colpo (${rawDamage} - ${soak}).`
        );
      } else {
        currentSave = appendCombatLog(
          currentSave,
          `${npc?.name || npcId} ti colpisce con ${weaponName} e infligge ${finalDamage} danni (${rawDamage} - ${soak}).`
        );
      }
    } else {
      currentSave = appendCombatLog(currentSave, `${npc?.name || npcId} manca il colpo.`);
      // Check for successful defense
      const defenseTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:defense="));
      if (defenseTag) {
        const defenseType = defenseTag.split("=")[1];
        if (defenseType === "parry") {
          currentSave = appendCombatLog(currentSave, `Pari il colpo.`);
        } else if (defenseType === "dodge") {
          currentSave = appendCombatLog(currentSave, `Schivi il colpo.`);
        }
      }
    }

    return currentSave;
  } else {
    // MOVE toward target (one chebyshev step)
    // Calculate direction towards target
    const dx = targetPos.x - npcPos.x;
    const dy = targetPos.y - npcPos.y;

    // Normalize to -1, 0, or 1 for Chebyshev movement
    const moveX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
    const moveY = dy !== 0 ? (dy > 0 ? 1 : -1) : 0;

    const newPos = clampToGrid({ x: npcPos.x + moveX, y: npcPos.y + moveY }, combat.grid);

    const updatedPositions = {
      ...combat.positions,
      [npcId]: newPos,
    };

    // NPC uses 1 movement (simple behavior: move once per turn)
    const updatedCombat = {
      ...combat,
      positions: updatedPositions,
      turn: {
        ...combat.turn,
        moveRemaining: Math.max(0, (combat.turn.moveRemaining ?? 0) - 1),
      },
    };

    const moveCheck: CheckResult = {
      checkId: `combat:npcMove:${npcId}`,
      actorId: npcId,
      roll: 0,
      target: 0,
      success: true,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: [
        "combat:npcTurn=1",
        `combat:npcId=${npcId}`,
        "combat:npcMove=1",
        `combat:pos:${npcId}=${newPos.x},${newPos.y}`,
      ],
    };

    const npc = save.actorsById[npcId];
    const logEntry = `${npc?.name || npcId} avanza verso di te.`;

    let updatedSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: updatedCombat,
        rngCounter: rng.getCounter(),
        lastCheck: moveCheck,
      },
    };

    // Add narration to combat log
    updatedSave = appendCombatLog(updatedSave, logEntry);

    return updatedSave;
  }
}

