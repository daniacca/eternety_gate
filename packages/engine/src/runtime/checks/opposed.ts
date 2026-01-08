import type { OpposedCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { computeTargetBreakdown } from "./target";
import { evaluateRoll } from "./evaluation";

export function performOpposedCheck(
  check: OpposedCheck,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG
): CheckResult {
  // Resolve actors - default to active actor if not specified
  const attacker = resolveActor(check.attacker.actorRef, save, storyPack);
  const defender = resolveActor(check.defender.actorRef, save, storyPack) || resolveActor(undefined, save, storyPack);
  if (!attacker || !defender) return null;

  const attackerBreakdown = computeTargetBreakdown(
    attacker,
    check.attacker.key,
    check.attacker.difficulty || "NORMAL",
    save,
    storyPack
  );
  const defenderBreakdown = computeTargetBreakdown(
    defender,
    check.defender.key,
    check.defender.difficulty || "NORMAL",
    save,
    storyPack
  );

  const attackerTarget = attackerBreakdown.target;
  const defenderTarget = defenderBreakdown.target;

  // Roll for both sides
  const attackerRoll = rng.rollD100();
  const defenderRoll = rng.rollD100();

  // Evaluate both rolls
  const attackerResult = evaluateRoll(attackerRoll, attackerTarget, storyPack, check.id, attacker.id);
  const defenderResult = evaluateRoll(defenderRoll, defenderTarget, storyPack, check.id, defender.id);

  if (!attackerResult || !defenderResult) {
    return null;
  }

  // Opposed check rules:
  // 1. If attacker fails -> attacker loses (regardless of defender)
  // 2. If attacker succeeds:
  //    - If defender fails -> attacker wins, DoS = attacker DoS
  //    - If defender succeeds -> compare DoS:
  //      - attacker wins if attackerDoS > defenderDoS
  //      - tie (equal DoS) -> defender wins
  //      - if attacker wins, opposed DoS = attackerDoS - defenderDoS

  let attackerWins = false;
  let opposedDoS = 0;

  if (!attackerResult.success) {
    // Attacker fails -> loses regardless of defender
    attackerWins = false;
    opposedDoS = 0;
  } else {
    // Attacker succeeded
    if (!defenderResult.success) {
      // Defender fails -> attacker wins
      attackerWins = true;
      opposedDoS = attackerResult.dos;
    } else {
      // Both succeeded -> compare DoS
      if (attackerResult.dos > defenderResult.dos) {
        attackerWins = true;
        opposedDoS = attackerResult.dos - defenderResult.dos;
      } else {
        // Tie or defender has higher DoS -> defender wins
        attackerWins = false;
        opposedDoS = 0;
      }
    }
  }

  const isTie = attackerResult.success && defenderResult.success && attackerResult.dos === defenderResult.dos;

  // Build tags with defender details and breakdown
  const tags = [...attackerResult.tags];
  tags.push(`opposed:defenderId=${defender.id}`);
  tags.push(`opposed:defRoll=${defenderRoll}`);
  tags.push(`opposed:defTarget=${defenderTarget}`);
  tags.push(`opposed:attDoS=${attackerResult.dos}`);
  tags.push(`opposed:defDoS=${defenderResult.dos}`);
  tags.push(`opposed:attSuccess=${attackerResult.success ? 1 : 0}`);
  tags.push(`opposed:defSuccess=${defenderResult.success ? 1 : 0}`);
  if (isTie) {
    tags.push("opposed:tie=1");
  }

  // Add target breakdown tags for both sides
  tags.push(`att:calc:base=${attackerBreakdown.baseValue}`);
  tags.push(`att:calc:diff=${attackerBreakdown.difficultyMod}`);
  tags.push(`att:calc:mods=${attackerBreakdown.tempModsSum}`);
  tags.push(`att:calc:target=${attackerTarget}`);
  tags.push(`def:calc:base=${defenderBreakdown.baseValue}`);
  tags.push(`def:calc:diff=${defenderBreakdown.difficultyMod}`);
  tags.push(`def:calc:mods=${defenderBreakdown.tempModsSum}`);
  tags.push(`def:calc:target=${defenderTarget}`);

  // Return result representing opposed outcome
  return {
    checkId: check.id,
    actorId: attacker.id,
    roll: attackerRoll,
    target: attackerTarget,
    success: attackerWins,
    dos: opposedDoS,
    dof: 0, // Keep opposed outcome clean
    critical: attackerResult.critical,
    tags,
  };
}

