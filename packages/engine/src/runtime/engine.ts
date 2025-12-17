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
} from "./types";
import { evaluateConditions } from "./conditions";
import { applyEffects } from "./effects";
import { performCheck, resolveActor } from "./checks";
import { RNG } from "./rng";

/**
 * Helper to append a combat log entry (historical)
 */
function appendCombatLog(save: GameSave, entry: string): GameSave {
  const currentLog = save.runtime.combatLog || [];
  const newLog = [...currentLog, entry];
  // Keep only last 50 entries to avoid memory issues
  const trimmedLog = newLog.slice(-50);
  return {
    ...save,
    runtime: {
      ...save.runtime,
      combatLog: trimmedLog,
    },
  };
}

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
 * Distance helpers
 */
function distanceChebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function clampToGrid(pos: Position, grid: Grid): Position {
  return {
    x: Math.max(0, Math.min(grid.width - 1, pos.x)),
    y: Math.max(0, Math.min(grid.height - 1, pos.y)),
  };
}

/**
 * Starts combat with given participants, grid, and placements
 */
export function startCombat(
  storyPack: StoryPack,
  save: GameSave,
  participantIds: ActorId[],
  startedBySceneId?: SceneId,
  grid?: Grid,
  placements?: Array<{ actorId: ActorId; x: number; y: number }>
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

  // Initialize grid (default 10x10 if not provided)
  const combatGrid: Grid = grid || { width: 10, height: 10 };

  // Initialize positions from placements
  const positions: Record<ActorId, Position> = {};
  if (placements) {
    for (const placement of placements) {
      if (orderedIds.includes(placement.actorId)) {
        positions[placement.actorId] = clampToGrid({ x: placement.x, y: placement.y }, combatGrid);
      }
    }
  }

  // Set default positions for missing actors (0,0)
  for (const id of orderedIds) {
    if (!positions[id]) {
      positions[id] = { x: 0, y: 0 };
    }
  }

  // Determine the scene ID that started combat (use provided startedBySceneId or current scene)
  const sceneIdForCombat = startedBySceneId || save.runtime.currentSceneId;

  const combatState: CombatState = {
    active: true,
    participants: orderedIds,
    currentIndex: 0,
    round: 1,
    startedBySceneId: sceneIdForCombat,
    grid: combatGrid,
    positions,
    turn: {
      hasMoved: false,
      hasAttacked: false,
    },
  };

  // Create debug lastCheck with position tags
  const positionTags: string[] = [];
  for (const id of orderedIds) {
    const pos = positions[id];
    positionTags.push(`combat:pos:${id}=${pos.x},${pos.y}`);
  }

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
      ...positionTags,
    ],
  };

  // Reset combat log and initialize with start message
  const initialCombatLog = ["Il combattimento è iniziato."];

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatState,
      rngCounter: rng.getCounter(),
      lastCheck: debugCheck,
      combatLog: initialCombatLog,
      combatLogSceneId: sceneIdForCombat,
      // Set combatTurnStartIndex to point to the start message (index 0)
      combatTurnStartIndex: 0,
    },
  };

  // If player goes first, combatTurnStartIndex is already set correctly (0)
  // Otherwise, it will be updated when player's turn starts in advanceCombatTurn

  return updatedSave;
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
  if (!combat?.active) return save;

  const aliveParticipants = combat.participants.filter((id) => {
    const actor = save.actorsById[id];
    return actor && actor.resources.hp > 0;
  });

  const last = save.runtime.lastCheck && save.runtime.lastCheck !== null ? save.runtime.lastCheck : null;

  if (aliveParticipants.length <= 1) {
    const winnerId = aliveParticipants.length === 1 ? aliveParticipants[0] : null;

    const endCheck: CheckResult = last
      ? {
          ...last,
          tags: [...last.tags, "combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        }
      : {
          checkId: "combat:end",
          actorId: save.party.activeActorId,
          roll: 0,
          target: 0,
          success: true,
          dos: 0,
          dof: 0,
          critical: "none", // o null, coerente col tuo tipo
          tags: ["combat:state=end", ...(winnerId ? [`combat:winner=${winnerId}`] : [])],
        };

    const winner = winnerId ? save.actorsById[winnerId] : null;
    const logEntry = `Il combattimento termina. Vincitore: ${winner?.name || "Nessuno"}.`;

    let updatedSave = {
      ...save,
      runtime: {
        ...save.runtime,
        combat: undefined,
        lastCheck: endCheck,
        combatEndedSceneId: save.runtime.currentSceneId,
      },
    };

    return appendCombatLog(updatedSave, logEntry);
  }

  const prevActorId = combat.participants[combat.currentIndex];
  const prevAliveIndex = aliveParticipants.indexOf(prevActorId);
  const pivotIndex = prevAliveIndex >= 0 ? prevAliveIndex : Math.min(combat.currentIndex, aliveParticipants.length - 1);

  let newCurrentIndex = (pivotIndex + 1) % aliveParticipants.length;
  let newRound = combat.round;
  if (newCurrentIndex === 0) newRound = combat.round + 1;

  const currentTurnActorId = aliveParticipants[newCurrentIndex];

  const newCombatState: CombatState = {
    ...combat,
    participants: aliveParticipants,
    currentIndex: newCurrentIndex,
    round: newRound,
    turn: { hasMoved: false, hasAttacked: false },
  };

  const updatedLastCheck: CheckResult | null = last
    ? {
        ...last,
        tags: [
          ...last.tags.filter((tag) => !tag.startsWith("combat:round=") && !tag.startsWith("combat:turn=")),
          `combat:round=${newRound}`,
          `combat:turn=${currentTurnActorId}`,
        ],
      }
    : null;

  let updatedSave: GameSave = {
    ...save,
    runtime: { ...save.runtime, combat: newCombatState, lastCheck: updatedLastCheck },
  };

  // Set combatTurnStartIndex when it becomes player's turn
  if (currentTurnActorId === save.party.activeActorId) {
    updatedSave = {
      ...updatedSave,
      runtime: {
        ...updatedSave.runtime,
        combatTurnStartIndex: updatedSave.runtime.combatLog?.length || 0,
      },
    };
  }

  return updatedSave;
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
            hasAttacked: true,
          }
        : {
            hasMoved: false,
            hasAttacked: true,
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

    // Mark as attacked
    const combatWithAttacked = {
      ...combat,
      turn: {
        ...combat.turn,
        hasAttacked: true,
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

    // Mark as attacked
    const combatWithAttacked = {
      ...combat,
      turn: {
        ...combat.turn,
        hasAttacked: true,
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

    const updatedCombat = {
      ...combat,
      positions: updatedPositions,
      turn: {
        ...combat.turn,
        hasMoved: true,
        // Do NOT set hasAttacked=true for move-only turns
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

        // Check if already attacked (backward compatibility: if turn is undefined, allow)
        if (combat.turn && combat.turn.hasAttacked) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
            tags: ["combat:blocked=alreadyAttacked"],
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
            if (dist <= 1) {
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:blocked=rangedInMelee", `combat:dist=${dist}`],
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

            // Range bands: dist <= 4 => SHORT, dist <= 8 => LONG, else out of range
            if (dist > 8) {
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
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

            // Auto-set rangeBand if not specified
            if (!combatCheck.modifiers?.rangeBand) {
              const rangeBand = dist <= 4 ? "SHORT" : "LONG";
              combatCheck.modifiers = {
                ...combatCheck.modifiers,
                rangeBand: rangeBand as any,
              };
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

          // Mark as attacked
          if (currentSave.runtime.combat?.active) {
            currentSave = {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                combat: {
                  ...currentSave.runtime.combat,
                  turn: {
                    ...currentSave.runtime.combat.turn,
                    hasAttacked: true,
                  },
                },
              },
            };
          }

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

        // Check if already attacked (backward compatibility: if turn is undefined, allow)
        if (combat.turn && combat.turn.hasAttacked) {
          const blockedCheck: CheckResult = {
            checkId: check.id,
            actorId: currentSave.party.activeActorId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none",
            tags: ["combat:blocked=alreadyAttacked"],
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
            if (dist <= 1) {
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:blocked=rangedInMelee", `combat:dist=${dist}`],
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

            // Range bands: dist <= 4 => SHORT, dist <= 8 => LONG, else out of range
            if (dist > 8) {
              const blockedCheck: CheckResult = {
                checkId: check.id,
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: false,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:blocked=outOfRange", `combat:dist=${dist}`],
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

            // Auto-set rangeBand if not specified
            if (!combatCheck.modifiers?.rangeBand) {
              const rangeBand = dist <= 4 ? "SHORT" : "LONG";
              combatCheck.modifiers = {
                ...combatCheck.modifiers,
                rangeBand: rangeBand as any,
              };
            }
          }
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

        // Mark as attacked
        if (currentSave.runtime.combat?.active) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              combat: {
                ...currentSave.runtime.combat,
                turn: {
                  ...currentSave.runtime.combat.turn,
                  hasAttacked: true,
                },
              },
            },
          };
        }

        // Apply damage if HIT
        currentSave = applyCombatDamageIfHit(check, result, currentSave);

        // Get defender for narration
        const defender = resolveActor(combatCheck.defender.actorRef, currentSave);
        const defenderName = defender?.name || "il bersaglio";

        // Add narration for player attacks
        if (result.success) {
          const damageTag = currentSave.runtime.lastCheck?.tags.find((t) => t.startsWith("combat:damage="));
          const damage = damageTag ? parseInt(damageTag.split("=")[1]) : 0;
          currentSave = appendCombatLog(currentSave, `Colpisci ${defenderName} e infliggi ${damage} danni.`);

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
