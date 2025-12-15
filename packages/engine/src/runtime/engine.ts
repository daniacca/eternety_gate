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
} from "./types";
import { evaluateConditions } from "./conditions";
import { applyEffects } from "./effects";
import { performCheck, resolveActor } from "./checks";
import { RNG } from "./rng";

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
 * Applies combat damage when a combatAttack check hits
 */
function applyCombatDamageIfHit(check: Check, result: CheckResult, save: GameSave): GameSave {
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
 * Starts combat with given participants
 */
export function startCombat(
  storyPack: StoryPack,
  save: GameSave,
  participantIds: ActorId[],
  startedBySceneId?: SceneId
): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  // Filter participants: must exist and be alive (hp > 0)
  const validParticipants = participantIds.filter((id) => {
    const actor = save.actorsById[id];
    return actor && actor.resources.hp > 0;
  });

  if (validParticipants.length === 0) {
    return save;
  }

  // Calculate initiative for each participant
  type InitiativeEntry = {
    id: ActorId;
    iniBase: number;
    iniRoll: number;
    iniScore: number;
  };

  const initiatives: InitiativeEntry[] = validParticipants.map((id) => {
    const actor = save.actorsById[id];
    const iniBase = actor.stats.INI ?? 0;
    const iniRoll = rng.nextInt(1, 10); // d10
    const iniScore = iniBase + iniRoll;

    return {
      id,
      iniBase,
      iniRoll,
      iniScore,
    };
  });

  // Sort by iniScore desc, then iniBase desc, then actorId asc (deterministic)
  initiatives.sort((a, b) => {
    if (b.iniScore !== a.iniScore) {
      return b.iniScore - a.iniScore;
    }
    if (b.iniBase !== a.iniBase) {
      return b.iniBase - a.iniBase;
    }
    return a.id.localeCompare(b.id);
  });

  const orderedIds = initiatives.map((entry) => entry.id);
  const currentTurnActorId = orderedIds[0];

  const combatState: CombatState = {
    active: true,
    participants: orderedIds,
    currentIndex: 0,
    round: 1,
    startedBySceneId,
  };

  // Create debug lastCheck
  const debugCheck: CheckResult = {
    checkId: "combat:start",
    actorId: currentTurnActorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none",
    tags: [
      "combat:state=start",
      `combat:order=${orderedIds.join(",")}`,
      "combat:round=1",
      `combat:turn=${currentTurnActorId}`,
    ],
  };

  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatState,
      rngCounter: rng.getCounter(),
      lastCheck: debugCheck,
    },
  };
}

/**
 * Gets the current turn actor ID, or null if combat is not active
 */
export function getCurrentTurnActorId(save: GameSave): ActorId | null {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return null;
  }

  if (combat.participants.length === 0) {
    return null;
  }

  return combat.participants[combat.currentIndex] || null;
}

/**
 * Advances combat turn, removes KO participants, and ends combat if needed
 */
export function advanceCombatTurn(save: GameSave): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return save;
  }

  // Remove KO participants (hp <= 0)
  const aliveParticipants = combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return actor && actor.resources.hp > 0;
  });

  // End combat if only one side remains (or none)
  if (aliveParticipants.length <= 1) {
    const endCheck: CheckResult | null = save.runtime.lastCheck
      ? {
          ...save.runtime.lastCheck,
          tags: [...save.runtime.lastCheck.tags, "combat:state=end"],
        }
      : {
          checkId: "combat:end",
          actorId: save.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none",
          tags: ["combat:state=end"],
        };

    return {
      ...save,
      runtime: {
        ...save.runtime,
        combat: undefined,
        lastCheck: endCheck,
      },
    };
  }

  // Advance turn
  let newCurrentIndex = (combat.currentIndex + 1) % aliveParticipants.length;
  let newRound = combat.round;

  // If we wrapped around, increment round
  if (newCurrentIndex === 0) {
    newRound = combat.round + 1;
  }

  const newCombatState: CombatState = {
    ...combat,
    participants: aliveParticipants,
    currentIndex: newCurrentIndex,
    round: newRound,
  };

  const currentTurnActorId = aliveParticipants[newCurrentIndex];

  // Update lastCheck tags
  const updatedLastCheck: CheckResult | null = save.runtime.lastCheck
    ? {
        ...save.runtime.lastCheck,
        tags: [...save.runtime.lastCheck.tags, `combat:round=${newRound}`, `combat:turn=${currentTurnActorId}`],
      }
    : null;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: newCombatState,
      lastCheck: updatedLastCheck,
    },
  };
}

/**
 * Runs an NPC turn (auto-attack)
 */
export function runNpcTurn(storyPack: StoryPack, save: GameSave, npcId: ActorId): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  // Target is always the active party member
  const targetId = save.party.activeActorId;

  // Build minimal CombatAttackCheck
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

  // Perform check
  const result = performCheck(check, storyPack, save, rng);

  if (!result) {
    return {
      ...save,
      runtime: {
        ...save.runtime,
        rngCounter: rng.getCounter(),
      },
    };
  }

  // Update RNG counter
  let currentSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      rngCounter: rng.getCounter(),
      lastCheck: {
        ...result,
        tags: [...result.tags, "combat:npcTurn=1", `combat:npcId=${npcId}`],
      },
    },
  };

  // Apply damage if hit
  currentSave = applyCombatDamageIfHit(check, result, currentSave);

  return currentSave;
}

/**
 * Creates a new game save from a story pack
 */
export function createNewGame(
  storyPack: StoryPack,
  saveSeed: number,
  party: Party,
  actorsById: Record<ActorId, Actor>,
  itemCatalogById: Record<ItemId, Item>
): GameSave {
  const castActorsById = bootstrapActorsFromCast(storyPack);

  const mergedActorsById: Record<ActorId, Actor> = {
    ...castActorsById,
    ...actorsById, // the party always wins if there is a collision
  };

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
          // Apply damage if HIT
          currentSave = applyCombatDamageIfHit(check, result, currentSave);
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
        // Apply damage if HIT
        currentSave = applyCombatDamageIfHit(check, result, currentSave);
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
