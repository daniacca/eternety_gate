import type { ActorId, CombatState, GameSave, Grid, Position, SceneId, SingleCheck, StoryPack } from "../../types";
import { RNG } from "../../rng";
import { clampToGrid } from "../movement";
import { appendCombatLog, appendRuntimeLog } from "../narration";
import { addConditionToActor } from "../../conditions";
import { getInitiativeBonus } from "../../characters/bonuses";
import { loadCharacterCatalogs, loadTerrainCatalogs } from "../../../content/loadCatalogs";
import { isActorAlive } from "../../characters/actors";
import { performCheckWithSave } from "../../checks";
import { hasTalentHook } from "../../characters/talentModifiers";
import { getActorSize, getFootprintCells, getFootprintRadius } from "../footprint";
import { posKey } from "../../items/posKey";
import { initializeTurnState } from "./initializeTurnState";

/**
 * Starts combat with given participants, grid, and placements
 */
export function startCombat(
  storyPack: StoryPack,
  save: GameSave,
  participantIds: ActorId[],
  startedBySceneId?: SceneId,
  grid?: Grid,
  placements?: Array<{ actorId: ActorId; x: number; y: number }>,
  partyPlacement?: { kind: "point"; x: number; y: number } | { kind: "area"; x: number; y: number; width: number; height: number },
  gridId?: string,
): GameSave {
  const rng = new RNG(save.runtime.rngSeed, save.runtime.rngCounter || 0);

  // Filter participants: must exist and be alive (isDead !== true)
  const validParticipants = participantIds.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });

  if (validParticipants.length === 0) {
    return save;
  }

  // Load catalogs from storyPack for initiative bonus calculation
  const catalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;

  // Calculate initiative for each participant
  type InitiativeEntry = {
    id: ActorId;
    iniBonus: number;
    iniRoll: number;
    iniScore: number;
  };

  const initiatives: InitiativeEntry[] = validParticipants.map((id) => {
    const iniBonus = getInitiativeBonus(save, id, catalogs);
    const iniRoll = rng.nextInt(1, 10); // d10
    const iniScore = iniBonus + iniRoll;

    return {
      id,
      iniBonus,
      iniRoll,
      iniScore,
    };
  });

  // Sort by iniScore desc, then iniBonus desc, then actorId asc (deterministic)
  initiatives.sort((a, b) => {
    if (b.iniScore !== a.iniScore) {
      return b.iniScore - a.iniScore;
    }
    if (b.iniBonus !== a.iniBonus) {
      return b.iniBonus - a.iniBonus;
    }
    return a.id.localeCompare(b.id);
  });

  const orderedIds = initiatives.map((entry) => entry.id);
  const currentTurnActorId = orderedIds[0];
  const initiativeByActorId = initiatives.reduce<Record<ActorId, { iniBonus: number; iniRoll: number; iniScore: number }>>(
    (acc, entry) => {
      acc[entry.id] = {
        iniBonus: entry.iniBonus,
        iniRoll: entry.iniRoll,
        iniScore: entry.iniScore,
      };
      return acc;
    },
    {},
  );

  // Initialize grid: load from catalog if gridId provided, use explicit grid, or default to 10x10
  let combatGrid: Grid;
  if (gridId && storyPack) {
    // Try to load grid from catalog
    const terrainCatalogs = loadTerrainCatalogs(storyPack);
    const gridDef = terrainCatalogs.gridsById[gridId];
    if (gridDef) {
      combatGrid = { width: gridDef.width, height: gridDef.height };
    } else {
      // Fallback if gridId not found
      combatGrid = grid || { width: 10, height: 10 };
    }
  } else {
    // Use explicit grid or default
    combatGrid = grid || { width: 10, height: 10 };
  }

  // Initialize positions from placements
  const positions: Record<ActorId, Position> = {};
  if (placements) {
    for (const placement of placements) {
      if (orderedIds.includes(placement.actorId)) {
        positions[placement.actorId] = clampToGrid({ x: placement.x, y: placement.y }, combatGrid);
      }
    }
  }

  const terrainCatalogs = loadTerrainCatalogs(storyPack);
  const terrainGridId = gridId || "arena_01";
  const gridDef = terrainCatalogs.gridsById[terrainGridId];

  const isCellWalkable = (pos: Position): boolean => {
    if (!gridDef) return true;
    const override = gridDef.cells?.[posKey(pos)];
    return override?.walkable ?? gridDef.defaults?.walkable ?? true;
  };

  const occupiedCells = new Set<string>();
  const markOccupied = (actorId: ActorId, center: Position) => {
    const actor = save.actorsById[actorId];
    const radius = getFootprintRadius(getActorSize(actor));
    for (const cell of getFootprintCells(center, radius)) {
      occupiedCells.add(posKey(cell));
    }
  };

  for (const [actorId, pos] of Object.entries(positions)) {
    markOccupied(actorId as ActorId, pos);
  }

  const canPlaceAt = (actorId: ActorId, center: Position): boolean => {
    const actor = save.actorsById[actorId];
    const radius = getFootprintRadius(getActorSize(actor));
    for (const cell of getFootprintCells(center, radius)) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= combatGrid.width || cell.y >= combatGrid.height) {
        return false;
      }
      if (!isCellWalkable(cell)) return false;
      if (occupiedCells.has(posKey(cell))) return false;
    }
    return true;
  };

  const candidateCellsFromPlacement = (): Position[] => {
    if (!partyPlacement) return [];
    const cells: Position[] = [];
    if (partyPlacement.kind === "area") {
      const width = Math.max(1, partyPlacement.width);
      const height = Math.max(1, partyPlacement.height);
      for (let y = partyPlacement.y; y < partyPlacement.y + height; y++) {
        for (let x = partyPlacement.x; x < partyPlacement.x + width; x++) {
          if (x >= 0 && y >= 0 && x < combatGrid.width && y < combatGrid.height) {
            cells.push({ x, y });
          }
        }
      }
      return cells;
    }

    const origin = { x: partyPlacement.x, y: partyPlacement.y };
    if (origin.x >= 0 && origin.y >= 0 && origin.x < combatGrid.width && origin.y < combatGrid.height) {
      cells.push(origin);
    }
    const maxRadius = Math.max(combatGrid.width, combatGrid.height);
    for (let r = 1; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = origin.x + dx;
          const y = origin.y + dy;
          if (x >= 0 && y >= 0 && x < combatGrid.width && y < combatGrid.height) {
            cells.push({ x, y });
          }
        }
      }
      if (cells.length >= combatGrid.width * combatGrid.height) break;
    }
    return cells;
  };

  const allGridCells: Position[] = [];
  for (let y = 0; y < combatGrid.height; y++) {
    for (let x = 0; x < combatGrid.width; x++) {
      allGridCells.push({ x, y });
    }
  }

  const candidateCells = candidateCellsFromPlacement();
  const partyMemberIds = save.party?.actors ?? [];
  for (const partyId of partyMemberIds) {
    if (!orderedIds.includes(partyId)) continue;
    if (positions[partyId]) continue;
    let placed = false;
    const preferred = candidateCells.length > 0 ? candidateCells : allGridCells;
    for (const cell of preferred) {
      if (canPlaceAt(partyId, cell)) {
        positions[partyId] = cell;
        markOccupied(partyId, cell);
        placed = true;
        break;
      }
    }
    if (!placed) {
      const fallback = { x: 0, y: 0 };
      positions[partyId] = clampToGrid(fallback, combatGrid);
      markOccupied(partyId, positions[partyId]);
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

  // Initialize turn state for first actor
  const firstActor = save.actorsById[currentTurnActorId];
  const initialTurnState = firstActor
    ? initializeTurnState(firstActor, save, catalogs)
    : { moveRemaining: 0, actionAvailable: true };

  // Save initial HP for each participant (for UI display of max HP)
  const initialHpByActorId: Record<ActorId, number> = {};
  for (const id of orderedIds) {
    const actor = save.actorsById[id];
    if (actor) {
      // Store initial HP (maxHp - wounds) for UI display
      // We'll calculate maxHp when needed, but for now store current HP
      const wounds = actor.resources.wounds ?? 0;
      // We'll need to calculate maxHp properly, but for backward compatibility store current HP
      // This will be recalculated in UI components using calculateMaxHp
      initialHpByActorId[id] = actor.derived?.hpMax ?? 100 - wounds;
    }
  }

  const combatState: CombatState = {
    active: true,
    participants: orderedIds,
    currentIndex: 0,
    round: 1,
    startedBySceneId: sceneIdForCombat,
    grid: combatGrid,
    gridId: gridId || "arena_01",
    positions,
    turn: initialTurnState,
    stancesByActorId: {},
    turnCounter: 0,
    parryDisabledUntilTurnCounterByActorId: {},
    weaponRechargeUntilTurnCounterByActorId: {},
    equippedThisRoundByActorId: {},
    initialHpByActorId,
    initiativeByActorId,
    damageTakenSinceLastTurnByActorId: {},
    damageDealtSinceLastTurnByActorId: {},
  };

  // Reset combat log and initialize with start message
  const initialCombatLog = ["Il combattimento è iniziato."];

  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      combat: combatState,
      rngCounter: rng.getCounter(),
      combatLog: initialCombatLog,
      combatLogSceneId: sceneIdForCombat,
      runtimeLog: [],
      // Set combatTurnStartIndex to point after the start message (index 1, after we add header)
      combatTurnStartIndex: 1,
    },
  };

  // Log initiative rolls - only for player-controlled actors by default
  // TODO: Add debug flag support for revealing NPC rolls
  const REVEAL_NPC_ROLLS = false;
  const partyIds = new Set(save.party?.actors ?? []);

  for (const entry of initiatives) {
    const actor = save.actorsById[entry.id];
    const isPlayerControlled = actor?.kind === "PC" || partyIds.has(entry.id);

    // Only log if player-controlled or if debug flag is enabled
    if (isPlayerControlled || REVEAL_NPC_ROLLS) {
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "initiative",
        actorId: entry.id,
        iniBonus: entry.iniBonus,
        iniRoll: entry.iniRoll,
        iniScore: entry.iniScore,
        turnCounter: 0,
      });
    }
  }

  // Add turn header for first turn
  const isPlayerTurn = firstActor?.kind === "PC";
  const actorName = firstActor?.name || currentTurnActorId;
  const turnHeader = isPlayerTurn ? `— Tocca a te —` : `— Turno 1: ${actorName} —`;
  updatedSave = appendCombatLog(updatedSave, turnHeader);

  // Fear: apply willpower test at combat start
  const fearCatalogs =
    storyPack?.skills || storyPack?.talents || storyPack?.traits
      ? loadCharacterCatalogs({
          id: storyPack.id,
          items: storyPack.items || [],
          weapons: storyPack.weapons || [],
          armors: storyPack.armors || [],
          skills: storyPack.skills || [],
          talents: storyPack.talents || [],
          traits: storyPack.traits || [],
        })
      : undefined;
  const fearSources = orderedIds
    .map((id) => {
      const actor = save.actorsById[id];
      const fearParams = actor?.traits?.["trait:fear"];
      const fearRank =
        typeof fearParams === "object" && typeof fearParams.x === "number" ? fearParams.x : 0;
      return { id, fearRank };
    })
    .filter((entry) => entry.fearRank > 0);

  if (fearSources.length > 0) {
    for (const targetId of orderedIds) {
      const targetActor = updatedSave.actorsById[targetId];
      if (!targetActor) continue;
      if (targetActor.traits?.["trait:from_beyond"] !== undefined) {
        continue;
      }
      if (fearCatalogs && hasTalentHook(targetActor, fearCatalogs, "jaded")) {
        continue;
      }
      if (targetActor.conditions?.frenzy !== undefined) {
        continue;
      }
      const maxFear = Math.max(
        0,
        ...fearSources.filter((source) => source.id !== targetId).map((source) => source.fearRank),
      );
      if (maxFear <= 0) continue;
      const fearPenalty = -10 * Math.max(0, maxFear - 1);
      const fearCheck: SingleCheck = {
        id: `combat:fear:${targetId}`,
        kind: "single",
        actorRef: { mode: "byId", actorId: targetId },
        key: "WIL",
        difficulty: "Challenging",
        modifier: fearPenalty,
      };
      const { result: fearResult, save: saveAfterFearCheck } = performCheckWithSave(
        fearCheck,
        storyPack,
        updatedSave,
        rng,
        `res:fear:${targetId}`,
      );
      updatedSave = {
        ...saveAfterFearCheck,
        runtime: {
          ...saveAfterFearCheck.runtime,
          rngCounter: rng.getCounter(),
        },
      };
      if (!fearResult?.success) {
        const shockedActor = addConditionToActor(
          updatedSave.actorsById[targetId],
          "shock",
          1,
          undefined,
          "trait:fear",
        );
        updatedSave = {
          ...updatedSave,
          actorsById: {
            ...updatedSave.actorsById,
            [targetId]: shockedActor,
          },
        };
        const fearLog =
          targetActor.kind === "PC"
            ? "Sei terrorizzato dall'orrore innaturale e resti sotto shock."
            : `${targetActor.name || targetId} è terrorizzato dall'orrore innaturale e resta sotto shock.`;
        updatedSave = appendCombatLog(updatedSave, fearLog);
      }
    }
  }

  return updatedSave;
}
