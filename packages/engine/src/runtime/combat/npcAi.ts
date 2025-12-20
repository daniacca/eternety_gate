import type { StoryPack, GameSave, ActorId, CombatAttackCheck, CheckResult } from "../types";
import { RNG } from "../rng";
import { performCheck, resolveActor } from "../checks";
import { distanceChebyshev, clampToGrid } from "./movement";
import { appendCombatLog } from "./narration";

/**
 * Applies combat damage when a combatAttack check hits
 */
function applyCombatDamageIfHit(check: any, result: CheckResult, save: GameSave): GameSave {
  if (!result || check.kind !== "combatAttack" || !result.success) return save;

  const combatCheck = check as CombatAttackCheck;
  const defender = resolveActor(combatCheck.defender.actorRef, save);

  if (!defender) {
    // Defender not found, skip damage application
    return save;
  }

  // Calculate damage: max(1, 1 + result.dos)
  const damage = Math.max(1, 1 + (result.dos ?? 0));

  // Get current HP
  const hpBefore = defender.resources.hp;
  const hpAfter = Math.max(0, hpBefore - damage);

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
            `combat:damage=${damage}`,
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

    currentSave = applyCombatDamageIfHit(check, result, currentSave);
    return currentSave;
  }

  // Get positions
  const npcPos = combat.positions[npcId];
  const targetPos = combat.positions[targetId];

  if (!npcPos || !targetPos) {
    return save;
  }

  const dist = distanceChebyshev(npcPos, targetPos);

  // Check if NPC has ranged capability
  const npc = save.actorsById[npcId];
  const npcTags = npc?.tags || [];
  const npcHasRanged = npcTags.includes("ai:ranged=1");

  // Decision logic:
  // 1. If dist <= 1: MELEE attack
  // 2. Else if npcHasRanged && dist <= 8: RANGED attack
  // 3. Else: MOVE toward target

  if (dist <= 1) {
    // MELEE attack
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
    currentSave = applyCombatDamageIfHit(check, result, currentSave);

    // Add narration
    const npc = save.actorsById[npcId];
    if (result.success) {
      const damageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage="));
      const damage = damageTag ? parseInt(damageTag.split("=")[1]) : 0;
      currentSave = appendCombatLog(currentSave, `${npc?.name || npcId} ti colpisce e infligge ${damage} danni.`);
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
  } else if (npcHasRanged && dist <= 8) {
    // RANGED attack (only if NPC has ranged capability and distance is within range)
    const check: CombatAttackCheck = {
      id: `combat:npcTurn:${npcId}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: npcId },
        mode: "RANGED",
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

    // Set rangeBand for ranged attacks
    const rangeBand = dist <= 4 ? "SHORT" : "LONG";
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
    currentSave = applyCombatDamageIfHit(check, result, currentSave);

    // Add narration
    const npc = save.actorsById[npcId];
    if (result.success) {
      const damageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage="));
      const damage = damageTag ? parseInt(damageTag.split("=")[1]) : 0;
      currentSave = appendCombatLog(currentSave, `${npc?.name || npcId} ti colpisce e infligge ${damage} danni.`);
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

