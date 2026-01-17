import type { Effect, GameSave } from "../../types";
import { getCurrentTurnActorId } from "../combat";
import { appendCombatLog } from "../narration";
import { canPlaceActorAt } from "../footprint";
import { getCellTerrain } from "../terrain";
import type { ContentPack } from "../../../content/types";

/**
 * Moves actor in combat grid
 */
export function combatMove(
  effect: Extract<Effect, { op: "combatMove" }>,
  save: GameSave,
  contentPack?: ContentPack
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    // Not in combat - ignore
    const ignoredCheck = {
      checkId: "combat:move:ignored",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:move:ignored"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: ignoredCheck,
        },
      },
    };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId) {
    // Not player's turn
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Allow both PC and NPC movement, but only for the current turn actor.
  const actorId = effect.actorId ?? turnActorId;
  if (actorId !== turnActorId) {
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const actor = save.actorsById[actorId];
  if (!actor || actor.resources.isDead === true) {
    return { save };
  }

  const canFly = actor.traits?.["trait:flyer"] !== undefined;

  if (combat.turn.moveRemaining <= 0) {
    // Movement exhausted
    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: save.party.activeActorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=movementExhausted"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Calculate delta based on direction
  const dirDeltas: Record<string, { x: number; y: number }> = {
    N: { x: 0, y: -1 },
    NE: { x: 1, y: -1 },
    E: { x: 1, y: 0 },
    SE: { x: 1, y: 1 },
    S: { x: 0, y: 1 },
    SW: { x: -1, y: 1 },
    W: { x: -1, y: 0 },
    NW: { x: -1, y: -1 },
  };

  const delta = dirDeltas[effect.dir];
  if (!delta) {
    return { save };
  }

  const currentPos = combat.positions[actorId] || { x: 0, y: 0 };
  const newPos = {
    x: Math.max(0, Math.min(combat.grid.width - 1, currentPos.x + delta.x)),
    y: Math.max(0, Math.min(combat.grid.height - 1, currentPos.y + delta.y)),
  };

  // Validate footprint placement (checks bounds, walkability, and overlap with other actors)
  if (!canPlaceActorAt(save, actorId, newPos, contentPack, canFly)) {
    // Check if it's a walkability issue for better error reporting
    const terrain = contentPack ? getCellTerrain(save, newPos, contentPack) : null;
    const isWalkabilityIssue = !canFly && terrain && !terrain.walkable;

    const blockedCheck = {
      checkId: "combat:move:blocked",
      actorId: actorId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: [
        isWalkabilityIssue ? "combat:blocked=notWalkable" : "combat:blocked=positionOccupied",
        `combat:pos=${newPos.x},${newPos.y}`,
      ],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  const updatedPositions = {
    ...combat.positions,
    [actorId]: newPos,
  };

  const updatedCombat = {
    ...combat,
    positions: updatedPositions,
    turn: {
      ...combat.turn,
      moveRemaining: Math.max(0, combat.turn.moveRemaining - 1),
    },
    // Reset channeling when actor moves
    channeling: combat.channeling?.actorId === actorId ? undefined : combat.channeling,
  };

  const moveCheck = {
    checkId: "combat:move",
    actorId: actorId,
    roll: 0,
    target: 0,
    success: true,
    dos: 0,
    dof: 0,
    critical: "none" as const,
    tags: [
      `combat:move=${effect.dir}`,
      `combat:pos:${actorId}=${newPos.x},${newPos.y}`,
      "combat:kind=action", // Mark as action, not a check
    ],
  };

  const dirLabels: Record<string, string> = {
    N: "nord",
    NE: "nord-est",
    E: "est",
    SE: "sud-est",
    S: "sud",
    SW: "sud-ovest",
    W: "ovest",
    NW: "nord-ovest",
  };
  const dirLabel = dirLabels[effect.dir] || effect.dir;
  const logEntry =
    actor?.kind === "PC" ? `Ti muovi verso ${dirLabel}.` : `${actor?.name || actorId} avanza verso di te.`;

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: updatedCombat,
      lastCheck: moveCheck,
    },
  };

  // Add narration to combat log
  updatedSave = appendCombatLog(updatedSave, logEntry);

  return { save: updatedSave };
}
