import type { StoryPack, GameSave, ActorId, Effect } from "../types";
import { RNG } from "../rng";
import { distanceChebyshev } from "./movement";
import { getActorWeapon } from "./equipment";
import { isNaturalWeaponId } from "../characters/naturalWeapons";
import { hasCondition } from "../conditions";
import { isActorAlive } from "../characters/actors";
import type { ContentPack } from "../../content/types";
import { canPlaceActorAt } from "./footprint";
import { combatMove } from "./actions/move";
import { combatRequestAttack } from "./actions/requestAttack";
import { combatStandUp } from "./actions/standUp";
import { applyAddCondition, applyRemoveCondition } from "../effects/actorConditions";
import { finalizeCombatIfEnded } from "./combat";
import { getCombatEndEffects } from "./combatEndHooks";
import { applySetFlag, applyAddCounter } from "../effects/state";
import { applyAddItem, applyRemoveItem } from "../effects/items";
import { applyGoto } from "../effects/navigation";
import { applyConditionalEffects } from "../effects/conditional";
import { applyChooseRunVariant, applyVariantStartEffects } from "../effects/variants";
import { applyFireWorldEvents } from "../effects/worldEvents";
import { handleLearnSpell } from "../effects/learnSpell";
import { handleNarrativeSpell } from "../effects/narrativeSpell";
import { handleAcquireTalent, handleGrantXp, handleGrantFatePoint } from "../effects/acquireTalent";

/**
 * Runs an NPC turn (auto-attack or move)
 * Returns effects that are then applied via applyEffects
 */
export function runNpcTurn(storyPack: StoryPack, save: GameSave, npcId: ActorId, contentPack?: ContentPack): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);
  const combat = save.runtime.combat;

  if (!combat?.active) {
    return save;
  }

  // Get NPC actor
  const npc = save.actorsById[npcId];
  if (!npc) {
    return save;
  }

  // If NPC is prone, stand up and end turn
  if (hasCondition(npc, "prone")) {
    const standUpEffect: Effect = {
      op: "combatStandUp",
      actorId: npcId,
    };
    return applyNpcEffects([standUpEffect], storyPack, save, rng, contentPack);
  }

  // Target is always the active party member (must be alive)
  const targetId = save.party.activeActorId;
  const targetActor = save.actorsById[targetId];
  if (!targetActor || !isActorAlive(targetActor)) {
    // No valid target - end turn
    return save;
  }

  // Get positions
  const npcPos = combat.positions?.[npcId];
  const targetPos = combat.positions?.[targetId];

  if (!npcPos || !targetPos) {
    return save;
  }

  const dist = distanceChebyshev(npcPos, targetPos);

  // Get NPC weapon to determine attack mode and range
  const { weapon, weaponId: npcWeaponId } = getActorWeapon(save, npc);
  const npcWeaponIdForAttack = isNaturalWeaponId(npcWeaponId) ? null : npcWeaponId;
  const npcHasRanged = weapon?.kind === "RANGED";
  const weaponRange = weapon?.range;

  // Decision logic:
  // 1. If dist <= 1: MELEE attack
  // 2. Else if npcHasRanged && dist <= weapon.range: RANGED attack
  // 3. Else: MOVE toward target

  const effects: Effect[] = [];

  if (dist <= 1) {
    // MELEE attack - emit combatRequestAttack
    const attackEffect: Effect = {
      op: "combatRequestAttack",
      attackerId: npcId,
      defenderId: targetId,
      mode: "MELEE",
      weaponId: npcWeaponIdForAttack === "unarmed" ? null : npcWeaponIdForAttack,
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };
    effects.push(attackEffect);
  } else if (npcHasRanged && weaponRange && dist <= weaponRange) {
    // RANGED attack - emit combatRequestAttack
    const attackEffect: Effect = {
      op: "combatRequestAttack",
      attackerId: npcId,
      defenderId: targetId,
      mode: "RANGED",
      weaponId: npcWeaponIdForAttack === "unarmed" ? null : npcWeaponIdForAttack,
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };
    effects.push(attackEffect);
  } else {
    // MOVE toward target - move multiple squares based on movement remaining
    const moveRemaining = combat.turn.moveRemaining ?? 0;

    if (moveRemaining > 0) {
      // Move toward target, stopping at melee range (dist = 1).
      // Use simple BFS pathfinding so we route around non-walkable terrain and obstacles.
      const movesToMake = Math.min(moveRemaining, Math.max(0, dist - 1));

      type Pos = { x: number; y: number };
      const keyOf = (p: Pos) => `${p.x},${p.y}`;
      const inBounds = (p: Pos) => p.x >= 0 && p.x < combat.grid.width && p.y >= 0 && p.y < combat.grid.height;

      const DIRS: Array<{ dir: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW"; dx: number; dy: number }> = [
        { dir: "N", dx: 0, dy: -1 },
        { dir: "NE", dx: 1, dy: -1 },
        { dir: "E", dx: 1, dy: 0 },
        { dir: "SE", dx: 1, dy: 1 },
        { dir: "S", dx: 0, dy: 1 },
        { dir: "SW", dx: -1, dy: 1 },
        { dir: "W", dx: -1, dy: 0 },
        { dir: "NW", dx: -1, dy: -1 },
      ];

      const neighbors = (p: Pos): Array<{ pos: Pos; dir: (typeof DIRS)[number]["dir"] }> =>
        DIRS.map((d) => ({ dir: d.dir, pos: { x: p.x + d.dx, y: p.y + d.dy } })).filter((n) => inBounds(n.pos));

      const npcCanFly = save.actorsById[npcId]?.traits?.["trait:flyer"] !== undefined;

      // Candidate melee positions: any walkable, unoccupied cell adjacent (Chebyshev 1) to target.
      const buildGoals = (): Set<string> => {
        const goals = new Set<string>();
        for (const n of neighbors(targetPos as any)) {
          const p = n.pos;
          if (!inBounds(p)) continue;
          if (distanceChebyshev(p as any, targetPos as any) !== 1) continue;
          if (!canPlaceActorAt(save, npcId, p as any, contentPack, npcCanFly)) continue;
          goals.add(keyOf(p));
        }
        return goals;
      };

      const goals = buildGoals();
      let current: Pos = { x: npcPos.x, y: npcPos.y };

      const findNextStep = (start: Pos): { next: Pos; dir: (typeof DIRS)[number]["dir"] } | null => {
        if (goals.size === 0) return null;

        const startKey = keyOf(start);
        const q: Pos[] = [start];
        const prev = new Map<string, { from: string; viaDir: (typeof DIRS)[number]["dir"] }>();
        const seen = new Set<string>([startKey]);

        while (q.length > 0) {
          const cur = q.shift()!;
          const curKey = keyOf(cur);

          if (goals.has(curKey) && curKey !== startKey) {
            // Reconstruct: walk back until we reach the immediate neighbor of start.
            let stepKey = curKey;
            let stepDir: (typeof DIRS)[number]["dir"] | null = null;
            while (true) {
              const p = prev.get(stepKey);
              if (!p) break;
              if (p.from === startKey) {
                stepDir = p.viaDir;
                break;
              }
              stepKey = p.from;
            }
            if (!stepDir) return null;
            const [sx, sy] = stepKey.split(",").map((v) => parseInt(v, 10));
            return { next: { x: sx, y: sy }, dir: stepDir };
          }

          for (const n of neighbors(cur)) {
            const nk = keyOf(n.pos);
            if (seen.has(nk)) continue;
            // Skip cells we can't occupy (walkable=false, out-of-bounds, or occupied by living actor footprint)
            if (!canPlaceActorAt(save, npcId, n.pos as any, contentPack, npcCanFly)) continue;
            seen.add(nk);
            prev.set(nk, { from: curKey, viaDir: n.dir });
            q.push(n.pos);
          }
        }
        return null;
      };

      for (let i = 0; i < movesToMake; i++) {
        const step = findNextStep(current);
        if (!step) break;
        effects.push({ op: "combatMove", dir: step.dir });
        current = step.next;
      }
    }
  }

  // Apply effects (they will be processed via queue)
  // Note: contentPack is required for terrain/walkable checks in movement.
  return applyNpcEffects(effects, storyPack, save, rng, contentPack);
}

function applyNpcEffects(
  effects: Effect[],
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG,
  contentPack?: ContentPack
): GameSave {
  const hadCombatActive = Boolean(save.runtime.combat?.active);
  const queue: Effect[] = [...effects];
  let currentSave = save;

  while (queue.length > 0) {
    const effect = queue.shift()!;

    let result: { save: GameSave; emittedEffects?: Effect[] } = { save: currentSave };

    switch (effect.op) {
      case "combatMove":
        result = combatMove(effect as Extract<Effect, { op: "combatMove" }>, currentSave, contentPack);
        break;
      case "combatRequestAttack":
        result = combatRequestAttack(effect as Extract<Effect, { op: "combatRequestAttack" }>, storyPack, currentSave, rng);
        break;
      case "combatStandUp":
        result = combatStandUp(effect as Extract<Effect, { op: "combatStandUp" }>, currentSave, storyPack);
        break;
      case "addCondition":
        result = { save: applyAddCondition(effect as Extract<Effect, { op: "addCondition" }>, currentSave) };
        break;
      case "removeCondition":
        result = { save: applyRemoveCondition(effect as Extract<Effect, { op: "removeCondition" }>, currentSave) };
        break;
      default:
        // Unknown (for NPC turn flow): ignore.
        result = { save: currentSave };
        break;
    }

    currentSave = result.save;
    if (result.emittedEffects && result.emittedEffects.length > 0) {
      queue.push(...result.emittedEffects);
    }
  }

  const finalizedSave = finalizeCombatIfEnded(currentSave);
  const combatEnded = hadCombatActive && !finalizedSave.runtime.combat?.active;
  if (!combatEnded) {
    return finalizedSave;
  }

  const combatEndEffects = getCombatEndEffects(storyPack, finalizedSave);
  if (combatEndEffects.length === 0) {
    return finalizedSave;
  }

  return applyStoryEffectsQueue(combatEndEffects, storyPack, finalizedSave, rng);
}

function applyStoryEffectsQueue(
  effects: Effect[],
  storyPack: StoryPack,
  save: GameSave,
  rng: RNG
): GameSave {
  const queue: Effect[] = [...effects];
  let currentSave = save;

  while (queue.length > 0) {
    const effect = queue.shift()!;
    let result: { save: GameSave; emittedEffects?: Effect[] } = { save: currentSave };

    switch (effect.op) {
      case "setFlag":
        result = { save: applySetFlag(effect as Extract<Effect, { op: "setFlag" }>, currentSave) };
        break;
      case "addCounter":
        result = { save: applyAddCounter(effect as Extract<Effect, { op: "addCounter" }>, currentSave) };
        break;
      case "addItem":
        result = { save: applyAddItem(effect as Extract<Effect, { op: "addItem" }>, currentSave, storyPack) };
        break;
      case "removeItem":
        result = { save: applyRemoveItem(effect as Extract<Effect, { op: "removeItem" }>, currentSave) };
        break;
      case "goto":
        result = { save: applyGoto(effect as Extract<Effect, { op: "goto" }>, currentSave) };
        break;
      case "conditionalEffects":
        result = applyConditionalEffects(effect as Extract<Effect, { op: "conditionalEffects" }>, storyPack, currentSave, rng);
        break;
      case "chooseRunVariant":
        result = applyChooseRunVariant(effect as Extract<Effect, { op: "chooseRunVariant" }>, storyPack, currentSave, rng);
        break;
      case "applyVariantStartEffects":
        result = applyVariantStartEffects(storyPack, currentSave, rng);
        break;
      case "fireWorldEvents":
        result = applyFireWorldEvents(storyPack, currentSave, rng);
        break;
      case "learnSpell":
        result = handleLearnSpell(effect as Extract<Effect, { op: "learnSpell" }>, storyPack, currentSave);
        break;
      case "narrativeSpell":
        result = handleNarrativeSpell(effect as Extract<Effect, { op: "narrativeSpell" }>, storyPack, currentSave, rng);
        break;
      case "acquireTalent":
        result = handleAcquireTalent(effect as Extract<Effect, { op: "acquireTalent" }>, storyPack, currentSave);
        break;
      case "grantXp":
        result = handleGrantXp(effect as Extract<Effect, { op: "grantXp" }>, currentSave);
        break;
      case "grantFatePoint":
        result = handleGrantFatePoint(effect as Extract<Effect, { op: "grantFatePoint" }>, currentSave);
        break;
      case "addCondition":
        result = { save: applyAddCondition(effect as Extract<Effect, { op: "addCondition" }>, currentSave) };
        break;
      case "removeCondition":
        result = { save: applyRemoveCondition(effect as Extract<Effect, { op: "removeCondition" }>, currentSave) };
        break;
      default:
        result = { save: currentSave };
        break;
    }

    currentSave = result.save;
    if (result.emittedEffects && result.emittedEffects.length > 0) {
      queue.push(...result.emittedEffects);
    }
  }

  return currentSave;
}
