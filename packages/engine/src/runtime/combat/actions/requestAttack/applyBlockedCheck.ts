import type { ActorId, GameSave } from "../../../types";
import { buildBlockedCheck } from "./buildBlockedCheck";

export function applyBlockedCheck(save: GameSave, attackerId: ActorId, tags: string[]): GameSave {
  return {
    ...save,
    runtime: {
      ...save.runtime,
      lastCheck: buildBlockedCheck(attackerId, tags),
    },
  };
}
