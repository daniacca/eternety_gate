import type { Actor } from "../types";
import type { HookContext, HookDefinition } from "./types";
import { loadCharacterCatalogs, loadWeaponQualities, loadConditionCatalogs } from "../../content/loadCatalogs";
import { getGlobalHooks } from "./catalogs";
import { getSpellById, getEffectById } from "../magic/catalogs";
import { resolveWeaponQualities } from "../weaponQualities";
import type { ConditionDefinition } from "../../content/catalogs";

function collectActorHooks(actor: Actor | undefined, hooks: HookDefinition[], catalogs?: ReturnType<typeof loadCharacterCatalogs>) {
  if (!actor || !catalogs) return;

  for (const [talentId, rank] of Object.entries(actor.talents ?? {})) {
    if (rank < 1) continue;
    const talent = catalogs.talents.find((entry) => entry.id === talentId);
    if (talent?.hooks?.length) {
      hooks.push(...talent.hooks);
    }
  }

  for (const traitId of Object.keys(actor.traits ?? {})) {
    const trait = catalogs.traits.find((entry) => entry.id === traitId);
    if (trait?.hooks?.length) {
      hooks.push(...trait.hooks);
    }
  }
}

function collectConditionHooks(actor: Actor | undefined, conditionCatalog?: Record<string, ConditionDefinition>) {
  if (!actor || !conditionCatalog) return [];
  const hooks: HookDefinition[] = [];
  for (const conditionId of Object.keys(actor.conditions ?? {})) {
    const condition = conditionCatalog[conditionId];
    if (condition?.hooks?.length) {
      hooks.push(...condition.hooks);
    }
  }
  return hooks;
}

export function collectHooks(context: HookContext): HookDefinition[] {
  const hooks: HookDefinition[] = [];
  const { storyPack } = context;
  hooks.push(...getGlobalHooks());
  if (storyPack?.hooks) {
    hooks.push(...(storyPack.hooks as HookDefinition[]));
  }
  const catalogs = context.catalogs ?? (storyPack ? loadCharacterCatalogs(storyPack) : undefined);
  const weaponQualityCatalog = context.weaponQualityCatalog ?? (storyPack ? loadWeaponQualities(storyPack) : undefined);

  collectActorHooks(context.attacker, hooks, catalogs);
  collectActorHooks(context.defender, hooks, catalogs);

  if (context.weapon && weaponQualityCatalog) {
    const qualities = resolveWeaponQualities(context.weapon, weaponQualityCatalog);
    for (const quality of qualities) {
      const def = weaponQualityCatalog[quality.id];
      if (def?.hooks?.length) {
        hooks.push(...def.hooks);
      }
    }
  }

  if (context.spellId) {
    const spell = getSpellById(context.spellId);
    if (spell?.hooks?.length) {
      hooks.push(...spell.hooks);
    }
  }

  if (context.effectId) {
    const effect = getEffectById(context.effectId);
    if (effect?.hooks?.length) {
      hooks.push(...effect.hooks);
    }
  }

  if (storyPack?.conditions) {
    const conditionCatalog = loadConditionCatalogs(storyPack);
    hooks.push(...collectConditionHooks(context.attacker, conditionCatalog));
    hooks.push(...collectConditionHooks(context.defender, conditionCatalog));
  }

  return hooks;
}
