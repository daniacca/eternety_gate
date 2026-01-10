import type { StoryPack, GameSave, ActorId, Effect } from "../types";
import { RNG } from "../rng";
import { distanceChebyshev } from "./movement";
import { getActorWeapon } from "./equipment";
import { applyEffects } from "../effects";
import { hasCondition } from "../conditions";
import { isActorAlive } from "../characters/actors";

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

      // Helper function to check if a position is blocked by a living actor
      const isPositionBlocked = (x: number, y: number): boolean => {
        // Check bounds
        if (x < 0 || x >= combat.grid.width || y < 0 || y >= combat.grid.height) return true;
        // Check if occupied by living actor
        return Object.entries(combat.positions).some(([actorId, pos]) => {
          if (actorId === npcId) return false; // Don't check self
          if (pos.x !== x || pos.y !== y) return false;
          const actor = save.actorsById[actorId];
          return actor && actor.resources.isDead !== true; // Only block if alive
        });
      };

      // Helper function to get direction from delta
      const getDirection = (moveX: number, moveY: number): "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW" => {
        if (moveX === 0 && moveY === -1) return "N";
        else if (moveX === 1 && moveY === -1) return "NE";
        else if (moveX === 1 && moveY === 0) return "E";
        else if (moveX === 1 && moveY === 1) return "SE";
        else if (moveX === 0 && moveY === 1) return "S";
        else if (moveX === -1 && moveY === 1) return "SW";
        else if (moveX === -1 && moveY === 0) return "W";
        else if (moveX === -1 && moveY === -1) return "NW";
        return "N"; // fallback
      };

      // Calculate primary direction toward target
      const dx = targetPos.x - npcPos.x;
      const dy = targetPos.y - npcPos.y;
      const moveX = dx !== 0 ? (dx > 0 ? 1 : -1) : 0;
      const moveY = dy !== 0 ? (dy > 0 ? 1 : -1) : 0;

      // Try to move toward target, with fallback to perpendicular directions if blocked
      let currentX = npcPos.x;
      let currentY = npcPos.y;

      for (let i = 0; i < movesToMake; i++) {
        let nextX = currentX + moveX;
        let nextY = currentY + moveY;
        let dir = getDirection(moveX, moveY);

        // If primary direction is blocked, try perpendicular directions
        if (isPositionBlocked(nextX, nextY)) {
          // Try perpendicular directions (prioritize directions that get closer to target)
          const alternatives: Array<{ x: number; y: number }> = [];

          // Add perpendicular directions
          if (moveX !== 0 && moveY !== 0) {
            // Diagonal movement blocked - try cardinal directions
            alternatives.push({ x: currentX + moveX, y: currentY }); // Same X, no Y change
            alternatives.push({ x: currentX, y: currentY + moveY }); // Same Y, no X change
          } else if (moveX !== 0) {
            // Horizontal movement blocked - try vertical
            alternatives.push({ x: currentX, y: currentY + 1 });
            alternatives.push({ x: currentX, y: currentY - 1 });
          } else if (moveY !== 0) {
            // Vertical movement blocked - try horizontal
            alternatives.push({ x: currentX + 1, y: currentY });
            alternatives.push({ x: currentX - 1, y: currentY });
          }

          // Find first unblocked alternative
          let foundAlternative = false;
          for (const alt of alternatives) {
            if (!isPositionBlocked(alt.x, alt.y)) {
              nextX = alt.x;
              nextY = alt.y;
              dir = getDirection(nextX - currentX, nextY - currentY);
              foundAlternative = true;
              break;
            }
          }

          // If all directions blocked, stop moving
          if (!foundAlternative) {
            break;
          }
        }

        // Emit move effect
        const moveEffect: Effect = {
          op: "combatMove",
          dir,
        };
        effects.push(moveEffect);

        // Update current position for next iteration
        currentX = nextX;
        currentY = nextY;
      }
    }
  }

  // Apply effects (they will be processed via queue)
  return applyEffects(effects, storyPack, save, rng);
}
