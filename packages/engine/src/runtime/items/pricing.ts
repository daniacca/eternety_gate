import type { Armor, ItemDefinition, ItemRarity, Weapon } from "../types";

export function getBasePriceFromRarity(rarity: ItemRarity | undefined): number {
  switch (rarity) {
    case "Uncommon":
      return 10;
    case "Rare":
      return 100;
    case "Epic":
      return 500;
    case "Legendary":
      return 2000;
    case "Common":
    default:
      return 1;
  }
}

export function getAdjustedPrice(basePrice: number, overPrice?: number): number {
  return Math.max(0, basePrice + (overPrice ?? 0));
}

export function getItemPrice(definition: ItemDefinition | Weapon | Armor): number {
  const base = getBasePriceFromRarity(definition.rarity);
  return getAdjustedPrice(base, definition.overPrice);
}
