import type { Effect, GameSave } from "../types";

export function applyAddItem(effect: Extract<Effect, { op: "addItem" }>, save: GameSave): GameSave {
  const newInventory = {
    ...save.state.inventory,
    items: [...save.state.inventory.items, effect.itemId],
  };

  return {
    ...save,
    state: {
      ...save.state,
      inventory: newInventory,
    },
  };
}

export function applyRemoveItem(effect: Extract<Effect, { op: "removeItem" }>, save: GameSave): GameSave {
  const newInventory = {
    ...save.state.inventory,
    items: save.state.inventory.items.filter((id) => id !== effect.itemId),
  };

  return {
    ...save,
    state: {
      ...save.state,
      inventory: newInventory,
    },
  };
}

