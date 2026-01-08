import type { StoryPack, GameSave, ActorId, Effect } from "../types";
import { RNG } from "../rng";
import { distanceChebyshev } from "./movement";
import { getActorWeapon } from "./equipment";
import { applyEffects } from "../effects";
import { hasCondition } from "../conditions";

/**
 * Runs an NPC turn (auto-attack or move)
 * Returns effects that are then applied via applyEffects
 */
export function runNpcTurn(storyPack: StoryPack, save: GameSave, npcId: ActorId): GameSave {
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
    return applyEffects([standUpEffect], storyPack, save, rng);
  }

  // Target is always the active party member
  const targetId = save.party.activeActorId;

  // Get positions
  const npcPos = combat.positions?.[npcId];
  const targetPos = combat.positions?.[targetId];

  if (!npcPos || !targetPos) {
    return save;
  }

  const dist = distanceChebyshev(npcPos, targetPos);

  // Get NPC weapon to determine attack mode and range
  const { weapon, weaponId: npcWeaponId } = getActorWeapon(save, npc);
  const npcHasRanged = weapon?.kind === "RANGED";
  const weaponRange = weapon?.range;

  // Decision logic:
  // 1. If dist <= 1: MELEE attack
  // 2. Else if npcHasRanged && dist <= weapon.range.long: RANGED attack
  // 3. Else: MOVE toward target

  const effects: Effect[] = [];

  if (dist <= 1) {
    // MELEE attack - emit combatRequestAttack
    const attackEffect: Effect = {
      op: "combatRequestAttack",
      attackerId: npcId,
      defenderId: targetId,
      mode: "MELEE",
      weaponId: npcWeaponId === "unarmed" ? null : npcWeaponId,
      defense: {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      },
    };
    effects.push(attackEffect);
  } else if (npcHasRanged && weaponRange && dist <= weaponRange.long) {
    // RANGED attack - emit combatRequestAttack
    const rangeBand = dist <= weaponRange.short ? "SHORT" : "LONG";
    const attackEffect: Effect = {
      op: "combatRequestAttack",
      attackerId: npcId,
      defenderId: targetId,
      mode: "RANGED",
      weaponId: npcWeaponId === "unarmed" ? null : npcWeaponId,
      modifiers: {
        rangeBand: rangeBand as any,
      },
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
      // Calculate how many squares we can move
      // Move toward target, stopping at melee range (dist = 1)
      // So we can move up to (dist - 1) squares, but not more than movement remaining
      const movesToMake = Math.min(moveRemaining, Math.max(0, dist - 1));

      // Calculate direction toward target
      const dx = targetPos.x - npcPos.x;
      const dy = targetPos.y - npcPos.y;

      // Normalize to -1, 0, or 1 for Chebyshev movement
      const moveX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
      const moveY = dy !== 0 ? (dy > 0 ? 1 : -1) : 0;

      // Determine direction
      let dir: "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" = "N";
      if (moveX === 0 && moveY === -1) dir = "N";
      else if (moveX === 1 && moveY === -1) dir = "NE";
      else if (moveX === 1 && moveY === 0) dir = "E";
      else if (moveX === 1 && moveY === 1) dir = "SE";
      else if (moveX === 0 && moveY === 1) dir = "S";
      else if (moveX === -1 && moveY === 1) dir = "SW";
      else if (moveX === -1 && moveY === 0) dir = "W";
      else if (moveX === -1 && moveY === -1) dir = "NW";

      // Emit multiple move effects (one per square)
      for (let i = 0; i < movesToMake; i++) {
        const moveEffect: Effect = {
          op: "combatMove",
          dir,
        };
        effects.push(moveEffect);
      }
    }
  }

  // Apply effects (they will be processed via queue)
  return applyEffects(effects, storyPack, save, rng);
}
