import type { Effect, GameSave, StoryPack, CombatAttackCheck, OpposedCheck, ItemRef } from "../types";
import { IRNG, RNG } from "../rng";
import { getCurrentTurnActorId, startCombat, advanceCombatTurn } from "./combat";
import { appendCombatLog, appendAttackNarration } from "./narration";
import { runNpcTurn } from "./npcAi";
import { performCheck } from "../checks";
import { applyCombatDamageIfHit } from "./damage";
import { distanceChebyshev } from "./movement";
import { validateAndApplyRangedModifiers } from "./validation";
import { resolveActor } from "../checks";
import { posKey, getEquippedWeaponId, getActorInventory, isWeaponItemRef } from "../inventory";

/**
 * Starts combat with given participant IDs, grid, and placements
 */
export function combatStart(
  effect: Extract<Effect, { op: "combatStart" }>,
  storyPack: StoryPack,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  return {
    save: startCombat(
      storyPack,
      save,
      effect.participantIds,
      save.runtime.currentSceneId,
      effect.grid,
      effect.placements
    ),
  };
}

/**
 * Moves actor in combat grid
 */
export function combatMove(
  effect: Extract<Effect, { op: "combatMove" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    // Not in combat - ignore
    const ignoredCheck = {
      checkId: "combat:move:ignored",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:move:ignored"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: ignoredCheck,
        },
      },
    };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (combat.turn.moveRemaining <= 0) {
    // Movement exhausted
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=movementExhausted"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Calculate delta based on direction
  const dirDeltas: Record<string, { x: number; y: number }> = {
    N: { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E: { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S: { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W: { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
  };

  const delta = dirDeltas[effect.dir];
  if (!delta) {
    return { save };
  }

  const currentPos = combat.positions[turnActorId] || { x: 0, y: 0 };
  const newPos = {
    x: Math.max(0, Math.min(combat.grid.width - 1, currentPos.x + delta.x)),
    y: Math.max(0, Math.min(combat.grid.height - 1, currentPos.y + delta.y)),
  };

  const updatedPositions = {
    ...combat.positions,
    [turnActorId]: newPos,
  };

  const updatedCombat = {
    ...combat,
    positions: updatedPositions,
    turn: {
      ...combat.turn,
      moveRemaining: Math.max(0, combat.turn.moveRemaining - 1),
    },
  };

  const moveCheck = {
    checkId: "combat:move",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: [`combat:move=${effect.dir}`, `combat:pos:${turnActorId}=${newPos.x},${newPos.y}`],
  };

  const actor = save.actorsById[turnActorId];
  const dirLabels: Record<string, string> = {
    N: "nord",
    NE: "nord-est",
    E: "est",
    SE: "sud-est",
    S: "sud",
    SW: "sud-ovest",
    W: "ovest",
    NW: "nord-ovest",
  };
  const dirLabel = dirLabels[effect.dir] || effect.dir;
  const logEntry =
    actor?.kind === "PC" ? `Ti muovi verso ${dirLabel}.` : `${actor?.name || turnActorId} avanza verso di te.`;

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: moveCheck,
    },
  };

  // Add narration to combat log
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return { save: updatedSave };
}

/**
 * Defend action: consumes action and sets stance to "defend"
 */
export function combatDefend(
  effect: Extract<Effect, { op: "combatDefend" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:defend:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:defend:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Update stance in stancesByActorId
  const updatedStancesByActorId = {
    ...(combat.stancesByActorId || {}),
    [turnActorId]: "defend" as const,
  };

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false, // Consume action
    },
    stancesByActorId: updatedStancesByActorId,
  };

  const defendCheck = {
    checkId: "combat:defend",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: ["combat:defend=1", "combat:stance=defend"],
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: defendCheck,
    },
  };

  // Add narration
  const actor = save.actorsById[turnActorId];
  const logEntry =
    actor?.kind === "PC"
      ? `Assumi una posizione difensiva.`
      : `${actor?.name || turnActorId} assume una posizione difensiva.`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return { save: updatedSave };
}

/**
 * Centralized attack resolution: the only place that resolves attacks end-to-end
 * Validates combat, turn, action availability, performs check, applies damage, handles KO
 */
export function combatRequestAttack(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.attackerId) {
    // Not attacker's turn
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate distance and range
  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noPosition"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const dist = distanceChebyshev(attackerPos, defenderPos);

  // Range validation
  if (effect.mode === "MELEE") {
    if (dist > 1) {
      const blockedCheck = {
        checkId: "combat:attack:blocked",
        actorId: effect.attackerId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none" as const,
        tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
      };
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  } else if (effect.mode === "RANGED") {
    // Validate ranged modifiers (this may return a blocked check)
    const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, save);
    if (!attacker) {
      return { save };
    }
    // Note: validateAndApplyRangedModifiers expects a CombatAttackCheck, we'll build it below
  }

  // Build CombatAttackCheck
  const check: CombatAttackCheck = {
    id: `combat:requestAttack:${effect.attackerId}:${effect.defenderId}`,
    kind: "combatAttack",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      mode: effect.mode,
      weaponId: effect.weaponId ?? null,
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
    },
    defense: effect.defense || {
      allowParry: true,
      allowDodge: true,
      strategy: "autoBest",
    },
    modifiers: effect.modifiers,
  };

  // For ranged attacks, validate modifiers
  if (effect.mode === "RANGED") {
    const blockedCheck = validateAndApplyRangedModifiers(check, save, dist, check.id, effect.attackerId);
    if (blockedCheck) {
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  }

  // Consume action
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Perform check
  const result = performCheck(check, storyPack, currentSave, rng);
  if (!result) {
    return { save: currentSave };
  }

  // Update lastCheck
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      rngCounter: rng.getCounter(),
    },
  };

  // Apply damage if hit
  const damageResult = applyCombatDamageIfHit(check, result, currentSave, rng, storyPack);
  currentSave = damageResult.save;

  // Handle death and game over
  if (damageResult.actorDied) {
    const deadActor = currentSave.actorsById[effect.defenderId];
    if (deadActor) {
      const pcDied = deadActor.kind === "PC";

      // Check if all party members are dead/KO
      const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
      const allPartyDead =
        partyActors.length > 0 &&
        partyActors.every((actor) => actor.resources.isDead === true || actor.resources.hp <= 0);

      if (pcDied || allPartyDead) {
        // Set game over
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            gameOver: {
              reason: pcDied ? "playerDead" : "partyDead",
              sceneId: currentSave.runtime.currentSceneId,
            },
            combat: undefined, // End combat cleanly
          },
        };
        currentSave = appendCombatLog(currentSave, "Game Over.");
      }
    }
  }

  // Add narration for attack result (consolidated function)
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
  currentSave = appendAttackNarration(currentSave, attacker, defender, result);

  // Handle KO and end combat if needed (use targetKo from damageResult)
  if (damageResult.targetKo && currentSave.runtime.combat?.active) {
    const aliveParticipants = currentSave.runtime.combat.participants.filter((id) => {
      const actor = currentSave.actorsById[id];
      return actor && actor.resources.hp > 0;
    });

    if (aliveParticipants.length <= 1) {
      // Combat ends
      const winnerId = aliveParticipants.length === 1 ? aliveParticipants[0] : null;
      const winner = winnerId ? currentSave.actorsById[winnerId] : null;
      currentSave = appendCombatLog(currentSave, `Il combattimento termina. Vincitore: ${winner?.name || "Nessuno"}.`);
      currentSave = {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          combat: undefined,
          combatEndedSceneId: currentSave.runtime.currentSceneId,
        },
      };
    }
  }

  // Emit onSuccess/onFailure effects based on attack result
  const emittedEffects: Effect[] = [];
  if (result.success) {
    // Attack hit - emit onSuccess effects
    if (effect.onSuccessEffects && effect.onSuccessEffects.length > 0) {
      emittedEffects.push(...effect.onSuccessEffects);
    }
    // Also emit effects from damage (e.g., critical damage conditions)
    if (damageResult.effects && damageResult.effects.length > 0) {
      emittedEffects.push(...damageResult.effects);
    }
  } else {
    // Attack missed (including parry/dodge) - emit onFailure effects
    if (effect.onFailureEffects && effect.onFailureEffects.length > 0) {
      emittedEffects.push(...effect.onFailureEffects);
    }
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}

/**
 * All-Out Attack effect: sets stance, disables parry for attacker, and triggers immediate attack
 */
export function combatAllOut(
  effect: Extract<Effect, { op: "combatAllOut" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat || !combat.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId) {
    return { save };
  }

  // Validate action available
  if (!combat.turn.actionAvailable) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate target in melee range
  const attackerPos = combat.positions[turnActorId];
  const targetPos = combat.positions[effect.targetId];
  if (!attackerPos || !targetPos) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noPosition"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const dist = distanceChebyshev(attackerPos, targetPos);
  if (dist > 1) {
    const blockedCheck = {
      checkId: "combat:allOut:blocked",
      actorId: turnActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Set stance to "allOut"
  const updatedStancesByActorId = {
    ...(combat.stancesByActorId || {}),
    [turnActorId]: "allOut" as const,
  };

  // Set parry disabled until attacker's next turn
  const currentTurnCounter = combat.turnCounter ?? 0;
  const parryDisabledUntilTurnCounterByActorId = {
    ...(combat.parryDisabledUntilTurnCounterByActorId || {}),
    [turnActorId]: currentTurnCounter + 1,
  };

  const updatedCombat = {
    ...combat,
    stancesByActorId: updatedStancesByActorId,
    parryDisabledUntilTurnCounterByActorId,
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  // Add narration for all-out attack
  const actor = save.actorsById[turnActorId];
  const logEntry =
    actor?.kind === "PC"
      ? `Ti sbilanci in un attacco totale!`
      : `${actor?.name || turnActorId} si sbilancia in un attacco totale!`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  // Get attacker weapon
  const attacker = resolveActor({ mode: "byId", actorId: turnActorId }, updatedSave);
  if (!attacker) {
    return { save: updatedSave };
  }

  const weaponId = getEquippedWeaponId(attacker);

  // Emit combatRequestAttack effect with explicit +20 hitBonus modifier
  const attackEffect: Effect = {
    op: "combatRequestAttack",
    attackerId: turnActorId,
    defenderId: effect.targetId,
    mode: "MELEE",
    weaponId: weaponId === "unarmed" ? null : weaponId,
    modifiers: {
      hitBonus: 20,
    },
    defense: {
      allowParry: true,
      allowDodge: true,
      strategy: "autoBest",
    },
  };

  return { save: updatedSave, emittedEffects: [attackEffect] };
}

/**
 * Aim action: consumes action (stub for future +20 bonus)
 */
export function combatAim(
  effect: Extract<Effect, { op: "combatAim" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:aim:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:aim:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionSpent"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      // Future: add aimed flag here
    },
  };

  const aimCheck = {
    checkId: "combat:aim",
    actorId: turnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: ["combat:aim=1"],
  };

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: aimCheck,
    },
  };

  // Add narration
  const actor = save.actorsById[turnActorId];
  const logEntry = actor?.kind === "PC" ? `Prendi la mira.` : `${actor?.name || turnActorId} prende la mira.`;
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return { save: updatedSave };
}

/**
 * Ends the current turn and advances to next actor, running NPC turns until player's turn
 */
export function combatEndTurn(
  effect: Extract<Effect, { op: "combatEndTurn" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    // Not player's turn - ignore
    return { save };
  }

  // Add narration before ending turn
  const actor = save.actorsById[turnActorId];
  const logEntry = actor?.kind === "PC" ? `Termini il turno.` : `${actor?.name || turnActorId} termina il turno.`;
  let currentSave: GameSave = appendCombatLog(save, logEntry);

  // Set combatCycleStartIndex to the start of the player's turn that just ended
  // This represents "the start of the turn that includes all player actions + 'Termini il turno'"
  // Must be captured BEFORE advanceCombatTurn changes combatTurnStartIndex
  const cycleStart = save.runtime.combatTurnStartIndex ?? 0;
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      rngCounter: rng.getCounter(),
      combatCycleStartIndex: cycleStart,
    },
  };
  currentSave = advanceCombatTurn(currentSave);

  // Loop: run NPC turns until it's player's turn again
  let safety = 0;
  while (currentSave.runtime.combat?.active && getCurrentTurnActorId(currentSave) !== currentSave.party.activeActorId) {
    const npcId = getCurrentTurnActorId(currentSave);
    if (!npcId) break;

    const npcRng = new RNG(currentSave.runtime.rngSeed, currentSave.runtime.rngCounter || 0);
    currentSave = runNpcTurn(storyPack, currentSave, npcId);
    currentSave = advanceCombatTurn(currentSave);

    safety++;
    if (safety > 10) break; // safety guard
  }

  return { save: currentSave };
}

/**
 * Knockdown: opposed STR vs STR; if attacker wins -> addCondition(prone) on defender
 */
export function combatKnockdown(
  effect: Extract<Effect, { op: "combatKnockdown" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.attackerId) {
    return { save };
  }

  if (!combat.turn.actionAvailable) {
    const blockedCheck = {
      checkId: "combat:knockdown:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate melee range
  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    return { save };
  }

  const dist = distanceChebyshev(attackerPos, defenderPos);
  if (dist > 1) {
    const blockedCheck = {
      checkId: "combat:knockdown:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Consume action
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Perform opposed STR check
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
  if (!attacker || !defender) {
    return { save: currentSave };
  }

  const opposedCheck: OpposedCheck = {
    id: `combat:knockdown:${effect.attackerId}:${effect.defenderId}`,
    kind: "opposed",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      key: "STR",
      difficulty: "NORMAL",
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
      key: "STR",
      difficulty: "NORMAL",
    },
  };

  const result = performCheck(opposedCheck, storyPack, currentSave, rng);
  if (!result) {
    return { save: currentSave };
  }

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      rngCounter: rng.getCounter(),
    },
  };

  const emittedEffects: Effect[] = [];
  if (result.success) {
    // Attacker wins - add prone condition
    emittedEffects.push({
      op: "addCondition",
      actorId: effect.defenderId,
      condition: "prone",
      source: "knockdown",
    });

    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry = attacker.kind === "PC" ? `Atterri ${defenderName}!` : `${attackerName} atterra ${defenderName}!`;
    currentSave = appendCombatLog(currentSave, logEntry);
  } else {
    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry =
      attacker.kind === "PC"
        ? `Tenti di atterrare ${defenderName} ma resiste.`
        : `${attackerName} tenta di atterrare ${defenderName} ma resiste.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}

/**
 * Disarm: opposed WS vs WS; if attacker wins -> remove defender weapon and add to groundItemsByPos
 */
export function combatDisarm(
  effect: Extract<Effect, { op: "combatDisarm" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.attackerId) {
    return { save };
  }

  if (!combat.turn.actionAvailable) {
    const blockedCheck = {
      checkId: "combat:disarm:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate melee range
  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    return { save };
  }

  const dist = distanceChebyshev(attackerPos, defenderPos);
  if (dist > 1) {
    const blockedCheck = {
      checkId: "combat:disarm:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, save);
  if (!defender) {
    return { save };
  }

  // Check if defender has a weapon
  const defenderMainHand = defender.equipment?.mainHand;
  const defenderWeaponId = defenderMainHand?.kind === "weapon" ? defenderMainHand.id : null;

  if (!defenderWeaponId || defenderWeaponId === "unarmed") {
    const blockedCheck = {
      checkId: "combat:disarm:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=defenderUnarmed"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Consume action
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Perform opposed WS check
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  if (!attacker) {
    return { save: currentSave };
  }

  const opposedCheck: OpposedCheck = {
    id: `combat:disarm:${effect.attackerId}:${effect.defenderId}`,
    kind: "opposed",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      key: "WS",
      difficulty: "NORMAL",
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
      key: "WS",
      difficulty: "NORMAL",
    },
  };

  const result = performCheck(opposedCheck, storyPack, currentSave, rng);
  if (!result) {
    return { save: currentSave };
  }

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      rngCounter: rng.getCounter(),
    },
  };

  if (result.success) {
    // Attacker wins - disarm defender
    // Create ItemRef for the weapon being dropped
    const weaponItemRef: ItemRef = { kind: "weapon", id: defenderWeaponId };

    // Update defender equipment (clear mainHand)
    const updatedDefender = {
      ...defender,
      equipment: {
        ...defender.equipment,
        mainHand: null,
      },
    };

    const updatedActorsById = {
      ...currentSave.actorsById,
      [effect.defenderId]: updatedDefender,
    };

    // Add weapon to groundItemsByPos at defender position
    const posKeyStr = posKey(defenderPos);
    const currentGroundItemsByPos = combat.groundItemsByPos || {};
    const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
    const updatedGroundItemsByPos = {
      ...currentGroundItemsByPos,
      [posKeyStr]: [...itemsAtPos, weaponItemRef],
    };

    const updatedCombat = {
      ...combatWithActionConsumed,
      groundItemsByPos: updatedGroundItemsByPos,
    };

    currentSave = {
      ...currentSave,
      actorsById: updatedActorsById,
      runtime: {
        ...currentSave.runtime,
        combat: updatedCombat,
      },
    };

    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const weaponName = save.weaponsById?.[defenderWeaponId]?.name || "l'arma";
    const logEntry =
      attacker.kind === "PC"
        ? `Disarmi ${defenderName}! ${weaponName} cade a terra.`
        : `${attackerName} disarma ${defenderName}! ${weaponName} cade a terra.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  } else {
    const attackerName = attacker.name || effect.attackerId;
    const defenderName = defender.name || effect.defenderId;
    const logEntry =
      attacker.kind === "PC"
        ? `Tenti di disarmare ${defenderName} ma fallisci.`
        : `${attackerName} tenta di disarmare ${defenderName} ma fallisce.`;
    currentSave = appendCombatLog(currentSave, logEntry);
  }

  return { save: currentSave };
}

/**
 * Get Prone: consumes all movement, adds prone condition
 */
export function combatGetProne(
  effect: Extract<Effect, { op: "combatGetProne" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  // Consume all movement and add prone condition
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  const emittedEffects: Effect[] = [
    {
      op: "addCondition",
      actorId: effect.actorId,
      condition: "prone",
      source: "getProne",
    },
  ];

  const actor = save.actorsById[effect.actorId];
  const logEntry = actor?.kind === "PC" ? `Ti metti a terra.` : `${actor?.name || effect.actorId} si mette a terra.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave, emittedEffects };
}

/**
 * Stand Up: consumes all movement, removes prone condition
 */
export function combatStandUp(
  effect: Extract<Effect, { op: "combatStandUp" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  // Consume all movement and remove prone condition
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  const emittedEffects: Effect[] = [
    {
      op: "removeCondition",
      actorId: effect.actorId,
      condition: "prone",
    },
  ];

  const actor = save.actorsById[effect.actorId];
  const logEntry = actor?.kind === "PC" ? `Ti alzi in piedi.` : `${actor?.name || effect.actorId} si alza in piedi.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave, emittedEffects };
}

/**
 * Pickup: picks up item at actor position, adds to inventory, and optionally auto-equips if main hand empty
 */
export function combatPickup(
  effect: Extract<Effect, { op: "combatPickup" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  const actorPos = combat.positions[effect.actorId];
  if (!actorPos) {
    return { save };
  }

  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  // Check groundItemsByPos structure
  const posKeyStr = posKey(actorPos);
  let itemRef: ItemRef | null = null;
  let updatedGroundItemsByPos: Record<string, ItemRef[]> | undefined = undefined;

  if (combat.groundItemsByPos && combat.groundItemsByPos[posKeyStr] && combat.groundItemsByPos[posKeyStr].length > 0) {
    const itemsAtPos = combat.groundItemsByPos[posKeyStr];
    itemRef = itemsAtPos[0]; // Pick first item
    const remainingItems = itemsAtPos.slice(1);
    // Remove key if empty, otherwise update with remaining items
    if (remainingItems.length === 0) {
      const { [posKeyStr]: _, ...rest } = combat.groundItemsByPos;
      updatedGroundItemsByPos = Object.keys(rest).length > 0 ? rest : undefined;
    } else {
      updatedGroundItemsByPos = {
        ...combat.groundItemsByPos,
        [posKeyStr]: remainingItems,
      };
    }
  }

  if (!itemRef) {
    const logEntry =
      actor.kind === "PC"
        ? `Non c'è nulla da raccogliere qui.`
        : `${actor.name || effect.actorId} cerca di raccogliere qualcosa ma non trova nulla.`;
    // Consume all movement regardless of success/failure
    const updatedCombat = {
      ...combat,
      turn: {
        ...combat.turn,
        moveRemaining: 0,
      },
    };
    const updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: updatedCombat,
      },
    };
    return { save: appendCombatLog(updatedSave, logEntry) };
  }

  // Add item to inventory
  const currentInventory = getActorInventory(actor);
  const updatedInventory = [...currentInventory, itemRef];

  // Check if mainHand is empty and item is a weapon - auto-equip
  const mainHandEmpty = !actor.equipment?.mainHand;
  const isWeapon = isWeaponItemRef(itemRef);
  const shouldAutoEquip = mainHandEmpty && isWeapon;

  let updatedActor = {
    ...actor,
    inventory: updatedInventory,
  };

  if (shouldAutoEquip) {
    // Remove from inventory (since we're equipping it)
    updatedActor = {
      ...updatedActor,
      inventory: currentInventory, // Don't add to inventory, equip instead
      equipment: {
        ...actor.equipment,
        mainHand: itemRef,
      },
    };
  }

  // Update combat state
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
    ...(updatedGroundItemsByPos !== undefined && { groundItemsByPos: updatedGroundItemsByPos }),
  };

  let currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  // Generate log message
  let itemName = "l'oggetto";
  if (itemRef.kind === "weapon") {
    itemName = save.weaponsById?.[itemRef.id]?.name || "l'arma";
  } else if (itemRef.kind === "armor") {
    itemName = save.armorsById?.[itemRef.id]?.name || "l'armatura";
  }

  let logEntry: string;
  if (shouldAutoEquip) {
    logEntry =
      actor.kind === "PC"
        ? `Raccogli ${itemName} e la equipaggi.`
        : `${actor.name || effect.actorId} raccoglie ${itemName} e la equipaggia.`;
  } else {
    logEntry =
      actor.kind === "PC"
        ? `Raccogli ${itemName} e la metti nell'inventario.`
        : `${actor.name || effect.actorId} raccoglie ${itemName} e la mette nell'inventario.`;
  }

  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave };
}

/**
 * Drop: drops an item from inventory or equipment to the ground at actor position
 */
export function combatDrop(
  effect: Extract<Effect, { op: "combatDrop" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.actorId) {
    return { save };
  }

  if (combat.turn.moveRemaining <= 0) {
    return { save };
  }

  const actorPos = combat.positions[effect.actorId];
  if (!actorPos) {
    return { save };
  }

  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  let itemRef: ItemRef | null = null;
  let updatedActor = { ...actor };

  // Determine what to drop
  if (effect.fromSlot === "mainHand" || (!effect.fromSlot && !effect.itemRef && !effect.inventoryIndex)) {
    // Drop equipped mainHand (default behavior)
    itemRef = actor.equipment?.mainHand ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          mainHand: null,
        },
      };
    }
  } else if (effect.fromSlot === "offHand") {
    itemRef = actor.equipment?.offHand ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          offHand: null,
        },
      };
    }
  } else if (effect.fromSlot === "armor") {
    itemRef = actor.equipment?.armor ?? null;
    if (itemRef) {
      updatedActor = {
        ...updatedActor,
        equipment: {
          ...updatedActor.equipment,
          armor: null,
        },
      };
    }
  } else if (effect.fromSlot === "inventory" && effect.inventoryIndex !== undefined) {
    // Drop from inventory
    const inventory = getActorInventory(actor);
    if (effect.inventoryIndex >= 0 && effect.inventoryIndex < inventory.length) {
      itemRef = inventory[effect.inventoryIndex];
      updatedActor = {
        ...updatedActor,
        inventory: inventory.filter((_, idx) => idx !== effect.inventoryIndex),
      };
    }
  } else if (effect.itemRef) {
    // Drop specific item (find in inventory or equipment)
    itemRef = effect.itemRef;
    const inventory = getActorInventory(actor);
    const inventoryIndex = inventory.findIndex((item) => item.kind === itemRef!.kind && item.id === itemRef!.id);
    if (inventoryIndex !== -1) {
      updatedActor = {
        ...updatedActor,
        inventory: inventory.filter((_, idx) => idx !== inventoryIndex),
      };
    } else {
      // Check equipment slots
      if (actor.equipment?.mainHand?.kind === itemRef.kind && actor.equipment.mainHand.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            mainHand: null,
          },
        };
      } else if (actor.equipment?.offHand?.kind === itemRef.kind && actor.equipment.offHand.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            offHand: null,
          },
        };
      } else if (actor.equipment?.armor?.kind === itemRef.kind && actor.equipment.armor.id === itemRef.id) {
        updatedActor = {
          ...updatedActor,
          equipment: {
            ...updatedActor.equipment,
            armor: null,
          },
        };
      } else {
        // Item not found
        return { save };
      }
    }
  }

  if (!itemRef) {
    return { save };
  }

  // Add item to ground at actor position
  const posKeyStr = posKey(actorPos);
  const currentGroundItemsByPos = combat.groundItemsByPos || {};
  const itemsAtPos = currentGroundItemsByPos[posKeyStr] || [];
  const updatedGroundItemsByPos = {
    ...currentGroundItemsByPos,
    [posKeyStr]: [...itemsAtPos, itemRef],
  };

  // Update combat state
  const updatedCombat = {
    ...combat,
    turn: {
      ...combat.turn,
      moveRemaining: 0,
    },
    groundItemsByPos: updatedGroundItemsByPos,
  };

  let currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
    },
  };

  // Generate log message
  let itemName = "l'oggetto";
  if (itemRef.kind === "weapon") {
    itemName = save.weaponsById?.[itemRef.id]?.name || "l'arma";
  } else if (itemRef.kind === "armor") {
    itemName = save.armorsById?.[itemRef.id]?.name || "l'armatura";
  }

  const logEntry =
    actor.kind === "PC"
      ? `Lasci cadere ${itemName} a terra.`
      : `${actor.name || effect.actorId} lascia cadere ${itemName} a terra.`;
  currentSave = appendCombatLog(currentSave, logEntry);

  return { save: currentSave };
}

/**
 * EquipItem: equips an item from inventory into a slot (swaps if slot occupied)
 */
export function combatEquipItem(
  effect: Extract<Effect, { op: "combatEquipItem" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  const inventory = getActorInventory(actor);
  let itemRef: ItemRef | null = null;
  let updatedInventory = [...inventory];

  // Find item in inventory
  if (effect.inventoryIndex !== undefined) {
    if (effect.inventoryIndex >= 0 && effect.inventoryIndex < inventory.length) {
      itemRef = inventory[effect.inventoryIndex];
      updatedInventory = inventory.filter((_, idx) => idx !== effect.inventoryIndex);
    }
  } else {
    // Find by itemRef
    const index = inventory.findIndex((item) => item.kind === effect.itemRef.kind && item.id === effect.itemRef.id);
    if (index !== -1) {
      itemRef = inventory[index];
      updatedInventory = inventory.filter((_, idx) => idx !== index);
    }
  }

  if (!itemRef) {
    // Item not found in inventory
    return { save };
  }

  // Validate slot compatibility
  if (effect.slot === "mainHand" && itemRef.kind !== "weapon") {
    return { save }; // Can only equip weapons to mainHand
  }
  if (effect.slot === "armor" && itemRef.kind !== "armor") {
    return { save }; // Can only equip armor to armor slot
  }

  // Get currently equipped item (for swap)
  const currentlyEquipped = actor.equipment?.[effect.slot] ?? null;

  // Update actor
  let updatedActor = {
    ...actor,
    inventory: updatedInventory,
    equipment: {
      ...actor.equipment,
      [effect.slot]: itemRef,
    },
  };

  // If slot was occupied, add old item to inventory
  if (currentlyEquipped) {
    updatedActor = {
      ...updatedActor,
      inventory: [...updatedActor.inventory, currentlyEquipped],
    };
  }

  const currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };

  return { save: currentSave };
}

/**
 * UnequipItem: moves an equipped item back to inventory
 */
export function combatUnequipItem(
  effect: Extract<Effect, { op: "combatUnequipItem" }>,
  save: GameSave
): { save: GameSave; emittedEffects?: Effect[] } {
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  const itemRef = actor.equipment?.[effect.slot] ?? null;
  if (!itemRef) {
    return { save }; // Slot is empty
  }

  const inventory = getActorInventory(actor);
  const updatedActor = {
    ...actor,
    inventory: [...inventory, itemRef],
    equipment: {
      ...actor.equipment,
      [effect.slot]: null,
    },
  };

  const currentSave: GameSave = {
    ...save,
    actorsById: {
      ...save.actorsById,
      [effect.actorId]: updatedActor,
    },
  };

  return { save: currentSave };
}
