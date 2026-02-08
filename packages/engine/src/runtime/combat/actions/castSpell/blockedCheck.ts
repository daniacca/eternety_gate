import type { CheckResult, GameSave } from "../../../types";
import { appendRuntimeLog } from "../../narration";

type BlockedCheckOptions = {
  message?: string;
  turnCounter?: number;
};

export function buildBlockedCheck(checkId: string, actorId: string, tags: string[]): CheckResult {
  return {
    checkId,
    actorId,
    roll: 0,
    target: 0,
    success: false,
    dos: 0,
    dof: 0,
    critical: "none",
    tags,
  };
}

export function applyBlockedCheck(
  save: GameSave,
  blockedCheck: CheckResult,
  options?: BlockedCheckOptions
): GameSave {
  let updatedSave: GameSave = {
    ...save,
    runtime: {
      ...save.runtime,
      lastCheck: blockedCheck,
    },
  };

  if (options?.message) {
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: options.message,
      turnCounter: options.turnCounter ?? save.runtime.combat?.turnCounter ?? 0,
    });
  }

  return updatedSave;
}
