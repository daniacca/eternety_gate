import type {
  StoryPack,
  GameSave,
  Party,
  Actor,
  Choice,
  ChoiceId,
  ActorId,
  Item,
  ItemId,
  CheckResult,
  Effect,
} from "./types";
import { evaluateConditions } from "./conditions";
import { applyEffects } from "./effects";
import { RNG } from "./rng";
import { appendCombatLog } from "./combat/narration";
import { startCombat, advanceCombatTurn, getCurrentTurnActorId } from "./combat/combat";
import { runNpcTurn } from "./combat/npcAi";
import { distanceChebyshev, clampToGrid } from "./combat/movement";
import type { ContentPack } from "../content/types";
import { mergeWeapons, mergeArmors } from "../content/merge";
import { handleChoice } from "./choices/handlers";
import { getCurrentScene } from "./selectors";

// Re-export combat functions for backward compatibility
export {
  appendCombatLog,
  startCombat,
  advanceCombatTurn,
  getCurrentTurnActorId,
  runNpcTurn,
  distanceChebyshev,
  clampToGrid,
  getCurrentScene,
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

  // Route to appropriate handler based on choice kind
  return handleChoice(choice, choiceId, storyPack, save, rng);
}
