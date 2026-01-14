import type { GameSave, Position } from "../types";
import { posKey } from "../items/posKey";
import { loadTerrainCatalogs } from "../../content/loadCatalogs";
import type { ContentPack } from "../../content/types";

/**
 * Gets the active grid definition from catalogs
 */
export function getGrid(save: GameSave, contentPack?: ContentPack): {
  id: string;
  width: number;
  height: number;
  defaults: {
    walkable: boolean;
    cover: "none" | "light" | "heavy";
    tileId: string;
  };
  cells?: Record<string, {
    walkable?: boolean;
    cover?: "none" | "light" | "heavy";
    tileId?: string;
  }>;
} | null {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return null;
  }

  const gridId = combat.gridId || "arena_01";

  // Try to load from contentPack if provided
  if (contentPack) {
    const terrainCatalogs = loadTerrainCatalogs(contentPack);
    const grid = terrainCatalogs.gridsById[gridId];
    if (grid) {
      return grid;
    }
  }

  // Fallback: return a default grid definition matching the combat grid dimensions
  return {
    id: gridId,
    width: combat.grid.width,
    height: combat.grid.height,
    defaults: {
      walkable: true,
      cover: "none",
      tileId: "plains",
    },
  };
}

/**
 * Gets terrain information for a specific cell position
 * Returns { walkable, cover, tileId } using defaults + cell overrides
 */
export function getCellTerrain(
  save: GameSave,
  pos: Position,
  contentPack?: ContentPack
): {
  walkable: boolean;
  cover: "none" | "light" | "heavy";
  tileId: string;
} {
  const gridDef = getGrid(save, contentPack);
  if (!gridDef) {
    // Fallback if no grid definition
    return {
      walkable: true,
      cover: "none",
      tileId: "plains",
    };
  }

  const key = posKey(pos);
  const cellOverride = gridDef.cells?.[key];

  return {
    walkable: cellOverride?.walkable ?? gridDef.defaults.walkable,
    cover: cellOverride?.cover ?? gridDef.defaults.cover,
    tileId: cellOverride?.tileId ?? gridDef.defaults.tileId,
  };
}
