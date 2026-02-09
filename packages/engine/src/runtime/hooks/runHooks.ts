import type { HookContext, HookDefinition, HookPredicate, HookRunResult, HookType, HookValue } from "./types";
import { collectHooks } from "./collectHooks";
import type { CheckResult, ConditionId, Effect } from "../types";
import { rollD100CheckWithFate, createFateRerollContext } from "../checks/fate";
import { performCheckWithSave } from "../checks";
import { getStatOrSkillValue } from "../checks/values";
import { consumeFateProtection } from "../characters/fate";
import { appendCombatLog, appendRuntimeLog } from "../combat/narration";
import { applyDamageToActor } from "../combat/criticalDamage";
import { resetCombatDamageTrackingForActor, trackCombatSelfDamage } from "../combat/damageTracking";
import { removeConditionFromActor } from "../conditions";
import { cleanupConditionRemoval } from "../combat/combat/cleanupConditionRemoval";
import { removeUnnaturalCharacteristicsBySource, removeTraitsBySource } from "../characters/traitHelpers";

function resolveFact(context: HookContext, fact: string): HookValue {
  return context.facts?.[fact] ?? null;
}

function predicateMatches(predicate: HookPredicate, context: HookContext): boolean {
  const op = predicate.op ?? "eq";
  const actual = resolveFact(context, predicate.fact);

  if (op === "truthy") return Boolean(actual);
  if (op === "falsy") return !actual;

  const expected = predicate.value;
  if (op === "in" || op === "notIn") {
    const list = Array.isArray(expected) ? expected : expected !== undefined ? [expected] : [];
    const contains = list.some((value) => value === actual);
    return op === "in" ? contains : !contains;
  }

  if (expected === undefined) return false;

  switch (op) {
    case "eq":
      return actual === expected;
    case "neq":
      return actual !== expected;
    case "gt":
      return typeof actual === "number" && typeof expected === "number" && actual > expected;
    case "gte":
      return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "lt":
      return typeof actual === "number" && typeof expected === "number" && actual < expected;
    case "lte":
      return typeof actual === "number" && typeof expected === "number" && actual <= expected;
    default:
      return false;
  }
}

function hookWhenMatches(hook: HookDefinition, context: HookContext): boolean {
  const when = hook.when;
  if (!when) return true;

  if (when.all && !when.all.every((predicate) => predicateMatches(predicate, context))) {
    return false;
  }
  if (when.any && !when.any.some((predicate) => predicateMatches(predicate, context))) {
    return false;
  }
  if (when.none && when.none.some((predicate) => predicateMatches(predicate, context))) {
    return false;
  }

  return true;
}

function resolveNumber(context: HookContext, value: number | undefined, valueRef: string | undefined): number {
  if (typeof value === "number") return value;
  if (valueRef) {
    const resolved = resolveFact(context, valueRef);
    return typeof resolved === "number" ? resolved : 0;
  }
  return 0;
}

function resolveText(context: HookContext, text: string | undefined, textRef: string | undefined): string | null {
  if (text) return text;
  if (textRef) {
    const resolved = resolveFact(context, textRef);
    return typeof resolved === "string" ? resolved : null;
  }
  return null;
}

function applyHookEffects(hook: HookDefinition, result: HookRunResult, context: HookContext): HookContext {
  let currentContext = context;
  for (const effect of hook.effects) {
    switch (effect.op) {
      case "addCheckTargetMod":
        result.checkTargetMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "addDamageMod":
        result.damageMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "addFinalDamageMod":
        result.finalDamageMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "scaleDamage":
        result.damageMultiplier *= effect.value;
        break;
      case "scaleSoak":
        result.soakMultiplier *= effect.value;
        break;
      case "scalePenetration":
        result.penetrationMultiplier *= effect.value;
        break;
      case "scaleFinalDamage":
        result.finalDamageMultiplier *= effect.value;
        break;
      case "addDamageExtraDice":
        result.damageExtraDice += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "setDamageRollMode":
        result.damageRollMode = effect.mode;
        break;
      case "setDamageRerollOnes":
        result.damageRerollOnes = effect.enabled;
        break;
      case "enableDamageReroll":
        result.allowDamageReroll = true;
        result.damageRerollThreshold = effect.threshold ?? 1;
        break;
      case "addSoakMod":
        result.soakMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "addPenetrationMod":
        result.penetrationMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "addTouBonusMod":
        result.touBonusMod += resolveNumber(currentContext, effect.value, effect.valueRef);
        break;
      case "blockCheck":
        result.blocked = true;
        result.blockReason = effect.reason;
        break;
      case "blockDamage":
        result.blocked = true;
        result.blockReason = effect.reason;
        break;
      case "addTag":
        {
          const tag = resolveText(currentContext, effect.tag, effect.tagRef);
          if (tag) result.tags.push(tag);
        }
        break;
      case "logMessage":
        {
          const message = resolveText(currentContext, effect.message, effect.messageRef);
          if (message) {
            result.logs.push(message);
            result.save = appendCombatLog(result.save, message);
            currentContext = { ...currentContext, save: result.save };
          }
        }
        break;
      case "emitEffect":
        {
          const resolvedEffect = resolveEffectPlaceholders(effect.effect, currentContext);
          result.effects.push(resolvedEffect);
        }
        break;
      case "setRollMode":
        result.rollMode = effect.mode;
        break;
      case "setTurnState": {
        result.turnStateOverride = {
          ...(result.turnStateOverride ?? {}),
          ...(effect.moveRemaining !== undefined ? { moveRemaining: effect.moveRemaining } : {}),
          ...(effect.actionAvailable !== undefined ? { actionAvailable: effect.actionAvailable } : {}),
        };
        break;
      }
      case "resetCombatDamageTracking": {
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        result.save = resetCombatDamageTrackingForActor(currentContext.save, actor.id);
        currentContext = { ...currentContext, save: result.save };
        break;
      }
      case "removeExpiredConditions": {
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        const turnCounter = currentContext.turnCounter;
        if (!actor || turnCounter === undefined) break;
        let updatedSave = currentContext.save;
        let updatedActor = actor;
        const conditionsToRemove: Array<{ conditionId: string; source?: string }> = [];

        if (updatedActor.conditions) {
          for (const [conditionId, instance] of Object.entries(updatedActor.conditions)) {
            if (instance.untilTurnCounter !== undefined && instance.untilTurnCounter < turnCounter) {
              conditionsToRemove.push({ conditionId, source: instance.source });
            }
          }
        }

        for (const { conditionId, source } of conditionsToRemove) {
          const conditionKey = conditionId as ConditionId;
          const instance = updatedActor.conditions?.[conditionKey];
          if (instance) {
            updatedActor = cleanupConditionRemoval(updatedActor, conditionId, instance);
            if (conditionId === "mind_control" && instance.params?.addedToParty) {
              const updatedPartyActors = (updatedSave.party?.actors ?? []).filter((id) => id !== actor.id);
              const nextActiveActorId =
                updatedSave.party?.activeActorId === actor.id
                  ? updatedPartyActors[0] ?? updatedSave.party?.activeActorId
                  : updatedSave.party?.activeActorId;
              updatedSave = {
                ...updatedSave,
                party: {
                  ...updatedSave.party,
                  actors: updatedPartyActors,
                  activeActorId: nextActiveActorId,
                },
              };
            }
            if (conditionId === "summoned") {
              const updatedPartyActors = (updatedSave.party?.actors ?? []).filter((id) => id !== actor.id);
              updatedSave = {
                ...updatedSave,
                party: {
                  ...updatedSave.party,
                  actors: updatedPartyActors,
                  activeActorId: updatedSave.party?.activeActorId ?? actor.id,
                },
                runtime: {
                  ...updatedSave.runtime,
                  combat: updatedSave.runtime.combat
                    ? {
                        ...updatedSave.runtime.combat,
                        positions: Object.fromEntries(
                          Object.entries(updatedSave.runtime.combat.positions).filter(([id]) => id !== actor.id),
                        ),
                      }
                    : updatedSave.runtime.combat,
                },
              };
              updatedActor = {
                ...updatedActor,
                resources: {
                  ...updatedActor.resources,
                  isDead: true,
                },
              };
              updatedSave = appendCombatLog(updatedSave, `${updatedActor.name || actor.id} torna nel nulla.`);
            }
          } else if (source) {
            updatedActor = removeUnnaturalCharacteristicsBySource(updatedActor, source);
            updatedActor = removeTraitsBySource(updatedActor, source);
          }

          updatedActor = removeConditionFromActor(updatedActor, conditionKey);
        }

        if (conditionsToRemove.length > 0) {
          updatedSave = {
            ...updatedSave,
            actorsById: {
              ...updatedSave.actorsById,
              [actor.id]: updatedActor,
            },
          };
        }

        result.save = updatedSave;
        currentContext = { ...currentContext, save: updatedSave };
        break;
      }
      case "gateCheck": {
        if (!currentContext.rng || !currentContext.check) break;
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        const baseTarget = getStatOrSkillValue(actor, effect.key, currentContext.save, currentContext.storyPack);
        const modifier = resolveNumber(currentContext, undefined, effect.modifierRef);
        const fateContext = createFateRerollContext();
        const gateResult = rollD100CheckWithFate(
          `${currentContext.check.id}:gate:${effect.actor}`,
          actor.id,
          baseTarget + modifier,
          currentContext.storyPack,
          currentContext.save,
          currentContext.rng,
          fateContext,
        );
        if (fateContext.used && fateContext.actorId) {
          const consumeResult = consumeFateProtection(currentContext.save, fateContext.actorId);
          result.save = consumeResult.save;
          currentContext = { ...currentContext, save: consumeResult.save };
        }
        if (gateResult && !gateResult.success) {
          if (effect.failLog) {
            result.save = appendCombatLog(result.save, effect.failLog);
            currentContext = { ...currentContext, save: result.save };
          }
          result.checkResult = {
            checkId: currentContext.check?.id ?? "unknown",
            actorId: actor.id,
            roll: gateResult.roll,
            target: gateResult.target,
            success: false,
            dos: gateResult.dos,
            dof: gateResult.dof,
            critical: gateResult.critical,
            tags: effect.failTag ? [...gateResult.tags, effect.failTag] : gateResult.tags,
          };
          result.blocked = true;
          result.blockReason = effect.failTag ?? "gateCheck";
        }
        break;
      }
      case "consumeFateProtection": {
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        const consumeResult = consumeFateProtection(currentContext.save, actor.id);
        if (consumeResult.consumed) {
          result.save = consumeResult.save;
          currentContext = { ...currentContext, save: consumeResult.save };
        }
        break;
      }
      case "checkAndRemoveCondition": {
        const rng = currentContext.rng;
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!rng || !actor) break;
        const modifier = resolveNumber(currentContext, undefined, effect.modifierRef);
        const checkId = resolveText(currentContext, undefined, effect.checkIdRef) ?? `hook:check:${actor.id}`;
        const check = {
          id: checkId,
          kind: "single",
          actorRef: { mode: "byId", actorId: actor.id },
          key: effect.key,
          difficulty: effect.difficulty ?? "Challenging",
          modifier: modifier !== 0 ? modifier : undefined,
        } as const;
        const { result: checkResult, save: saveAfterCheck } = performCheckWithSave(
          check,
          currentContext.storyPack,
          currentContext.save,
          rng,
          `res:${checkId}`,
        );
        result.save = {
          ...saveAfterCheck,
          runtime: {
            ...saveAfterCheck.runtime,
            rngCounter: rng.getCounter(),
          },
        };
        currentContext = { ...currentContext, save: result.save };
        if (checkResult?.success) {
          const updatedActor = removeConditionFromActor(actor, effect.condition);
          result.save = {
            ...currentContext.save,
            actorsById: {
              ...currentContext.save.actorsById,
              [actor.id]: updatedActor,
            },
          };
          currentContext = { ...currentContext, save: result.save };
          if (effect.onSuccessLogRef) {
            const message = resolveText(currentContext, undefined, effect.onSuccessLogRef);
            if (message) {
              result.save = appendCombatLog(result.save, message);
              currentContext = { ...currentContext, save: result.save };
            }
          }
          break;
        }
        if (effect.onFailureLogRef) {
          const message = resolveText(currentContext, undefined, effect.onFailureLogRef);
          if (message) {
            result.save = appendCombatLog(result.save, message);
            currentContext = { ...currentContext, save: result.save };
          }
        }
        break;
      }
      case "addCondition": {
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        const stacks = resolveNumber(currentContext, effect.stacks, effect.stacksRef);
        const durationTurns = resolveNumber(currentContext, effect.durationTurns, effect.durationTurnsRef);
        result.effects.push({
          op: "addCondition",
          actorId: actor.id,
          condition: effect.condition,
          stacks: stacks > 0 ? stacks : undefined,
          durationTurns: durationTurns > 0 ? durationTurns : undefined,
          source: effect.source,
        });
        break;
      }
      case "applyDirectDamage": {
        if (!currentContext.rng) break;
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        let damage = resolveNumber(currentContext, effect.amount, effect.amountRef);
        if (effect.rollMin && effect.rollMax) {
          damage += currentContext.rng.nextInt(effect.rollMin, effect.rollMax);
        }
        if (damage <= 0) break;
        const damageResult = applyDamageToActor(actor, damage, currentContext.save, currentContext.rng, currentContext.storyPack, currentContext.catalogs);
        result.save = {
          ...currentContext.save,
          actorsById: {
            ...currentContext.save.actorsById,
            [actor.id]: damageResult.updatedActor,
          },
          runtime: {
            ...currentContext.save.runtime,
            rngCounter: currentContext.rng.getCounter(),
          },
        };
        if (effect.trackSelfDamage && !damageResult.dieHardUsed) {
          result.save = trackCombatSelfDamage(result.save, actor.id, damage);
        }
        currentContext = { ...currentContext, save: result.save };
        if (damageResult.effects.length > 0) {
          result.effects.push(...damageResult.effects);
        }
        if (damageResult.actorDied) {
          result.actorDied = true;
        }
        if (effect.logMessageRef) {
          const message = resolveText(currentContext, undefined, effect.logMessageRef);
          if (message) {
            result.save = appendCombatLog(result.save, message);
            currentContext = { ...currentContext, save: result.save };
          }
        }
        break;
      }
      case "checkAndDamage": {
        const rng = currentContext.rng;
        if (!rng) break;
        const actor = effect.actor === "attacker" ? currentContext.attacker : currentContext.defender;
        if (!actor) break;
        const baseTarget = getStatOrSkillValue(actor, effect.key, currentContext.save, currentContext.storyPack);
        const modifier = resolveNumber(currentContext, undefined, effect.modifierRef);
        let checkResult: CheckResult | null = null;
        if (currentContext.check) {
          const fateContext = createFateRerollContext();
          checkResult = rollD100CheckWithFate(
            `${currentContext.check.id}:hook:${effect.actor}:${effect.key}`,
            actor.id,
            baseTarget + modifier,
            currentContext.storyPack,
            currentContext.save,
            rng,
            fateContext
          );
          if (fateContext.used && fateContext.actorId) {
            const consumeResult = consumeFateProtection(currentContext.save, fateContext.actorId);
            result.save = consumeResult.save;
            currentContext = { ...currentContext, save: consumeResult.save };
          }
        } else {
          const checkId = resolveText(currentContext, undefined, effect.checkIdRef) ?? `hook:check:${actor.id}`;
          const check = {
            id: checkId,
            kind: "single",
            actorRef: { mode: "byId", actorId: actor.id },
            key: effect.key,
            difficulty: effect.difficulty ?? "Challenging",
            modifier: modifier !== 0 ? modifier : undefined,
          } as const;
          const outcome = performCheckWithSave(
            check,
            currentContext.storyPack,
            currentContext.save,
            rng,
            `res:${checkId}`,
          );
          checkResult = outcome.result;
          result.save = outcome.save;
          currentContext = { ...currentContext, save: outcome.save };
        }
        if (!checkResult) break;
        if (checkResult.success) {
          if (effect.onSuccessLogRef) {
            const message = resolveText(currentContext, undefined, effect.onSuccessLogRef);
            if (message) {
              result.save = appendCombatLog(result.save, message);
              currentContext = { ...currentContext, save: result.save };
            }
          }
          break;
        }

        if (effect.onFailureLogRef) {
          const message = resolveText(currentContext, undefined, effect.onFailureLogRef);
          if (message) {
            result.save = appendCombatLog(result.save, message);
            currentContext = { ...currentContext, save: result.save };
          }
        }

        let damage = resolveNumber(currentContext, effect.damageBase, effect.damageBaseRef);
        if (effect.damageRollMin && effect.damageRollMax) {
          damage += rng.nextInt(effect.damageRollMin, effect.damageRollMax);
        }
        if (effect.addDof) {
          damage += checkResult.dof;
        }
        if (damage > 0) {
          const damageResult = applyDamageToActor(actor, damage, currentContext.save, rng, currentContext.storyPack, currentContext.catalogs);
          result.save = {
            ...currentContext.save,
            actorsById: {
              ...currentContext.save.actorsById,
              [actor.id]: damageResult.updatedActor,
            },
            runtime: {
              ...currentContext.save.runtime,
              rngCounter: rng.getCounter(),
            },
          };
          currentContext = { ...currentContext, save: result.save };
          if (damageResult.effects.length > 0) {
            result.effects.push(...damageResult.effects);
          }
          if (damageResult.actorDied) {
            result.actorDied = true;
          }
          if (effect.damageLogRef) {
            const message = resolveText(currentContext, undefined, effect.damageLogRef);
            if (message) {
              result.save = appendCombatLog(result.save, `${message}${damage}`);
              currentContext = { ...currentContext, save: result.save };
            }
          }
          if (effect.runtimeLogMessageRef) {
            const message = resolveText(currentContext, undefined, effect.runtimeLogMessageRef);
            if (message) {
              const tags = [...(effect.runtimeLogTags ?? [])];
              const extraTag = resolveText(currentContext, undefined, effect.runtimeLogTagRef);
              if (extraTag) tags.push(extraTag);
              if (effect.includeDamageTag) tags.push(`damage=${damage}`);
              result.save = appendRuntimeLog(result.save, {
                kind: "system",
                message: `${message}${damage}`,
                turnCounter: currentContext.turnCounter ?? result.save.runtime.combat?.turnCounter ?? 0,
                tags: tags.length > 0 ? tags : undefined,
              });
              currentContext = { ...currentContext, save: result.save };
            }
          }
        }
        break;
      }
    }
  }
  return currentContext;
}

function resolveEffectPlaceholders(effect: Effect, context: HookContext): Effect {
  const replacement = (value: string | undefined): string | undefined => {
    if (value === "$attacker") return context.attacker?.id;
    if (value === "$defender") return context.defender?.id;
    return value;
  };

  if ("actorId" in effect && typeof effect.actorId === "string") {
    return { ...effect, actorId: replacement(effect.actorId) ?? effect.actorId } as Effect;
  }
  if ("attackerId" in effect || "defenderId" in effect) {
    const next = { ...effect } as any;
    if (typeof next.attackerId === "string") {
      next.attackerId = replacement(next.attackerId) ?? next.attackerId;
    }
    if (typeof next.defenderId === "string") {
      next.defenderId = replacement(next.defenderId) ?? next.defenderId;
    }
    return next as Effect;
  }
  return effect;
}

export function runHooks(type: HookType, context: HookContext): HookRunResult {
  const hooks = collectHooks(context)
    .filter((hook) => hook.type === type)
    .filter((hook) => hookWhenMatches(hook, context))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0) || a.id.localeCompare(b.id));

  const result: HookRunResult = {
    save: context.save,
    checkResult: undefined,
    rollMode: undefined,
    checkTargetMod: 0,
    damageMod: 0,
    damageMultiplier: 1,
    damageExtraDice: 0,
    damageRollMode: undefined,
    damageRerollOnes: false,
    allowDamageReroll: false,
    damageRerollThreshold: undefined,
    soakMod: 0,
    soakMultiplier: 1,
    penetrationMod: 0,
    penetrationMultiplier: 1,
    touBonusMod: 0,
    finalDamageMod: 0,
    finalDamageMultiplier: 1,
    tags: [],
    effects: [],
    logs: [],
    actorDied: false,
    turnStateOverride: undefined,
  };

  let currentContext = context;
  for (const hook of hooks) {
    currentContext = applyHookEffects(hook, result, currentContext);
  }

  if (type === "pre-check" && result.blocked && !result.checkResult && context.check && context.attacker) {
    const tag = result.blockReason ? `combat:blocked=${result.blockReason}` : "check:blocked";
    result.checkResult = {
      checkId: context.check.id,
      actorId: context.attacker.id,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none",
      tags: ["check:blocked", tag],
    };
  }

  return result;
}
