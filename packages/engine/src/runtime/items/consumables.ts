import type { GameSave, ActorId, ItemRef, StoryPack } from "../types";
import type { TargetSelection } from "../combat/targeting/types";
import type { IRNG } from "../rng";
import { getActorInventory, removeInventoryItemQty } from "../characters/inventory";
import { appendCombatLog, appendRuntimeLog } from "../combat/narration";
import { getCurrentTurnActorId } from "../combat/combat";
import { applyFatigue } from "../characters/fatigue";
import { combatCastSpell } from "../combat/actions";
import { runNarrativeSpell } from "../magic/castSpellNarrative";

export type UseItemContext = {
  storyPack?: StoryPack;
  rng: IRNG;
  targetSelection?: TargetSelection;
};

export type CanUseItemResult = {
  ok: boolean;
  reason?: string;
  actionId?: string;
};

export type UseItemResult = {
  save: GameSave;
  success: boolean;
  reason?: string;
};

function getItemCategory(item: GameSave["itemsById"][string] | undefined): "wearable" | "consumable" | undefined {
  return item?.kind ?? item?.type;
}

function removeOneItemFromInventory(save: GameSave, actorId: ActorId, itemId: string): GameSave {
  const actor = save.actorsById[actorId];
  if (!actor) return save;
  const inventory = getActorInventory(actor);
  const removal = removeInventoryItemQty(inventory, itemId, 1);
  if (removal.removedQty <= 0) return save;
  const updatedActor = {
    ...actor,
    inventory: removal.updatedInventory,
  };
  return {
    ...save,
    actorsById: {
      ...save.actorsById,
      [actorId]: updatedActor,
    },
  };
}

function consumeCombatAction(save: GameSave, actorId: ActorId): GameSave {
  const combat = save.runtime.combat;
  if (!combat?.active) return save;
  return {
    ...save,
    runtime: {
      ...save.runtime,
      combat: {
        ...combat,
        turn: {
          ...combat.turn,
          actionAvailable: false,
        },
        channeling: combat.channeling?.actorId === actorId ? undefined : combat.channeling,
      },
    },
  };
}

export function canUseItem(save: GameSave, actorId: ActorId, itemRef: ItemRef): CanUseItemResult {
  const actor = save.actorsById[actorId];
  if (!actor) return { ok: false, reason: "Actor not found." };
  if (itemRef.kind !== "item" && itemRef.kind !== "misc") {
    return { ok: false, reason: "Item is not consumable." };
  }
  const item = save.itemsById?.[itemRef.id];
  if (!item) return { ok: false, reason: "Item definition not found." };
  if (getItemCategory(item) !== "consumable" || !item.consumable?.actionId) {
    return { ok: false, reason: "Item is not consumable." };
  }

  const inventory = getActorInventory(actor);
  const hasItem = inventory.some((entry) => entry.kind === itemRef.kind && entry.id === itemRef.id);
  if (!hasItem) return { ok: false, reason: "Item not in inventory." };

  const combat = save.runtime.combat;
  if (combat?.active) {
    const turnActorId = getCurrentTurnActorId(save);
    if (!turnActorId || turnActorId !== actorId) {
      return { ok: false, reason: "Not your turn." };
    }
    if (!combat.turn.actionAvailable) {
      return { ok: false, reason: "Action already spent." };
    }
  }

  return { ok: true, actionId: item.consumable.actionId };
}

export function useItem(save: GameSave, actorId: ActorId, itemRef: ItemRef, context: UseItemContext): UseItemResult {
  const canUse = canUseItem(save, actorId, itemRef);
  if (!canUse.ok) {
    return { save, success: false, reason: canUse.reason };
  }

  const actor = save.actorsById[actorId];
  const item = save.itemsById?.[itemRef.id];
  const actionId = item?.consumable?.actionId;
  if (!actor || !item || !actionId) {
    return { save, success: false, reason: "Item cannot be used." };
  }

  let updatedSave = save;
  let success = false;

  if (actionId === "item:potion_heal") {
    const roll = context.rng.nextInt(1, 10);
    const healAmount = roll + 5;
    const woundsBefore = actor.resources.wounds ?? 0;
    const woundsAfter = Math.max(0, woundsBefore - healAmount);
    const actualHeal = woundsBefore - woundsAfter;
    const updatedActor = {
      ...actor,
      resources: {
        ...actor.resources,
        wounds: woundsAfter,
      },
    };
    updatedSave = {
      ...updatedSave,
      actorsById: {
        ...updatedSave.actorsById,
        [actorId]: updatedActor,
      },
    };
    if (updatedSave.runtime.combat?.active) {
      updatedSave = consumeCombatAction(updatedSave, actorId);
    }
    const message = actualHeal > 0 ? `Recuperi ${actualHeal} Ferite.` : "Non hai ferite da curare.";
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Pozione curativa: ${message}`,
      turnCounter: updatedSave.runtime.combat?.turnCounter,
      tags: [`item:use=${itemRef.id}`, "item:action=item:potion_heal"],
    });
    const combatLog = actor.kind === "PC" ? `Bevi una pozione curativa. ${message}` : `${actor.name} beve una pozione.`;
    updatedSave = appendCombatLog(updatedSave, combatLog);
    success = true;
  } else if (actionId === "item:potion_fatigue") {
    const roll = context.rng.nextInt(1, 5);
    const currentRf = actor.resources.rf ?? 0;
    const reduce = Math.min(currentRf, roll);
    updatedSave = applyFatigue(updatedSave, actorId, -reduce);
    const updatedActor = updatedSave.actorsById[actorId];
    if (updatedActor && (updatedActor.resources.rf ?? 0) < 0) {
      updatedSave = {
        ...updatedSave,
        actorsById: {
          ...updatedSave.actorsById,
          [actorId]: {
            ...updatedActor,
            resources: {
              ...updatedActor.resources,
              rf: 0,
            },
          },
        },
      };
    }
    if (updatedSave.runtime.combat?.active) {
      updatedSave = consumeCombatAction(updatedSave, actorId);
    }
    const message = reduce > 0 ? `Riduci RF di ${reduce}.` : "Non hai affaticamento da rimuovere.";
    updatedSave = appendRuntimeLog(updatedSave, {
      kind: "system",
      message: `Pozione anti-fatica: ${message}`,
      turnCounter: updatedSave.runtime.combat?.turnCounter,
      tags: [`item:use=${itemRef.id}`, "item:action=item:potion_fatigue"],
    });
    const combatLog =
      actor.kind === "PC" ? `Bevi una pozione anti-fatica. ${message}` : `${actor.name} beve una pozione.`;
    updatedSave = appendCombatLog(updatedSave, combatLog);
    success = true;
  } else if (actionId === "item:scroll_cast") {
    const spellId = item.consumable?.spellId;
    if (!spellId) {
      return { save, success: false, reason: "Scroll missing spellId." };
    }
    if (updatedSave.runtime.combat?.active) {
      if (!context.targetSelection) {
        return { save, success: false, reason: "Target selection required." };
      }
      const result = combatCastSpell(
        {
          op: "combatCastSpell",
          actorId,
          spellId,
          targetSelection: context.targetSelection,
          castOptions: {
            ignoreWeaverRequirement: true,
            skipRfCost: true,
            noOvercast: true,
          },
        },
        (context.storyPack ?? ({} as StoryPack)) as StoryPack,
        updatedSave,
        context.rng
      );
      updatedSave = result.save;
      const lastCheck = updatedSave.runtime.lastCheck;
      success = Boolean(lastCheck && lastCheck.tags?.includes(`magic:spell=${spellId}`) && lastCheck.success);
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: "Pergamena magica: lancio dell'incantesimo.",
        turnCounter: updatedSave.runtime.combat?.turnCounter,
        tags: [`item:use=${itemRef.id}`, "item:action=item:scroll_cast", `magic:spell=${spellId}`],
      });
      updatedSave = appendCombatLog(updatedSave, "Usi una pergamena magica.");
    } else {
      const { save: afterSpellSave, result } = runNarrativeSpell(
        updatedSave,
        {
          spellId,
          casterId: actorId,
          options: { skipRfCost: true },
        },
        context.rng
      );
      updatedSave = afterSpellSave;
      for (const log of result.logs) {
        updatedSave = appendCombatLog(updatedSave, log);
      }
      updatedSave = appendRuntimeLog(updatedSave, {
        kind: "system",
        message: "Pergamena magica: lancio dell'incantesimo.",
        tags: [`item:use=${itemRef.id}`, "item:action=item:scroll_cast", `magic:spell=${spellId}`],
      });
      success = result.success;
    }
  } else {
    return { save, success: false, reason: "Consumable action not supported." };
  }

  const consumeOnUse = item.consumable?.consumeOnUse === true;
  const shouldConsume = consumeOnUse && (success || actionId === "item:scroll_cast");
  if (shouldConsume) {
    updatedSave = removeOneItemFromInventory(updatedSave, actorId, itemRef.id);
  }

  return { save: updatedSave, success };
}
