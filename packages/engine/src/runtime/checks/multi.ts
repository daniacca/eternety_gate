import type { MultiCheck, CheckResult, StoryPack, GameSave } from "../types";
import { type IRNG } from "../rng";
import { resolveActor } from "./resolve";
import { getStatOrSkillValue } from "./values";
import { resolveDifficulty } from "./target";
import { rollD100CheckWithFate, type FateRerollContext } from "./fate";
import { getTalentParamEntries } from "../characters/prerequisites";
import { getSkillBaseStat } from "./skills";
import { getCharacteristicBonus } from "../characters/bonuses";
import { loadCharacterCatalogs } from "../../content/loadCatalogs";

export function performMultiCheck(
  check: MultiCheck,
  storyPack: StoryPack | undefined,
  save: GameSave,
  rng: IRNG,
  fateContext?: FateRerollContext
): CheckResult {
  const actor = resolveActor(check.actorRef, save, storyPack);
  if (!actor) return null;

  if (check.useFateMastery) {
    const fatePoints = actor.resources.fatePoints ?? 0;
    if (fatePoints > 0) {
      for (const option of check.options) {
        if (!option.key.startsWith("SKILL:")) continue;
        const skillId = option.key.substring(6);
        const hasMastery = getTalentParamEntries(actor, "talent:mastery").some(
          (entry) => entry.params?.chosenSkill === skillId
        );
        if (!hasMastery) continue;
        const baseValue = getStatOrSkillValue(actor, option.key, save, storyPack);
        const difficultyMod = resolveDifficulty(option.difficulty, storyPack);
        const target = baseValue + difficultyMod;
        const baseStat = getSkillBaseStat(skillId, storyPack);
        const catalogs =
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
        const dos = baseStat ? getCharacteristicBonus(save, actor.id, baseStat, catalogs) : 0;
        return {
          checkId: check.id,
          actorId: actor.id,
          roll: 0,
          target,
          success: true,
          dos,
          dof: 0,
          critical: "none",
          tags: ["talent:skillMastery", "fate:mastery=1", `mastery:skill=${skillId}`, `mastery:dos=${dos}`],
        };
      }
    }
  }

  // Try each option, succeed if any succeeds
  for (const option of check.options) {
    const baseValue = getStatOrSkillValue(actor, option.key, save, storyPack);
    const difficultyMod = resolveDifficulty(option.difficulty, storyPack);
    const target = baseValue + difficultyMod;

    const result = rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);
    if (result && result.success) {
      return result;
    }
  }

  // All failed, return last result
  const lastOption = check.options[check.options.length - 1];
  const baseValue = getStatOrSkillValue(actor, lastOption.key, save, storyPack);
  const difficultyMod = resolveDifficulty(lastOption.difficulty, storyPack);
  const target = baseValue + difficultyMod;

  return rollD100CheckWithFate(check.id, actor.id, target, storyPack, save, rng, fateContext);
}
