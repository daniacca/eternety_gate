import type { GameSave } from "../../../types";

export function resolveAoERangeSquares(save: GameSave, weaponRange?: number): number {
  const combat = save.runtime.combat;
  if (weaponRange !== undefined) return weaponRange;
  if (!combat?.grid) return 0;
  return Math.max(combat.grid.width, combat.grid.height);
}
