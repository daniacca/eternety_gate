import type { GameSave } from "../../../types";

const TALENT_TWO_WEAPON_WIELDER = "talent:two_weapon_wielder";
const TALENT_AMBIDEXTROUS = "talent:ambidextrous";
const TALENT_TWO_WEAPON_MASTER = "talent:two_weapon_master";

export function getDualWieldPenalty(actor: GameSave["actorsById"][string]): number | null {
  if (!actor) return null;
  if ((actor.talents[TALENT_TWO_WEAPON_MASTER] ?? 0) > 0) return 0;
  if ((actor.talents[TALENT_AMBIDEXTROUS] ?? 0) > 0) return -10;
  if ((actor.talents[TALENT_TWO_WEAPON_WIELDER] ?? 0) > 0) return -20;
  return null;
}
