import type { Effect, GameSave, StoryPack, CombatAttackCheck, CheckResult } from "../../types";
import { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendAttackNarration, nextRuntimeSeq } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { applyCombatDamageIfHit } from "../damage";
import { distanceChebyshev } from "../movement";
import { validateAndApplyRangedModifiers } from "../validation";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";

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
  // Include mode and special modifiers in checkId for better identification
  const checkIdSuffix = effect.modifiers?.hitBonus === 20 ? ":allOut" : "";
  const check: CombatAttackCheck = {
    id: `combat:requestAttack:${effect.mode.toLowerCase()}:${effect.attackerId}:${effect.defenderId}${checkIdSuffix}`,
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

  // Consume action (but NOT aim stance yet - it needs to be available during check calculation)
  // IMPORTANT: Include stancesByActorId so aim stance is available during check
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
    stancesByActorId: combat.stancesByActorId, // Keep aim stance for check calculation
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Generate deterministic resolutionId for this attack resolution
  // This will correlate the attack check, defense check (if any), and damage entry
  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:${seq}`;
  currentSave = saveWithSeq;

  // Perform check (aim stance is still available here, so bonus will be applied)
  // performCheckWithSave handles all logging automatically (attack + defense if party members)
  const { result, save: afterCheckSave } = performCheckWithSave(check, storyPack, currentSave, rng, resolutionId);
  if (!result) {
    return { save: currentSave };
  }

  // Use the updated save from performCheckWithSave (includes all check logs)
  currentSave = afterCheckSave;

  // Resolve attacker to check if it's a player actor (for lastPlayerCheck)
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  const isPlayerActor = attacker?.kind === "PC";

  // NOW consume aim stance if this was a ranged attack (after check is performed)
  let updatedStancesByActorId = combat.stancesByActorId;
  if (effect.mode === "RANGED" && updatedStancesByActorId?.[effect.attackerId] === "aim") {
    updatedStancesByActorId = {
      ...updatedStancesByActorId,
    };
    delete updatedStancesByActorId[effect.attackerId];
    currentSave = {
      ...currentSave,
      runtime: {
        ...currentSave.runtime,
        combat: {
          ...currentSave.runtime.combat!,
          stancesByActorId: updatedStancesByActorId,
        },
      },
    };
  }

  // Update lastCheck and lastPlayerCheck (for UI)
  // This ensures checks from emitted effects (like All-Out Attack) are visible in the UI
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      lastPlayerCheck: isPlayerActor ? result : currentSave.runtime.lastPlayerCheck,
      rngCounter: rng.getCounter(),
    },
  };

  // Load catalogs from storyPack (if available) or use empty catalogs
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Apply damage if hit (pass resolutionId to correlate with check)
  const damageResult = applyCombatDamageIfHit(check, result, currentSave, rng, storyPack, resolutionId, catalogs);
  currentSave = damageResult.save;

  // Handle death and game over
  if (damageResult.actorDied) {
    const deadActor = currentSave.actorsById[effect.defenderId];
    if (deadActor) {
      const pcDied = deadActor.kind === "PC";

      // Check if all party members are dead
      const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
      const allPartyDead = partyActors.length > 0 && partyActors.every((actor) => actor.resources.isDead === true);

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
  // attacker is already resolved above (line 493)
  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
  if (attacker && defender) {
    currentSave = appendAttackNarration(currentSave, attacker, defender, result);
  }

  // Handle death and end combat if needed (check isDead, not HP)
  if (damageResult.actorDied && currentSave.runtime.combat?.active) {
    const deadActor = currentSave.actorsById[effect.defenderId];
    if (deadActor && deadActor.resources.isDead === true) {
      const aliveParticipants = currentSave.runtime.combat.participants.filter((id) => {
        const actor = currentSave.actorsById[id];
        return actor && actor.resources.isDead !== true;
      });

      // Check if combat should end based on factions
      const partyIds = new Set(currentSave.party.actors);
      const enemyIds = aliveParticipants.filter((id) => !partyIds.has(id));

      const partyAlive = aliveParticipants.filter((id) => {
        const actor = currentSave.actorsById[id];
        return partyIds.has(id) && actor && actor.resources.isDead !== true;
      });

      const enemiesAlive = aliveParticipants.filter((id) => {
        const actor = currentSave.actorsById[id];
        return enemyIds.includes(id) && actor && actor.resources.isDead !== true;
      });

      if (enemiesAlive.length === 0 && partyAlive.length > 0) {
        // All enemies dead - party victory
        const combatState = currentSave.runtime.combat;
        const endedSceneId = combatState?.startedBySceneId || currentSave.runtime.currentSceneId;
        currentSave = appendCombatLog(currentSave, "Tutti i nemici presenti nell'area sono stati sconfitti.");

        const last = currentSave.runtime.lastCheck;
        const endCheck: CheckResult = last
          ? {
              ...last,
              tags: [...last.tags, "combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
            }
          : {
              checkId: "combat:end",
              actorId: currentSave.party.activeActorId,
              roll: 0,
              target: 0,
              success: true,
              dos: 0,
              dof: 0,
              critical: "none",
              tags: ["combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
            };

        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            combat: undefined,
            lastCheck: endCheck,
            combatEndedSceneId: endedSceneId,
          },
        };
      } else if (partyAlive.length === 0) {
        // All party dead - defeat
        const combatState = currentSave.runtime.combat;
        const endedSceneId = combatState?.startedBySceneId || currentSave.runtime.currentSceneId;
        currentSave = appendCombatLog(currentSave, "Il party è stato annientato. Game over.");

        const last = currentSave.runtime.lastCheck;
        const endCheck: CheckResult = last
          ? {
              ...last,
              tags: [
                ...last.tags,
                "combat:state=end",
                "combat:outcome=defeat",
                ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
              ],
            }
          : {
              checkId: "combat:end",
              actorId: currentSave.party.activeActorId,
              roll: 0,
              target: 0,
              success: true,
              dos: 0,
              dof: 0,
              critical: "none",
              tags: [
                "combat:state=end",
                "combat:outcome=defeat",
                ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
              ],
            };

        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            combat: undefined,
            lastCheck: endCheck,
            combatEndedSceneId: endedSceneId,
          },
        };
      }
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

