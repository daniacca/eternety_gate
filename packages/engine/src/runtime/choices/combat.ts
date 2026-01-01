import type { Choice, StoryPack, GameSave, Check, CombatAttackCheck, Effect } from "../types";
import type { IRNG } from "../rng";
import type { ChoiceHandler } from "./types";
import { performCheck, resolveActor } from "../checks";
import { applyEffects } from "../effects";
import { getCurrentScene } from "../selectors";
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
 * Transforms a CombatAttackCheck into a combatRequestAttack effect
 */
function transformCombatAttackToRequestEffect(check: CombatAttackCheck, save: GameSave): Effect | null {
  const attacker = resolveActor(check.attacker.actorRef, save);
  const defender = resolveActor(check.defender.actorRef, save);

  if (!attacker || !defender) {
    return null;
  }

  const weaponId = check.attacker.weaponId ?? attacker.equipment?.weaponId ?? null;

  return {
    op: "combatRequestAttack",
    attackerId: attacker.id,
    defenderId: defender.id,
    mode: check.attacker.mode,
    weaponId: weaponId === "unarmed" ? null : weaponId,
    modifiers: check.modifiers,
    defense: check.defense,
    onSuccessEffects: check.onSuccess ?? [],
    onFailureEffects: check.onFailure ?? [],
  };
}

// Removed validateCombatAttackGating - validation is now done in combatRequestAttack

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
    const requestEffects: Effect[] = [];
    for (const check of scene.checks) {
      if (check.kind === "combatAttack") {
        // Transform combatAttack check into request effect
        const requestEffect = transformCombatAttackToRequestEffect(check as CombatAttackCheck, currentSave);
        if (requestEffect) {
          requestEffects.push(requestEffect);
          didPlayerCombatAction = true;
        }
      } else {
        // Standard checks - perform normally
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

          // Standard check effects
          if (result.success && check.onSuccess) {
            currentSave = applyEffects(check.onSuccess, storyPack, currentSave, rng);
          } else if (!result.success && check.onFailure) {
            currentSave = applyEffects(check.onFailure, storyPack, currentSave, rng);
          }
        }
      }
    }

    // Apply request effects (they will be processed via queue)
    if (requestEffects.length > 0) {
      currentSave = applyEffects(requestEffects, storyPack, currentSave, rng);
    }
  }

  // Execute choice checks if any
  // Stop on first failure (after applying onFailure effects)
  if (choice.checks) {
    const requestEffects: Effect[] = [];
    for (const check of choice.checks) {
      if (check.kind === "combatAttack") {
        // Transform combatAttack check into request effect
        const requestEffect = transformCombatAttackToRequestEffect(check as CombatAttackCheck, currentSave);
        if (requestEffect) {
          requestEffects.push(requestEffect);
          didPlayerCombatAction = true;

          // Set combatTurnStartIndex at the start of player "turn chunk"
          if (currentSave.runtime.combat?.active) {
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
        }
      } else {
        // Standard checks - perform normally
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

    // Apply request effects (they will be processed via queue)
    if (requestEffects.length > 0) {
      currentSave = applyEffects(requestEffects, storyPack, currentSave, rng);
      // Store last check result for player UI (from combatRequestAttack)
      if (currentSave.runtime.lastCheck) {
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastPlayerCheck: currentSave.runtime.lastCheck,
          },
        };
      }
    }
  }

  // Track visited scenes before applying effects (to check if we're entering a new scene)
  const visitedScenesBefore = [...currentSave.runtime.history.visitedScenes];

  // Apply choice effects (may include goto)
  currentSave = applyEffects(choice.effects || [], storyPack, currentSave, rng);

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
