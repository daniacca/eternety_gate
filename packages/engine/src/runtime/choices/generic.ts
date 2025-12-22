import type { Choice, StoryPack, GameSave, Check, CombatAttackCheck } from "../types";
import type { IRNG } from "../rng";
import type { ChoiceHandler } from "./types";
import { applyEffects } from "../effects";
import { performCheck } from "../checks";
import { getCurrentScene } from "../selectors";
import { distanceChebyshev } from "../combat/movement";
import { validateAndApplyRangedModifiers } from "../combat/validation";
import { resolveActor } from "../checks";
import { calculateWeaponDamage, getActorArmor } from "../combat/equipment";
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
function applyCombatDamageIfHit(check: Check, result: any, save: GameSave, rng: IRNG): GameSave {
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
 * Handles generic narrative choices that just apply effects / goto / flags, etc.
 * No choice checks involved, but scene checks are still executed.
 */
export const handleGenericChoice: ChoiceHandler = (
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
      // Combat attack gating (same as in original code)
      if (check.kind === "combatAttack" && currentSave.runtime.combat?.active) {
        const combat = currentSave.runtime.combat;
        const turnActorId = getCurrentTurnActorId(currentSave);

        // Check if it's player's turn
        if (!turnActorId || turnActorId !== currentSave.party.activeActorId) {
          const blockedCheck = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none" as const,
            tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          continue;
        }

        // Check if action is available
        if (combat.turn && !combat.turn.actionAvailable) {
          const blockedCheck = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none" as const,
            tags: ["combat:blocked=actionSpent"],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          continue;
        }

        // Check distance and range rules
        const combatCheck = check as CombatAttackCheck;
        const attackerId = resolveActor(combatCheck.attacker.actorRef, currentSave)?.id;
        const defenderId = resolveActor(combatCheck.defender.actorRef, currentSave)?.id;

        if (!attackerId || !defenderId) {
          const blockedCheck = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none" as const,
            tags: ["combat:blocked=noPosition"],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          continue;
        }

        // Backward compatibility: if positions not initialized, skip gating
        if (!combat.positions) {
          // Old combat state without positions - allow attack (fall through)
        } else {
          const attPos = combat.positions[attackerId];
          const defPos = combat.positions[defenderId];

          if (!attPos || !defPos) {
            const blockedCheck = {
              checkId: check.id,
              actorId: currentSave.party.activeActorId,
              roll: 0,
              target: 0,
              success: false,
              dos: 0,
              dof: 0,
              critical: "none" as const,
              tags: ["combat:blocked=noPosition"],
            };
            currentSave = {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                lastCheck: blockedCheck,
              },
            };
            continue;
          }

          const dist = distanceChebyshev(attPos, defPos);

          // Range rules
          if (combatCheck.attacker.mode === "MELEE") {
            if (dist > 1) {
              const blockedCheck = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none" as const,
                tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
              };
              currentSave = {
                ...currentSave,
                runtime: {
                  ...currentSave.runtime,
                  lastCheck: blockedCheck,
                },
              };
              continue;
            }
          } else if (combatCheck.attacker.mode === "RANGED") {
            const blockedCheck = validateAndApplyRangedModifiers(
              combatCheck,
              currentSave,
              dist,
              check.id,
              currentSave.party.activeActorId
            );
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
