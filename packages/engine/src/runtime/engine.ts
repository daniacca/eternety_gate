import type {
  StoryPack,
  GameSave,
  Party,
  Actor,
  Scene,
  Choice,
  ChoiceId,
  ActorId,
  Item,
  ItemId,
  Check,
  MagicChannelCheck,
  MagicEffectCheck,
  CombatAttackCheck,
  CheckResult,
  CombatState,
  SceneId,
  Grid,
  Position,
  Effect,
} from "./types";
import { evaluateConditions } from "./conditions";
import { applyEffects } from "./effects";
import { performCheck, resolveActor } from "./checks";
import { RNG } from "./rng";
import { appendCombatLog } from "./combat/narration";
import { startCombat, advanceCombatTurn, getCurrentTurnActorId } from "./combat/combat";
import { runNpcTurn } from "./combat/npcAi";
import { distanceChebyshev, clampToGrid } from "./combat/movement";
import { calculateWeaponDamage, getActorArmor, getActorWeapon } from "./combat/equipment";
import type { ContentPack } from "../content/types";
import { mergeWeapons, mergeArmors } from "../content/merge";
import type { IRNG } from "./rng";

// Re-export combat functions for backward compatibility
export {
  appendCombatLog,
  startCombat,
  advanceCombatTurn,
  getCurrentTurnActorId,
  runNpcTurn,
  distanceChebyshev,
  clampToGrid,
};

function makeDefaultActor(id: string, name?: string): Actor {
  return {
    id: id as ActorId,
    name: name ?? id,
    kind: "NPC",
    stats: {
      STR: 0,
      TOU: 0,
      AGI: 0,
      INT: 0,
      WIL: 0,
      CHA: 0,
      WS: 0,
      BS: 0,
      INI: 0,
      PER: 0,
    },
    resources: { hp: 1, rf: 0, peq: 0 },
    skills: {},
    talents: [],
    traits: [],
    equipment: { equipped: { weaponMainId: null, weaponOffId: null, armorId: null, accessoryIds: [] } },
    status: { conditions: [], tempModifiers: [] },
  };
}

function bootstrapActorsFromCast(storyPack: StoryPack): Record<ActorId, Actor> {
  const out: Record<ActorId, Actor> = {} as any;

  const npcs = storyPack.cast?.npcs ?? [];
  for (const npc of npcs as any[]) {
    const id = npc?.id;
    if (!id) continue;

    const actor: Actor = npc?.stats && npc?.equipment && npc?.status ? (npc as Actor) : makeDefaultActor(id, npc?.name);
    out[actor.id] = actor;
  }

  return out;
}

/**
 * Validates ranged attack and applies range band modifiers
 * Returns a blocked CheckResult if validation fails, null if valid
 * Also auto-sets rangeBand modifier if not specified
 */
function validateAndApplyRangedModifiers(
  combatCheck: CombatAttackCheck,
  save: GameSave,
  dist: number,
  checkId: string,
  actorId: ActorId
): CheckResult | null {
  // a) Check if weapon is actually ranged
  const attacker = resolveActor(combatCheck.attacker.actorRef, save);
  const weaponId = combatCheck.attacker.weaponId ?? attacker?.equipment?.weaponId ?? null;
  const { weapon } = attacker ? getActorWeapon(save, attacker) : { weapon: null };

  if (!weapon || weapon.kind !== "RANGED") {
    return {
      checkId,
      actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=notRangedWeapon", `combat:dist=${dist}`],
    };
  }

  // b) Check if in melee range (dist <= 1)
  if (dist <= 1) {
    return {
      checkId,
      actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["combat:blocked=rangedInMelee", `combat:dist=${dist}`],
    };
  }

  // c) Check if out of range (if weapon.range exists and dist > long)
  const weaponRange = weapon.range;
  if (weaponRange) {
    if (dist > weaponRange.long) {
      return {
        checkId,
        actorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
      };
    }

    // d) Auto-set rangeBand if not specified (SHORT/LONG based on weapon.range.short)
    if (!combatCheck.modifiers?.rangeBand) {
      const rangeBand = dist <= weaponRange.short ? "SHORT" : "LONG";
      combatCheck.modifiers = {
        ...combatCheck.modifiers,
        rangeBand: rangeBand as any,
      };
    }
  } else {
    // Fallback to old hardcoded range if weapon has no range
    if (dist > 8) {
      return {
        checkId,
        actorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
      };
    }

    // Auto-set rangeBand if not specified (fallback to hardcoded values)
    if (!combatCheck.modifiers?.rangeBand) {
      const rangeBand = dist <= 4 ? "SHORT" : "LONG";
      combatCheck.modifiers = {
        ...combatCheck.modifiers,
        rangeBand: rangeBand as any,
      };
    }
  }

  return null; // Valid
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
  const updatedDefender: Actor = {
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
 * Updates magic state based on check result
 */
function updateMagicState(
  check: Check,
  result: NonNullable<ReturnType<typeof performCheck>>,
  save: GameSave
): GameSave {
  if (check.kind === "magicChannel" && result.success) {
    const magicCheck = check as MagicChannelCheck;
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
    const magicCheck = check as MagicEffectCheck;
    const currentMagic = save.runtime.magic || { accumulatedDoS: 0 };
    const requiredDoS = magicCheck.castingNumberDoS;

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
 * Creates a new game save from a story pack
 */
export function createNewGame(
  storyPack: StoryPack,
  saveSeed: number,
  party: Party,
  actorsById: Record<ActorId, Actor>,
  itemCatalogById: Record<ItemId, Item>,
  contentPack: ContentPack = { id: "default", weapons: [], armors: [] }
): GameSave {
  const castActorsById = bootstrapActorsFromCast(storyPack);

  const mergedActorsById: Record<ActorId, Actor> = {
    ...castActorsById,
    ...actorsById, // the party always wins if there is a collision
  };

  // Merge global content pack with story pack content
  const weaponsById = mergeWeapons(contentPack.weapons, storyPack.weapons);
  const armorsById = mergeArmors(contentPack.armors, storyPack.armors);

  const save: GameSave = {
    saveVersion: "1.0.0",
    createdAt: new Date().toISOString(),
    story: {
      id: storyPack.id,
      version: storyPack.version,
    },
    state: {
      flags: { ...storyPack.initialState.flags },
      counters: { ...storyPack.initialState.counters },
      inventory: {
        items: [...(storyPack.initialState.inventory?.items || [])],
      },
      runVariant: storyPack.initialState.runVariant,
    },
    party,
    actorsById: mergedActorsById,
    itemCatalogById,
    weaponsById,
    armorsById,
    runtime: {
      currentSceneId: storyPack.startSceneId,
      rngSeed: saveSeed,
      rngCounter: 0,
      history: {
        visitedScenes: [storyPack.startSceneId],
        chosenChoices: [],
      },
      firedWorldEvents: [],
      magic: {
        accumulatedDoS: 0,
      },
    },
  };

  return save;
}

/**
 * Gets the current scene and resolved text blocks
 */
export function getCurrentScene(storyPack: StoryPack, save: GameSave): { scene: Scene; text: string[] } {
  const scene = storyPack.scenes.find((s) => s.id === save.runtime.currentSceneId);
  if (!scene) {
    throw new Error(`Scene not found: ${save.runtime.currentSceneId}`);
  }

  // Start with base text
  const text: string[] = [...scene.text];

  // Add conditional text blocks
  if (scene.textBlocks) {
    for (const block of scene.textBlocks) {
      if (evaluateConditions(block.conditions, save)) {
        text.push(...block.text);
      }
    }
  }

  return { scene, text };
}

/**
 * Lists available choices for the current scene, filtered by conditions
 */
export function listAvailableChoices(storyPack: StoryPack, save: GameSave): Choice[] {
  const { scene } = getCurrentScene(storyPack, save);

  return scene.choices.filter((choice) => {
    if (!choice.conditions) {
      return true;
    }
    return evaluateConditions(choice.conditions, save);
  });
}

/**
 * Applies a choice and returns the updated save
 */
export function applyChoice(storyPack: StoryPack, save: GameSave, choiceId: ChoiceId): GameSave {
  const { scene } = getCurrentScene(storyPack, save);

  // Handle special combat actions that may not be in story file
  if (choiceId === "combat_defend" || choiceId === "combat_aim") {
    const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
    const effect: Effect = choiceId === "combat_defend" ? { op: "combatDefend" } : { op: "combatAim" };
    return applyEffects([effect], storyPack, save, rng);
  }

  const choice = scene.choices.find((c) => c.id === choiceId);

  if (!choice) {
    throw new Error(`Choice not found: ${choiceId}`);
  }

  // Check conditions again
  if (choice.conditions) {
    if (!evaluateConditions(choice.conditions, save)) {
      throw new Error(`Choice conditions not met: ${choiceId}`);
    }
  }

  // Combat guard: block player actions if it's not their turn
  if (save.runtime.combat?.active) {
    const turnActorId = getCurrentTurnActorId(save);
    if (turnActorId && turnActorId !== save.party.activeActorId) {
      // Not player's turn - block action
      const blockedCheck: CheckResult = {
        checkId: `combat:blocked:${choiceId}`,
        actorId: save.party.activeActorId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none",
        tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId}`],
      };

      return {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      };
    }
  }

  // Create RNG from save state
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  let currentSave = { ...save };
  let didPlayerCombatAction = false;

  // Execute scene checks if any
  if (scene.checks) {
    for (const check of scene.checks) {
      // Combat attack gating
      if (check.kind === "combatAttack" && currentSave.runtime.combat?.active) {
        const combat = currentSave.runtime.combat;
        const turnActorId = getCurrentTurnActorId(currentSave);

        // Check if it's player's turn
        if (!turnActorId || turnActorId !== currentSave.party.activeActorId) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
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
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
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
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
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
            const blockedCheck: CheckResult = {
              checkId: check.id,
              actorId: currentSave.party.activeActorId,
              roll: 0,
              target: 0,
              success: false,
              dos: 0,
              dof: 0,
              critical: "none",
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
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
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
          if (result.success && combatCheck.onHit) {
            currentSave = applyEffects(combatCheck.onHit, storyPack, currentSave, rng);
          } else if (!result.success && combatCheck.onMiss) {
            currentSave = applyEffects(combatCheck.onMiss, storyPack, currentSave, rng);
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
        const combat = currentSave.runtime.combat;
        const turnActorId = getCurrentTurnActorId(currentSave);

        // Check if it's player's turn
        if (!turnActorId || turnActorId !== currentSave.party.activeActorId) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
            tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          break; // Stop processing checks
        }

        // Check if action is available
        if (combat.turn && !combat.turn.actionAvailable) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
            tags: ["combat:blocked=actionSpent"],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          break; // Stop processing checks
        }

        // Check distance and range rules
        const combatCheck = check as CombatAttackCheck;
        const attackerId = resolveActor(combatCheck.attacker.actorRef, currentSave)?.id;
        const defenderId = resolveActor(combatCheck.defender.actorRef, currentSave)?.id;

        if (!attackerId || !defenderId) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
            tags: ["combat:blocked=noPosition"],
          };
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          };
          break; // Stop processing checks
        }

        // Backward compatibility: if positions not initialized, skip gating
        if (!combat.positions) {
          // Old combat state without positions - allow attack (fall through)
        } else {
          const attPos = combat.positions[attackerId];
          const defPos = combat.positions[defenderId];

          if (!attPos || !defPos) {
            const blockedCheck: CheckResult = {
              checkId: check.id,
              actorId: currentSave.party.activeActorId,
              roll: 0,
              target: 0,
              success: false,
              dos: 0,
              dof: 0,
              critical: "none",
              tags: ["combat:blocked=noPosition"],
            };
            currentSave = {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                lastCheck: blockedCheck,
              },
            };
            break; // Stop processing checks
          }

          const dist = distanceChebyshev(attPos, defPos);

          // Range rules
          if (combatCheck.attacker.mode === "MELEE") {
            if (dist > 1) {
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
              };
              currentSave = {
                ...currentSave,
                runtime: {
                  ...currentSave.runtime,
                  lastCheck: blockedCheck,
                },
              };
              break; // Stop processing checks
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
              break; // Stop processing checks
            }
          }
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

        if (result.success && combatCheck.onHit) {
          currentSave = applyEffects(combatCheck.onHit, storyPack, currentSave, rng);
        } else if (!result.success && combatCheck.onMiss) {
          currentSave = applyEffects(combatCheck.onMiss, storyPack, currentSave, rng);
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
}
