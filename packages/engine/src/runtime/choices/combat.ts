import type { Choice, StoryPack, GameSave, Check, CheckResult, CombatAttackCheck } from "../types";
import type { IRNG } from "../rng";
import type { ChoiceHandler } from "./types";
import { performCheck, resolveActor } from "../checks";
import { applyEffects } from "../effects";
import { getCurrentScene } from "../selectors";
import { distanceChebyshev } from "../combat/movement";
import { validateAndApplyRangedModifiers } from "../combat/validation";
import { calculateWeaponDamage, getActorArmor } from "../combat/equipment";
import { appendCombatLog } from "../combat/narration";
import { advanceCombatTurn, getCurrentTurnActorId } from "../combat/combat";
import { runNpcTurn } from "../combat/npcAi";

/**
 * Updates magic state based on check result
 */
function updateMagicState(
  check: Check,
  result: NonNullable<ReturnType<typeof performCheck>>,
  save: GameSave
): GameSave {
  if (check.kind === "magicChannel" && result.success) {
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    return {
      ...save,
      runtime: {
        ...save.runtime,
        magic: {
          accumulatedDoS: currentMagic.accumulatedDoS + result.dos,
        },
      },
    };
  }

  if (check.kind === "magicEffect" && result.success) {
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    const requiredDoS = (check as any).castingNumberDoS;

    // Magic effect requires accumulated DoS >= CN and roll DoS >= CN
    if (result.dos >= requiredDoS && currentMagic.accumulatedDoS >= requiredDoS) {
      return {
        ...save,
        runtime: {
          ...save.runtime,
          magic: {
            accumulatedDoS: Math.max(0, currentMagic.accumulatedDoS - requiredDoS),
          },
        },
      };
    }
  }

  return save;
}

/**
 * Applies combat damage when a combatAttack check hits
 */
function applyCombatDamageIfHit(check: Check, result: CheckResult, save: GameSave, rng: IRNG): GameSave {
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
  const updatedDefender: typeof defender = {
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
 * Validates combat attack gating (turn, action availability, distance, range)
 * Returns a blocked CheckResult if validation fails, null if valid
 */
function validateCombatAttackGating(check: CombatAttackCheck, save: GameSave, checkId: string): CheckResult | null {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return null; // Not in combat, no gating needed
  }

  const turnActorId = getCurrentTurnActorId(save);

  // Check if it's player's turn
  if (!turnActorId || turnActorId !== save.party.activeActorId) {
    return {
      checkId,
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
  }

  // Check if action is available
  if (combat.turn && !combat.turn.actionAvailable) {
    return {
      checkId,
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=actionSpent"],
    };
  }

  // Check distance and range rules
  const attackerId = resolveActor(check.attacker.actorRef, save)?.id;
  const defenderId = resolveActor(check.defender.actorRef, save)?.id;

  if (!attackerId || !defenderId) {
    return {
      checkId,
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=noPosition"],
    };
  }

  // Backward compatibility: if positions not initialized, skip gating
  if (!combat.positions) {
    // Old combat state without positions - allow attack (fall through)
    return null;
  }

  const attPos = combat.positions[attackerId];
  const defPos = combat.positions[defenderId];

  if (!attPos || !defPos) {
    return {
      checkId,
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=noPosition"],
    };
  }

  const dist = distanceChebyshev(attPos, defPos);

  // Range rules
  if (check.attacker.mode === "MELEE") {
    if (dist > 1) {
      return {
        checkId,
        actorId: save.party.activeActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
      };
    }
  } else if (check.attacker.mode === "RANGED") {
    const blockedCheck = validateAndApplyRangedModifiers(check, save, dist, checkId, save.party.activeActorId);
    if (blockedCheck) {
      return blockedCheck;
    }
  }

  return null; // Valid
}

/**
 * Handles choices with combatAttack checks and any combat-specific gating
 */
export const handleCombatChoice: ChoiceHandler = (
  choice: Choice,
  choiceId: string,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): GameSave => {
  const { scene } = getCurrentScene(storyPack, save);
  let currentSave = { ...save };
  let didPlayerCombatAction = false;

  // Execute scene checks if any
  if (scene.checks) {
    for (const check of scene.checks) {
      // Combat attack gating
      if (check.kind === "combatAttack" && currentSave.runtime.combat?.active) {
        const blockedCheck = validateCombatAttackGating(check as CombatAttackCheck, currentSave, check.id);
        if (blockedCheck) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          continue;
        }
      }

      const result = performCheck(check, storyPack, currentSave, rng);
      if (result) {
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastCheck: result,
            rngCounter: rng.getCounter(),
          },
        };

        // Update magic state if needed
        currentSave = updateMagicState(check, result, currentSave);

        // Handle combat attack effects (onHit/onMiss) or standard effects (onSuccess/onFailure)
        if (check.kind === "combatAttack") {
          didPlayerCombatAction = true;
          const combatCheck = check as CombatAttackCheck;

          // Consume action
          if (currentSave.runtime.combat?.active) {
            currentSave = {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                combat: {
                  ...currentSave.runtime.combat,
                  turn: {
                    ...currentSave.runtime.combat.turn,
                    actionAvailable: false,
                  },
                },
              },
            };
          }

          // Apply damage if HIT
          currentSave = applyCombatDamageIfHit(check, result, currentSave, rng);
          if (result.success && combatCheck.onSuccess) {
            currentSave = applyEffects(combatCheck.onSuccess, storyPack, currentSave, rng);
          } else if (!result.success && combatCheck.onFailure) {
            currentSave = applyEffects(combatCheck.onFailure, storyPack, currentSave, rng);
          }
        } else {
          // Standard check effects
          if (result.success && check.onSuccess) {
            currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
          } else if (!result.success && check.onFailure) {
            currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
          }
        }
      }
    }
  }

  // Execute choice checks if any
  // Stop on first failure (after applying onFailure effects)
  if (choice.checks) {
    for (const check of choice.checks) {
      // Combat attack gating (same as scene checks)
      if (check.kind === "combatAttack" && currentSave.runtime.combat?.active) {
        const blockedCheck = validateCombatAttackGating(check as CombatAttackCheck, currentSave, check.id);
        if (blockedCheck) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          break; // Stop processing checks
        }
      }

      // Set combatTurnStartIndex at the start of player "turn chunk" (before performCheck for combatAttack)
      if (check.kind === "combatAttack" && currentSave.runtime.combat?.active) {
        const turnActorId = getCurrentTurnActorId(currentSave);
        if (turnActorId === currentSave.party.activeActorId) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              combatTurnStartIndex: currentSave.runtime.combatLog?.length ?? 0,
            },
          };
        }
      }

      const result = performCheck(check, storyPack, currentSave, rng);
      if (!result) {
        // If check returns null, skip it
        continue;
      }

      // Store check result
      currentSave = {
        ...currentSave,
        runtime: {
          ...currentSave.runtime,
          lastCheck: result,
          rngCounter: rng.getCounter(),
        },
      };

      // Update magic state if needed
      currentSave = updateMagicState(check, result, currentSave);

      // Handle combat attack effects (onHit/onMiss) or standard effects (onSuccess/onFailure)
      if (check.kind === "combatAttack") {
        didPlayerCombatAction = true;
        const combatCheck = check as CombatAttackCheck;

        // Store player's combat check result separately for debug UI
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastPlayerCheck: result,
          },
        };

        // Consume action
        if (currentSave.runtime.combat?.active) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              combat: {
                ...currentSave.runtime.combat,
                turn: {
                  ...currentSave.runtime.combat.turn,
                  actionAvailable: false,
                },
              },
            },
          };
        }

        // Apply damage if HIT
        currentSave = applyCombatDamageIfHit(check, result, currentSave, rng);

        // Get defender for narration
        const defender = resolveActor(combatCheck.defender.actorRef, currentSave);
        const defenderName = defender?.name || "il bersaglio";

        // Add narration for player attacks
        if (result.success) {
          const rawDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:raw="));
          const soakTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:soak="));
          const finalDamageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage:final="));
          const weaponTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:weapon="));

          const rawDamage = rawDamageTag ? parseInt(rawDamageTag.split("=")[1]) : 0;
          const soak = soakTag ? parseInt(soakTag.split("=")[1]) : 0;
          const finalDamage = finalDamageTag ? parseInt(finalDamageTag.split("=")[1]) : 0;
          const weaponId = weaponTag ? weaponTag.split("=")[1] : "unarmed";
          const weaponName = weaponId === "unarmed" ? "i pugni" : currentSave.weaponsById?.[weaponId]?.name || "l'arma";

          if (finalDamage === 0) {
            currentSave = appendCombatLog(
              currentSave,
              `Colpisci ${defenderName} con ${weaponName} ma l'armatura assorbe tutto il colpo (${rawDamage} - ${soak}).`
            );
          } else {
            currentSave = appendCombatLog(
              currentSave,
              `Colpisci ${defenderName} con ${weaponName} e infliggi ${finalDamage} danni (${rawDamage} - ${soak}).`
            );
          }

          // Check for defense
          const defenseTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:defense="));
          if (defenseTag) {
            const defenseType = defenseTag.split("=")[1];
            if (defenseType === "parry") {
              currentSave = appendCombatLog(currentSave, `${defenderName} para il colpo.`);
            } else if (defenseType === "dodge") {
              currentSave = appendCombatLog(currentSave, `${defenderName} schiva il colpo.`);
            }
          }
        } else {
          currentSave = appendCombatLog(currentSave, `Il tuo attacco manca il bersaglio.`);
        }

        if (result.success && combatCheck.onSuccess) {
          currentSave = applyEffects(combatCheck.onSuccess, storyPack, currentSave, rng);
        } else if (!result.success && combatCheck.onFailure) {
          currentSave = applyEffects(combatCheck.onFailure, storyPack, currentSave, rng);
        }
        // For combatAttack, treat HIT as success, MISS as failure for flow control
        if (!result.success) {
          // Stop processing further checks on MISS
          break;
        }
      } else {
        // Standard check effects
        if (result.success && check.onSuccess) {
          currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
        } else if (!result.success) {
          // On failure, apply onFailure effects and stop further checks
          if (check.onFailure) {
            currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
          }
          // Stop processing further checks on failure
          break;
        }
      }
    }
  }

  // Track visited scenes before applying effects (to check if we're entering a new scene)
  const visitedScenesBefore = [...currentSave.runtime.history.visitedScenes];

  // Apply choice effects (may include goto)
  currentSave = applyEffects(choice.effects, storyPack, currentSave, rng);

  // Apply scene onEnter effects for the new scene if this is first visit
  const newSceneId = currentSave.runtime.currentSceneId;
  if (!visitedScenesBefore.includes(newSceneId)) {
    const newScene = storyPack.scenes.find((s) => s.id === newSceneId);
    if (newScene && newScene.onEnter) {
      currentSave = applyEffects(newScene.onEnter, storyPack, currentSave, rng);
    }
  }

  // Update history
  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      rngCounter: rng.getCounter(),
      history: {
        ...currentSave.runtime.history,
        chosenChoices: [...currentSave.runtime.history.chosenChoices, choiceId],
      },
    },
    updatedAt: new Date().toISOString(),
  };

  // Combat: advance turn after player combat action and run NPC turns if needed
  // Only advance turn if player performed a combat action
  if (!didPlayerCombatAction) {
    return currentSave;
  }

  if (currentSave.runtime.combat?.active) {
    // Advance turn (player just acted)
    currentSave = advanceCombatTurn(currentSave);

    // Loop: run NPC turns until it's player's turn again
    let safety = 0;
    while (
      currentSave.runtime.combat?.active &&
      getCurrentTurnActorId(currentSave) !== currentSave.party.activeActorId
    ) {
      const npcId = getCurrentTurnActorId(currentSave);
      if (!npcId) break;

      currentSave = runNpcTurn(storyPack, currentSave, npcId);
      currentSave = advanceCombatTurn(currentSave);

      safety++;
      if (safety > 10) break; // safety guard
    }
  }

  return currentSave;
};
