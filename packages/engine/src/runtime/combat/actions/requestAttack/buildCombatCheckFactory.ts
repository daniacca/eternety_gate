import type { CombatAttackCheck, Effect } from "../../../types";

export function buildCombatCheckFactory(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  dualWieldPenalty: number,
  coverModifier: "NONE" | "LIGHT" | "HEAVY",
): (weaponId: string | null, suffix: string, defenderId?: string, defenseOverride?: CombatAttackCheck["defense"]) => CombatAttackCheck {
  const checkIdSuffix = effect.modifiers?.hitBonus === 20 ? ":allOut" : "";
  return (
    weaponId: string | null,
    suffix: string,
    defenderId: string = effect.defenderId,
    defenseOverride?: CombatAttackCheck["defense"],
  ): CombatAttackCheck => {
    const baseHitBonus = effect.modifiers?.hitBonus;
    const hitBonus = (baseHitBonus ?? 0) + dualWieldPenalty;
    const modifiers = {
      ...effect.modifiers,
      cover: coverModifier,
      ...(baseHitBonus !== undefined || hitBonus !== 0 ? { hitBonus } : {}),
    };
    const defense: CombatAttackCheck["defense"] =
      defenseOverride ??
      effect.defense ?? {
        allowParry: true,
        allowDodge: true,
        strategy: "autoBest",
      };
    return {
      id: `combat:requestAttack:${effect.mode.toLowerCase()}:${effect.attackerId}:${defenderId}${checkIdSuffix}${suffix}`,
      kind: "combatAttack",
      attacker: {
        actorRef: { mode: "byId", actorId: effect.attackerId },
        mode: effect.mode,
        weaponId: weaponId ?? null,
      },
      defender: {
        actorRef: { mode: "byId", actorId: defenderId },
      },
      defense,
      modifiers,
    };
  };
}
