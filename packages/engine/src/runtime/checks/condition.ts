import type { ConditionCheck, CheckResult, StoryPack, GameSave } from "../types";
import { evaluateCondition } from "../conditions";
import { resolveActor } from "./resolve";

export function performConditionCheck(
  check: ConditionCheck,
  storyPack: StoryPack | undefined,
  save: GameSave
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack) ?? save.actorsById[save.party.activeActorId];
  const actorId = actor?.id ?? save.party.activeActorId;
  const success = evaluateCondition(check.condition, save);

  return {
    checkId: check.id,
    actorId,
    roll: 0,
    target: 0,
    success,
    dos: 0,
    dof: 0,
    critical: "none",
    tags: ["check:condition"],
  };
}
