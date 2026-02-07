import type { Actor, GameSave } from "../../types";
import type { CharacterCatalogs } from "../../../content/catalogs";
import { calculateInitialMovement } from "./calculateInitialMovement";

/**
 * Initializes turn state for an actor based on their AGI, size, and conditions
 *
 * @param actor - The actor
 * @param save - The game save
 * @param catalogs - Character catalogs (optional, required for catalog-based AGI bonuses)
 */
export function initializeTurnState(
  actor: Actor,
  save: GameSave,
  catalogs?: CharacterCatalogs,
): {
  moveRemaining: number;
  actionAvailable: boolean;
} {
  const initialMove = calculateInitialMovement(actor, save, catalogs);
  return {
    moveRemaining: initialMove,
    actionAvailable: true,
  };
}
