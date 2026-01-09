import type { Effect, GameSave, StoryPack, CombatAttackCheck, CheckResult } from "../../types";
import { IRNG } from "../../rng";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog, nextRuntimeSeq } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { applyCombatDamageIfHit } from "../damage";
import { distanceChebyshev } from "../movement";
import { getEquippedWeaponId } from "../../characters/inventory";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { hasUnlockedAction } from "../../characters/actions";

/**
 * Swift Attack: full round melee action that performs a melee attack check
 * If successful, applies damage once for each degree of success
 */
export function combatSwiftAttack(
  effect: Extract<Effect, { op: "combatSwiftAttack" }>,
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

  // Load catalogs and check if action is unlocked
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

  if (catalogs && !hasUnlockedAction(save, catalogs, effect.attackerId, "combat:swiftAttack")) {
    const blockedCheck = {
      checkId: "combat:swiftAttack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=actionNotUnlocked"],
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
    const blockedCheck = {
      checkId: "combat:swiftAttack:blocked",
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
      checkId: "combat:swiftAttack:blocked",
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

  // Consume action AND all movement (full round action) and reset channeling (non-magic action)
  const combatWithActionAndMovementConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
      moveRemaining: 0,
    },
    channeling: combat.channeling?.actorId === effect.attackerId ? undefined : combat.channeling,
  };

  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatWithActionAndMovementConsumed,
    },
  };

  // Get attacker weapon
  const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, currentSave);
  if (!attacker) {
    return { save: currentSave };
  }

  const weaponId = effect.weaponId ?? getEquippedWeaponId(attacker);

  // Build CombatAttackCheck for melee attack
  const check: CombatAttackCheck = {
    id: `combat:swiftAttack:${effect.attackerId}:${effect.defenderId}`,
    kind: "combatAttack",
    attacker: {
      actorRef: { mode: "byId", actorId: effect.attackerId },
      mode: "MELEE",
      weaponId: weaponId === "unarmed" ? null : weaponId,
    },
    defender: {
      actorRef: { mode: "byId", actorId: effect.defenderId },
    },
    defense: {
      allowParry: true,
      allowDodge: true,
      strategy: "autoBest",
    },
  };

  // Generate deterministic resolutionId
  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:swift:${seq}`;
  currentSave = saveWithSeq;

  // Perform check
  const { result, save: afterCheckSave } = performCheckWithSave(check, storyPack, currentSave, rng, resolutionId);
  if (!result) {
    return { save: currentSave };
  }

  // Use the updated save from performCheckWithSave
  currentSave = afterCheckSave;

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      lastCheck: result,
      rngCounter: rng.getCounter(),
    },
  };

  // Add narration for swift attack initiation
  const attackerName = attacker.name || effect.attackerId;
  const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
  const defenderName = defender?.name || effect.defenderId;
  const logEntry =
    attacker.kind === "PC"
      ? `Sferri un attacco rapido contro ${defenderName}!`
      : `${attackerName} sferra un attacco rapido contro ${defenderName}!`;
  currentSave = appendCombatLog(currentSave, logEntry);

  // If attack succeeded, apply damage DoS times
  if (result.success && result.dos > 0) {
    const hits = result.dos;

    // Apply damage for each hit
    for (let hitNumber = 1; hitNumber <= hits; hitNumber++) {
      // Create a unique resolutionId for each hit
      const hitResolutionId = `${resolutionId}:hit${hitNumber}`;

      // Apply damage (each hit is separate)
      const damageResult = applyCombatDamageIfHit(
        check,
        {
          ...result,
          checkId: `${result.checkId}:hit${hitNumber}`,
        },
        currentSave,
        rng,
        storyPack,
        hitResolutionId,
        catalogs
      );

      currentSave = damageResult.save;

      // Handle death after each hit
      if (damageResult.actorDied) {
        const deadActor = currentSave.actorsById[effect.defenderId];
        if (deadActor) {
          const pcDied = deadActor.kind === "PC";
          const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
          const allPartyDead = partyActors.length > 0 && partyActors.every((actor) => actor.resources.isDead === true);

          if (pcDied || allPartyDead) {
            currentSave = {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                gameOver: {
                  reason: pcDied ? "playerDead" : "partyDead",
                  sceneId: currentSave.runtime.currentSceneId,
                },
                combat: undefined,
              },
            };
            currentSave = appendCombatLog(currentSave, "Game Over.");
            break; // Stop applying hits if game over
          }
        }

        // Check if combat should end
        if (currentSave.runtime.combat?.active) {
          const aliveParticipants = currentSave.runtime.combat.participants.filter((id) => {
            const actor = currentSave.actorsById[id];
            return actor && actor.resources.isDead !== true;
          });

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
            break; // Stop applying hits if combat ended
          } else if (partyAlive.length === 0) {
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
            break; // Stop applying hits if game over
          }
        }
      }
    }

    // Add narration for total hits
    if (hits > 1) {
      const hitsLogEntry =
        attacker.kind === "PC"
          ? `Colpisci ${defenderName} ${hits} volte!`
          : `${attackerName} colpisce ${defenderName} ${hits} volte!`;
      currentSave = appendCombatLog(currentSave, hitsLogEntry);
    }
  } else {
    // Attack missed
    const missLogEntry =
      attacker.kind === "PC" ? `Il tuo attacco rapido fallisce.` : `L'attacco rapido di ${attackerName} fallisce.`;
    currentSave = appendCombatLog(currentSave, missLogEntry);
  }

  return { save: currentSave };
}

