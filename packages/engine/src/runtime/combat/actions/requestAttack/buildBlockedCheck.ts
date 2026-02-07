import type { ActorId, CheckResult } from "../../../types";

export function buildBlockedCheck(attackerId: ActorId, tags: string[]): CheckResult {
  return {
    checkId: "combat:attack:blocked",
    actorId: attackerId,
    roll: 0,
    target: 0,
    success: false,
    dos: 0,
    dof: 0,
    critical: "none",
    tags,
  };
}
