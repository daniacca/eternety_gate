import type { Effect, GameSave, StoryPack, CombatAttackCheck, OpposedCheck } from "../types";
import { IRNG, RNG } from "../rng";
import { getCurrentTurnActorId, startCombat, advanceCombatTurn } from "./combat";
import { appendCombatLog, appendAttackNarration } from "./narration";
import { runNpcTurn } from "./npcAi";
import { performCheck } from "../checks";
import { applyCombatDamageIfHit } from "./damage";
import { distanceChebyshev } from "./movement";
import { validateAndApplyRangedModifiers } from "./validation";
import { resolveActor } from "../checks";

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

  const weaponId = attacker.equipment?.weaponId ?? null;

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
 * Disarm: opposed WS vs WS; if attacker wins -> remove defender weapon and add to groundItems
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
  const defenderWeaponId = defender.equipment?.weaponId ?? null;
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
    const updatedDefender = {
      ...defender,
      equipment: {
        ...defender.equipment,
        weaponId: null,
      },
    };

    const updatedActorsById = {
      ...currentSave.actorsById,
      [effect.defenderId]: updatedDefender,
    };

    // Add weapon to groundItems at defender position
    const groundItems = [...(combat.groundItems || [])];
    groundItems.push({
      kind: "weapon",
      weaponId: defenderWeaponId,
      x: defenderPos.x,
      y: defenderPos.y,
      ownerId: effect.defenderId,
    });

    const updatedCombat = {
      ...combatWithActionConsumed,
      groundItems,
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
 * Pickup: picks up item at actor position, equips if main hand empty, otherwise adds to inventory
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

  // Find item at actor position
  const groundItems = combat.groundItems || [];
  const itemIndex = groundItems.findIndex((item) => item.x === actorPos.x && item.y === actorPos.y);

  if (itemIndex === -1) {
    const actor = save.actorsById[effect.actorId];
    const logEntry =
      actor?.kind === "PC"
        ? `Non c'è nulla da raccogliere qui.`
        : `${actor?.name || effect.actorId} cerca di raccogliere qualcosa ma non trova nulla.`;
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

  const item = groundItems[itemIndex];
  const actor = save.actorsById[effect.actorId];
  if (!actor) {
    return { save };
  }

  if (item.kind === "weapon") {
    // Check if actor already has a weapon equipped
    const currentWeaponId = actor.equipment?.weaponId ?? null;
    if (currentWeaponId && currentWeaponId !== "unarmed") {
      // Actor already has a weapon - do not remove ground item
      const logEntry =
        actor.kind === "PC" ? `Hai già un'arma in mano.` : `${actor.name || effect.actorId} ha già un'arma in mano.`;
      // Still consume movement
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

    // Main hand is empty - remove item from ground and equip it
    const updatedGroundItems = groundItems.filter((_, idx) => idx !== itemIndex);
    const updatedCombat = {
      ...combat,
      turn: {
        ...combat.turn,
        moveRemaining: 0,
      },
      groundItems: updatedGroundItems,
    };

    let currentSave: GameSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: updatedCombat,
      },
    };

    const updatedActor = {
      ...actor,
      equipment: {
        ...actor.equipment,
        weaponId: item.weaponId,
      },
    };

    currentSave = {
      ...currentSave,
      actorsById: {
        ...currentSave.actorsById,
        [effect.actorId]: updatedActor,
      },
    };

    const weaponName = save.weaponsById?.[item.weaponId]?.name || "l'arma";
    const logEntry =
      actor.kind === "PC"
        ? `Raccogli ${weaponName} e la equipaggi.`
        : `${actor.name || effect.actorId} raccoglie ${weaponName} e la equipaggia.`;
    currentSave = appendCombatLog(currentSave, logEntry);

    return { save: currentSave };
  }

  // Non-weapon items (future)
  return { save };
}
