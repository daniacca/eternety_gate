import type { Effect, GameSave } from "../../../types";
import { getActorSize, getFootprintRadius } from "../../footprint";
import { getCellTerrain } from "../../terrain";
import { hasCondition } from "../../../conditions";

export function computeCoverModifier(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  save: GameSave,
  defenderPos: { x: number; y: number },
  attacker: GameSave["actorsById"][string],
): "NONE" | "LIGHT" | "HEAVY" {
  let coverModifier: "NONE" | "LIGHT" | "HEAVY" = "NONE";
  if (effect.mode === "RANGED") {
    // Cover only applies to actors with 1x1 footprint (radius 0)
    // Larger actors (3x3 or 5x5 footprint) cannot benefit from cover due to their size
    const defenderActor = save.actorsById[effect.defenderId];
    const defenderSize = getActorSize(defenderActor);
    const defenderFootprintRadius = getFootprintRadius(defenderSize);
    const defenderIsFlyer = defenderActor?.traits?.["trait:flyer"] !== undefined;
    if (defenderIsFlyer) {
      coverModifier = "NONE";
    } else if (defenderFootprintRadius === 0) {
      const terrain = getCellTerrain(save, defenderPos);
      if (terrain.cover === "light") {
        coverModifier = "LIGHT";
      } else if (terrain.cover === "heavy") {
        coverModifier = "HEAVY";
      }
    }
  }
  if (effect.mode === "RANGED" && attacker && hasCondition(attacker, "perfect_timing")) {
    coverModifier = "NONE";
  }
  return coverModifier;
}
