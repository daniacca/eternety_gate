import type { GameSave, ActorId } from "../types";
import type { CharacterCatalogs } from "../../content/catalogs";
import type { NarrativeOp } from "./types";
import type { ConditionId } from "../types";
import { addConditionToActor, removeConditionFromActor } from "../conditions";
import { applyFatigue } from "../characters/fatigue";

/**
 * Context for narrative ops application
 */
export type NarrativeOpsContext = {
  dos: number;
  catalogs?: CharacterCatalogs;
};

/**
 * Resolves "@dos" or numeric values with optional scaling
 * 
 * For negative deltas (e.g., healing), max works as a floor:
 * - If scaled >= 0: scaled = Math.min(scaled, max)
 * - If scaled < 0:  scaled = Math.max(scaled, max)
 * 
 * This ensures `max: -10` means "do not go below -10" for healing deltas.
 */
function resolveScaledValue(
  value: number | "@dos",
  dos: number,
  scaleBy?: "dos",
  max?: number
): number {
  let resolved: number;
  
  if (value === "@dos") {
    resolved = dos;
  } else if (scaleBy === "dos") {
    // Scale by multiplying base with DoS (or adding DoS to base)
    resolved = value + dos;
  } else {
    resolved = value;
  }
  
  // Apply max cap based on sign of resolved value
  if (max !== undefined) {
    if (resolved >= 0) {
      // For positive values, max is a ceiling
      resolved = Math.min(resolved, max);
    } else {
      // For negative values, max is a floor (e.g., max: -10 means don't go below -10)
      resolved = Math.max(resolved, max);
    }
  }
  
  return resolved;
}

/**
 * Resolves actorId with "active" placeholder
 */
function resolveActorId(actorId: string | "active", save: GameSave): ActorId {
  if (actorId === "active") {
    return save.party.activeActorId;
  }
  return actorId as ActorId;
}

/**
 * Applies narrative operations deterministically to save state
 * 
 * Supports ops: setFlag, incFlag, modifyResource, addCondition, 
 * removeCondition, grantXP, addItem, removeItem
 */
export function applyNarrativeOps(
  save: GameSave,
  ops: NarrativeOp[],
  context: NarrativeOpsContext
): { save: GameSave; emittedLogs: string[] } {
  const { dos, catalogs } = context;
  let currentSave = save;
  const emittedLogs: string[] = [];

  for (const op of ops) {
    switch (op.op) {
      case "setFlag": {
        currentSave = {
          ...currentSave,
          state: {
            ...currentSave.state,
            flags: {
              ...currentSave.state.flags,
              [op.key]: op.value,
            },
          },
        };
        emittedLogs.push(`Flag ${op.key} = ${op.value}`);
        break;
      }

      case "incFlag": {
        const currentValue = currentSave.state.counters[op.key] ?? 0;
        const delta = resolveScaledValue(op.by, dos, op.scaleBy, op.max);
        currentSave = {
          ...currentSave,
          state: {
            ...currentSave.state,
            counters: {
              ...currentSave.state.counters,
              [op.key]: currentValue + delta,
            },
          },
        };
        emittedLogs.push(`Counter ${op.key} += ${delta}`);
        break;
      }

      case "addCondition": {
        const actorId = resolveActorId(op.actorId, currentSave);
        const actor = currentSave.actorsById[actorId];
        if (actor) {
          const stacks =
            typeof op.stacks === "number"
              ? op.stacks
              : op.stacks === "@dos"
                ? dos
                : 1;
          const updatedActor = addConditionToActor(
            actor,
            op.condition as ConditionId,
            stacks,
            op.durationTurns,
            "narrativeSpell"
          );
          currentSave = {
            ...currentSave,
            actorsById: {
              ...currentSave.actorsById,
              [actorId]: updatedActor,
            },
          };
          emittedLogs.push(
            `${actor.name} ottiene ${op.condition} (stacks: ${stacks})`
          );
        }
        break;
      }

      case "removeCondition": {
        const actorId = resolveActorId(op.actorId, currentSave);
        const actor = currentSave.actorsById[actorId];
        if (actor) {
          const updatedActor = removeConditionFromActor(
            actor,
            op.condition as ConditionId
          );
          currentSave = {
            ...currentSave,
            actorsById: {
              ...currentSave.actorsById,
              [actorId]: updatedActor,
            },
          };
          emittedLogs.push(`${actor.name} perde ${op.condition}`);
        }
        break;
      }

      case "modifyResource": {
        const actorId = resolveActorId(op.actorId, currentSave);
        const actor = currentSave.actorsById[actorId];
        if (actor) {
          const delta = resolveScaledValue(op.delta, dos, op.scaleBy, op.max);
          if (op.resource === "rf") {
            // Use applyFatigue for RF to handle thresholds properly
            currentSave = applyFatigue(currentSave, actorId, delta, catalogs);
            emittedLogs.push(`${actor.name} RF ${delta >= 0 ? "+" : ""}${delta}`);
          } else if (op.resource === "wounds") {
            const newWounds = Math.max(
              0,
              (actor.resources.wounds ?? 0) + delta
            );
            currentSave = {
              ...currentSave,
              actorsById: {
                ...currentSave.actorsById,
                [actorId]: {
                  ...actor,
                  resources: {
                    ...actor.resources,
                    wounds: newWounds,
                  },
                },
              },
            };
            emittedLogs.push(
              `${actor.name} ferite ${delta >= 0 ? "+" : ""}${delta}`
            );
          } else if (op.resource === "criticalDamage") {
            const newCritDamage = Math.max(
              0,
              (actor.resources.criticalDamage ?? 0) + delta
            );
            currentSave = {
              ...currentSave,
              actorsById: {
                ...currentSave.actorsById,
                [actorId]: {
                  ...actor,
                  resources: {
                    ...actor.resources,
                    criticalDamage: newCritDamage,
                  },
                },
              },
            };
            emittedLogs.push(
              `${actor.name} danni critici ${delta >= 0 ? "+" : ""}${delta}`
            );
          }
        }
        break;
      }

      case "grantXP": {
        const amount = resolveScaledValue(op.amount, dos, op.scaleBy, op.max);
        const targetActorId = resolveActorId(op.actorId, currentSave);
        const targetActor = currentSave.actorsById[targetActorId];
        if (targetActor) {
          const currentXP = targetActor.resources.xp ?? 0;
          currentSave = {
            ...currentSave,
            actorsById: {
              ...currentSave.actorsById,
              [targetActorId]: {
                ...targetActor,
                resources: {
                  ...targetActor.resources,
                  xp: currentXP + amount,
                },
              },
            },
          };
          emittedLogs.push(`${targetActor.name} guadagna ${amount} XP`);
        }
        break;
      }

      case "addItem": {
        const actorId = resolveActorId(op.actorId, currentSave);
        const actor = currentSave.actorsById[actorId];
        if (actor) {
          const qty = op.qty ?? 1;
          const inventory = actor.inventory ?? [];
          // Add items to inventory
          const newItems = Array(qty).fill({ kind: "misc" as const, id: op.itemId });
          currentSave = {
            ...currentSave,
            actorsById: {
              ...currentSave.actorsById,
              [actorId]: {
                ...actor,
                inventory: [...inventory, ...newItems],
              },
            },
          };
          emittedLogs.push(`${actor.name} ottiene ${op.itemId} x${qty}`);
        }
        break;
      }

      case "removeItem": {
        const actorId = resolveActorId(op.actorId, currentSave);
        const actor = currentSave.actorsById[actorId];
        if (actor && actor.inventory) {
          const qty = op.qty ?? 1;
          let removed = 0;
          const newInventory = actor.inventory.filter((item) => {
            if (removed < qty && item.id === op.itemId) {
              removed++;
              return false;
            }
            return true;
          });
          currentSave = {
            ...currentSave,
            actorsById: {
              ...currentSave.actorsById,
              [actorId]: {
                ...actor,
                inventory: newInventory,
              },
            },
          };
          emittedLogs.push(`${actor.name} perde ${op.itemId} x${removed}`);
        }
        break;
      }
    }
  }

  return { save: currentSave, emittedLogs };
}
