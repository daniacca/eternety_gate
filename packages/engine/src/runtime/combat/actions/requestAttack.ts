import type { Effect, GameSave, StoryPack, CombatAttackCheck, CheckResult } from "../../types";
import { IRNG } from "../../rng";
import { finalizeCombatIfEnded, getCurrentTurnActorId } from "../combat";
import { appendCombatLog, appendAttackNarration, nextRuntimeSeq } from "../narration";
import { performCheckWithSave, resolveActor } from "../../checks";
import { applyCombatDamageIfHit } from "../damage";
import { validateAndApplyRangedModifiers } from "../validation";
import { footprintDistanceBetweenActors, getActorSize, getFootprintRadius } from "../footprint";
import { distanceChebyshev } from "../movement";
import { loadCharacterCatalogs } from "../../../content/loadCatalogs";
import { getCellTerrain } from "../terrain";
import { computeTargetPreview } from "../targeting/computeTargeting";
import type { TargetSpec, TargetSelection, TargetPreview } from "../targeting/types";
import { getActorInventory, getInventoryItemQty, removeInventoryItemQty } from "../../characters/inventory";
import { getWeaponQualityRank, hasWeaponQuality } from "../../weaponQualities";
import { isUntouchable } from "../../characters/untouchable";
import { isActorAlive } from "../../characters/actors";
import {
  getNaturalWeaponProfile,
  getNaturalWeaponProfileFromActor,
  isNaturalWeaponId,
} from "../../characters/naturalWeapons";
import { getNaturalAbilityWeaponMap, getNaturalAbilityWeapons } from "../../characters/naturalAbilities";

const TALENT_TWO_WEAPON_WIELDER = "talent:two_weapon_wielder";
const TALENT_AMBIDEXTROUS = "talent:ambidextrous";
const TALENT_TWO_WEAPON_MASTER = "talent:two_weapon_master";

function getDualWieldPenalty(actor: GameSave["actorsById"][string]): number | null {
  if (!actor) return null;
  if ((actor.talents[TALENT_TWO_WEAPON_MASTER] ?? 0) > 0) return 0;
  if ((actor.talents[TALENT_AMBIDEXTROUS] ?? 0) > 0) return -10;
  if ((actor.talents[TALENT_TWO_WEAPON_WIELDER] ?? 0) > 0) return -20;
  return null;
}

function getEquippedWeaponIds(actor: GameSave["actorsById"][string]): { main?: string | null; off?: string | null } {
  if (!actor) return {};
  const main = actor.equipment?.mainHand?.kind === "weapon" ? actor.equipment.mainHand.id : null;
  const off = actor.equipment?.offHand?.kind === "weapon" ? actor.equipment.offHand.id : null;
  return { main, off };
}

function resolveAoERangeSquares(save: GameSave, weaponRange?: { short: number; long: number }): number {
  const combat = save.runtime.combat;
  if (weaponRange?.long) return weaponRange.long;
  if (!combat?.grid) return 0;
  return Math.max(combat.grid.width, combat.grid.height);
}

function resolveAoESelectionDistance(
  attackerPos: { x: number; y: number },
  selection?: TargetSelection,
): number | null {
  if (!selection) return null;
  if (selection.kind === "single") {
    return distanceChebyshev(attackerPos, selection.targetPos);
  }
  if (selection.kind === "radius") {
    return distanceChebyshev(attackerPos, selection.centerPos);
  }
  if (selection.kind === "line" && selection.startPos) {
    return distanceChebyshev(attackerPos, selection.startPos);
  }
  return null;
}

/**
 * Centralized attack resolution: the only place that resolves attacks end-to-end
 * Validates combat, turn, action availability, performs check, applies damage, handles KO
 */
export function combatRequestAttack(
  effect: Extract<Effect, { op: "combatRequestAttack" }>,
  storyPack: StoryPack,
  save: GameSave,
  rng: IRNG,
): { save: GameSave; emittedEffects?: Effect[] } {
  const combat = save.runtime.combat;
  if (!combat?.active) {
    return { save };
  }

  const turnActorId = getCurrentTurnActorId(save);
  if (!turnActorId || turnActorId !== effect.attackerId) {
    // Not attacker's turn
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=notYourTurn", `combat:turn=${turnActorId || "unknown"}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  if (!combat.turn.actionAvailable) {
    // Action already spent
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noAction"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate defender is alive
  const defenderActor = save.actorsById[effect.defenderId];
  if (!defenderActor || defenderActor.resources.isDead === true) {
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=targetDead", `combat:defenderId=${effect.defenderId}`],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Validate distance and range
  const attackerPos = combat.positions[effect.attackerId];
  const defenderPos = combat.positions[effect.defenderId];
  if (!attackerPos || !defenderPos) {
    const blockedCheck = {
      checkId: "combat:attack:blocked",
      actorId: effect.attackerId,
      roll: 0,
      target: 0,
      success: false,
      dos: 0,
      dof: 0,
      critical: "none" as const,
      tags: ["combat:blocked=noPosition"],
    };
    return {
      save: {
        ...save,
        runtime: {
          ...save.runtime,
          lastCheck: blockedCheck,
        },
      },
    };
  }

  // Use footprint-to-footprint distance instead of anchor-to-anchor
  const dist = footprintDistanceBetweenActors(save, effect.attackerId, effect.defenderId);

  // Range validation
  if (effect.mode === "MELEE") {
    if (dist > 1) {
      const blockedCheck = {
        checkId: "combat:attack:blocked",
        actorId: effect.attackerId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none" as const,
        tags: ["combat:blocked=notInMelee", `combat:dist=${dist}`],
      };
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  } else if (effect.mode === "RANGED") {
    // Validate ranged modifiers (this may return a blocked check)
    const attacker = resolveActor({ mode: "byId", actorId: effect.attackerId }, save);
    if (!attacker) {
      return { save };
    }
    // Note: validateAndApplyRangedModifiers expects a CombatAttackCheck, we'll build it below
  }

  const channelDoS = combat.channeling?.actorId === effect.attackerId ? combat.channeling.accumulatedDoS : 0;

  // Mutable save for further updates (ammo, action, etc.)
  let currentSave: GameSave = save;
  const attacker = currentSave.actorsById[effect.attackerId];
  if (!attacker) {
    return { save: currentSave };
  }

  const { main: mainWeaponId, off: offWeaponId } = getEquippedWeaponIds(attacker);
  const dualPenalty = getDualWieldPenalty(attacker);
  const hasDualWeapons = Boolean(mainWeaponId && offWeaponId);
  const canDualWield = hasDualWeapons && dualPenalty !== null;

  const resolveWeaponIds = (): Array<string | null> => {
    if (!canDualWield) {
      return [effect.weaponId ?? mainWeaponId ?? offWeaponId ?? null];
    }
    if (effect.mode === "RANGED") {
      return [mainWeaponId ?? null, offWeaponId ?? null].filter((id) => id !== null) as Array<string | null>;
    }
    return [mainWeaponId ?? null, offWeaponId ?? null].filter((id) => id !== null) as Array<string | null>;
  };

  let weaponIdsToUse = resolveWeaponIds();
  if (weaponIdsToUse.length === 0) {
    weaponIdsToUse = [null];
  }
  const dualWieldPenalty = canDualWield && weaponIdsToUse.length > 1 ? (dualPenalty ?? 0) : 0;

  // Include mode and special modifiers in checkId for better identification
  const checkIdSuffix = effect.modifiers?.hitBonus === 20 ? ":allOut" : "";

  // Apply cover penalty for ranged attacks
  let coverModifier: "NONE" | "LIGHT" | "HEAVY" = "NONE";
  if (effect.mode === "RANGED") {
    // Cover only applies to actors with 1x1 footprint (radius 0)
    // Larger actors (3x3 or 5x5 footprint) cannot benefit from cover due to their size
    const defenderActor = save.actorsById[effect.defenderId];
    const defenderSize = getActorSize(defenderActor);
    const defenderFootprintRadius = getFootprintRadius(defenderSize);
    const defenderIsFlyer = defenderActor?.traits?.["trait:flyer"] !== undefined;
    if (defenderIsFlyer) {
      coverModifier = "NONE";
    } else if (defenderFootprintRadius === 0) {
      const terrain = getCellTerrain(save, defenderPos);
      if (terrain.cover === "light") {
        coverModifier = "LIGHT";
      } else if (terrain.cover === "heavy") {
        coverModifier = "HEAVY";
      }
    }
  }

  const buildCombatCheck = (
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
      defense: defenseOverride ??
        effect.defense ?? {
          allowParry: true,
          allowDodge: true,
          strategy: "autoBest",
        },
      modifiers,
    };
  };

  // Load catalogs from storyPack (if available) or use empty catalogs
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

  const naturalAbilityWeapons = getNaturalAbilityWeapons(attacker);
  if (naturalAbilityWeapons.length > 0) {
    currentSave = {
      ...currentSave,
      weaponsById: {
        ...(currentSave.weaponsById || {}),
        ...getNaturalAbilityWeaponMap(attacker),
      },
    };
  }

  // If no equipped weapons and attacker has natural weapons, use them instead of unarmed
  if (effect.mode === "MELEE" && !mainWeaponId && !offWeaponId && weaponIdsToUse.length === 1) {
    const requestedWeaponId = weaponIdsToUse[0];
    const shouldUseNatural =
      !requestedWeaponId || isNaturalWeaponId(requestedWeaponId) || !currentSave.weaponsById?.[requestedWeaponId];
    if (shouldUseNatural) {
      const naturalWeapon = catalogs
        ? getNaturalWeaponProfile(currentSave, catalogs, effect.attackerId)
        : getNaturalWeaponProfileFromActor(attacker);
      if (naturalWeapon) {
        const weaponsById = {
          ...(currentSave.weaponsById || {}),
          [naturalWeapon.id]: naturalWeapon,
        };
        currentSave = {
          ...currentSave,
          weaponsById,
        };
        weaponIdsToUse = [naturalWeapon.id];
      }
    }
  }

  // If no equipped weapons and actor has natural abilities, use first matching ability
  if (!mainWeaponId && !offWeaponId && weaponIdsToUse.length === 1) {
    const requestedWeaponId = weaponIdsToUse[0];
    const hasRequested = requestedWeaponId && currentSave.weaponsById?.[requestedWeaponId];
    if (!hasRequested && naturalAbilityWeapons.length > 0) {
      const matching = naturalAbilityWeapons.find((weapon) => weapon.kind === effect.mode);
      if (matching) {
        weaponIdsToUse = [matching.id];
      }
    }
  }

  const primaryWeaponId = weaponIdsToUse[0] ?? null;
  const primaryCheck = buildCombatCheck(primaryWeaponId, "");

  const primaryWeapon =
    primaryWeaponId && primaryWeaponId !== "unarmed" ? currentSave.weaponsById?.[primaryWeaponId] : null;
  const primaryHasSpray = effect.mode === "RANGED" && hasWeaponQuality(primaryWeapon, "spray");
  const primaryBlastRank = effect.mode === "RANGED" ? getWeaponQualityRank(primaryWeapon, "blast") : null;
  const primaryHasBlast = primaryBlastRank !== null && primaryBlastRank > 0;
  const primaryUsesAoE = primaryHasSpray || primaryHasBlast;

  if (effect.mode === "RANGED" && !primaryUsesAoE) {
    const blockedCheck = validateAndApplyRangedModifiers(primaryCheck, save, dist, primaryCheck.id, effect.attackerId);
    if (blockedCheck) {
      return {
        save: {
          ...save,
          runtime: {
            ...save.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }
  }

  if (effect.mode === "RANGED") {
    const primaryWeapon =
      primaryWeaponId && primaryWeaponId !== "unarmed" ? currentSave.weaponsById?.[primaryWeaponId] : null;
    const isMagicFueled = hasWeaponQuality(primaryWeapon, "magic_fueled");
    if (isMagicFueled && isUntouchable(attacker)) {
      const blockedCheck = {
        checkId: "combat:attack:blocked",
        actorId: effect.attackerId,
        roll: 0,
        target: 0,
        success: false,
        dos: 0,
        dof: 0,
        critical: "none" as const,
        tags: ["combat:blocked=untouchable", "combat:blocked=magicFueled"],
      };
      return {
        save: {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            lastCheck: blockedCheck,
          },
        },
      };
    }

    if (primaryWeapon?.ammo && !isMagicFueled) {
      const inventory = getActorInventory(attacker);
      const availableAmmo = getInventoryItemQty(inventory, primaryWeapon.ammo.itemId);
      if (availableAmmo < primaryWeapon.ammo.consumedPerAttack) {
        const blockedCheck = {
          checkId: "combat:attack:blocked",
          actorId: effect.attackerId,
          roll: 0,
          target: 0,
          success: false,
          dos: 0,
          dof: 0,
          critical: "none" as const,
          tags: ["combat:blocked=noAmmo"],
        };
        const saveWithLog = appendCombatLog(currentSave, "No ammo.");
        return {
          save: {
            ...saveWithLog,
            runtime: {
              ...saveWithLog.runtime,
              lastCheck: blockedCheck,
            },
          },
        };
      }
    }
  }

  // Consume action (but NOT aim stance yet - it needs to be available during check calculation)
  // IMPORTANT: Include stancesByActorId so aim stance is available during check
  // Reset channeling (non-magic action)
  const combatWithActionConsumed = {
    ...combat,
    turn: {
      ...combat.turn,
      actionAvailable: false,
    },
    stancesByActorId: combat.stancesByActorId, // Keep aim stance for check calculation
    channeling: combat.channeling?.actorId === effect.attackerId ? undefined : combat.channeling,
  };

  currentSave = {
    ...currentSave,
    runtime: {
      ...currentSave.runtime,
      combat: combatWithActionConsumed,
    },
  };

  // Generate deterministic resolutionId for this attack resolution
  // This will correlate the attack check, defense check (if any), and damage entry
  const { save: saveWithSeq, seq } = nextRuntimeSeq(currentSave);
  const resolutionId = `res:${seq}`;
  currentSave = saveWithSeq;

  const emittedEffects: Effect[] = [];
  let aimConsumed = false;

  for (let index = 0; index < weaponIdsToUse.length; index++) {
    const weaponId = weaponIdsToUse[index] ?? null;
    const suffix = weaponIdsToUse.length > 1 ? `:twf${index + 1}` : "";
    const attackCheck = buildCombatCheck(weaponId, suffix);
    const weaponDef = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
    const hasSpray = effect.mode === "RANGED" && hasWeaponQuality(weaponDef, "spray");
    const blastRank = effect.mode === "RANGED" ? getWeaponQualityRank(weaponDef, "blast") : null;
    const hasBlast = blastRank !== null && blastRank > 0;
    const usesAoE = hasSpray || hasBlast;
    let targetPreview: TargetPreview | null = null;
    let aoeTargets: string[] = [];
    let aoeAttackDist = dist;

    if (effect.mode === "RANGED" && usesAoE) {
      const aoeTargetSelection = effect.targetSelection;
      if (!aoeTargetSelection) {
        const blockedCheck = {
          checkId: "combat:attack:blocked",
          actorId: effect.attackerId,
          roll: 0,
          target: 0,
          success: false,
          dos: 0,
          dof: 0,
          critical: "none" as const,
          tags: ["combat:blocked=missingTargetSelection"],
        };
        return {
          save: {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          },
        };
      }

      const rangeSquares = resolveAoERangeSquares(currentSave, weaponDef?.range);
      const aoeTargetSpec: TargetSpec = hasBlast
        ? { shape: { kind: "radius", range: rangeSquares, radius: blastRank as number }, requiresPoint: true }
        : { shape: { kind: "cone", range: rangeSquares, depth: 4 }, requiresDirection: true };

      targetPreview = computeTargetPreview(currentSave, effect.attackerId, aoeTargetSpec, aoeTargetSelection);
      if (!targetPreview.valid) {
        const blockedCheck = {
          checkId: "combat:attack:blocked",
          actorId: effect.attackerId,
          roll: 0,
          target: 0,
          success: false,
          dos: 0,
          dof: 0,
          critical: "none" as const,
          tags: ["combat:blocked=invalidTargeting", `combat:targeting=${targetPreview.reason ?? "invalid"}`],
        };
        return {
          save: {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              lastCheck: blockedCheck,
            },
          },
        };
      }

      const attackerPos = combat.positions[effect.attackerId];
      if (attackerPos && targetPreview.affectedCells.length > 0) {
        aoeAttackDist = Math.max(...targetPreview.affectedCells.map((cell) => distanceChebyshev(attackerPos, cell)));
      } else if (attackerPos) {
        const selectionDist = resolveAoESelectionDistance(attackerPos, aoeTargetSelection);
        if (selectionDist !== null) {
          aoeAttackDist = selectionDist;
        }
      }

      const blockedCheck = validateAndApplyRangedModifiers(
        attackCheck,
        currentSave,
        aoeAttackDist,
        attackCheck.id,
        effect.attackerId,
      );
      if (blockedCheck) {
        if (index === 0) {
          return {
            save: {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                lastCheck: blockedCheck,
              },
            },
          };
        }
        continue;
      }

      const partyIds = new Set(currentSave.party?.actors ?? []);
      const attackerIsParty = partyIds.has(effect.attackerId) || attacker.kind === "PC";
      aoeTargets = (targetPreview?.affectedActorIds ?? []).filter((actorId) => {
        const targetActor = currentSave.actorsById[actorId];
        if (!targetActor || !isActorAlive(targetActor)) return false;
        const targetIsParty = partyIds.has(actorId) || targetActor.kind === "PC";
        return attackerIsParty ? !targetIsParty : targetIsParty;
      });
    }

    if (effect.mode === "RANGED" && !usesAoE) {
      const blockedCheck = validateAndApplyRangedModifiers(
        attackCheck,
        currentSave,
        dist,
        attackCheck.id,
        effect.attackerId,
      );
      if (blockedCheck) {
        if (index === 0) {
          return {
            save: {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                lastCheck: blockedCheck,
              },
            },
          };
        }
        continue;
      }
    }

    if (effect.mode === "RANGED") {
      const currentAttacker = currentSave.actorsById[effect.attackerId];
      if (!currentAttacker) {
        return { save: currentSave };
      }
      const weapon = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
      const isMagicFueled = hasWeaponQuality(weapon, "magic_fueled");
      if (isMagicFueled && isUntouchable(currentAttacker)) {
        if (index === 0) {
          const blockedCheck = {
            checkId: "combat:attack:blocked",
            actorId: effect.attackerId,
            roll: 0,
            target: 0,
            success: false,
            dos: 0,
            dof: 0,
            critical: "none" as const,
            tags: ["combat:blocked=untouchable", "combat:blocked=magicFueled"],
          };
          return {
            save: {
              ...currentSave,
              runtime: {
                ...currentSave.runtime,
                lastCheck: blockedCheck,
              },
            },
          };
        }
        continue;
      }

      if (weapon?.ammo && !isMagicFueled) {
        const inventory = getActorInventory(currentAttacker);
        const availableAmmo = getInventoryItemQty(inventory, weapon.ammo.itemId);
        if (availableAmmo < weapon.ammo.consumedPerAttack) {
          if (index === 0) {
            const blockedCheck = {
              checkId: "combat:attack:blocked",
              actorId: effect.attackerId,
              roll: 0,
              target: 0,
              success: false,
              dos: 0,
              dof: 0,
              critical: "none" as const,
              tags: ["combat:blocked=noAmmo"],
            };
            const saveWithLog = appendCombatLog(currentSave, "No ammo.");
            return {
              save: {
                ...saveWithLog,
                runtime: {
                  ...saveWithLog.runtime,
                  lastCheck: blockedCheck,
                },
              },
            };
          }
          currentSave = appendCombatLog(currentSave, "No ammo.");
          continue;
        }

        const { updatedInventory } = removeInventoryItemQty(
          inventory,
          weapon.ammo.itemId,
          weapon.ammo.consumedPerAttack,
        );
        currentSave = {
          ...currentSave,
          actorsById: {
            ...currentSave.actorsById,
            [currentAttacker.id]: {
              ...currentAttacker,
              inventory: updatedInventory,
            },
          },
        };
      }
    }

    // Perform check (aim stance is still available here, so bonus will be applied)
    // performCheckWithSave handles all logging automatically (attack + defense if party members)
    const attackResolutionId = `${resolutionId}${suffix}`;
    const attackCheckForRoll = usesAoE
      ? buildCombatCheck(weaponId, `${suffix}:aoe`, aoeTargets[0] ?? effect.defenderId, {
          allowParry: false,
          allowDodge: false,
          strategy: "autoBest",
        })
      : attackCheck;
    const { result, save: afterCheckSave } = performCheckWithSave(
      attackCheckForRoll,
      storyPack,
      currentSave,
      rng,
      attackResolutionId,
    );
    if (!result) {
      continue;
    }

    // Use the updated save from performCheckWithSave (includes all check logs)
    currentSave = afterCheckSave;

    const isPlayerActor = currentSave.actorsById[effect.attackerId]?.kind === "PC";

    // NOW consume aim stance if this was a ranged attack (after check is performed)
    if (!aimConsumed && effect.mode === "RANGED") {
      let updatedStancesByActorId = currentSave.runtime.combat?.stancesByActorId;
      if (updatedStancesByActorId?.[effect.attackerId] === "aim") {
        updatedStancesByActorId = {
          ...updatedStancesByActorId,
        };
        delete updatedStancesByActorId[effect.attackerId];
        currentSave = {
          ...currentSave,
          runtime: {
            ...currentSave.runtime,
            combat: {
              ...currentSave.runtime.combat!,
              stancesByActorId: updatedStancesByActorId,
            },
          },
        };
      }
      aimConsumed = true;
    }

    // Update lastCheck and lastPlayerCheck (for UI)
    currentSave = {
      ...currentSave,
      runtime: {
        ...currentSave.runtime,
        lastCheck: result,
        lastPlayerCheck: isPlayerActor ? result : currentSave.runtime.lastPlayerCheck,
        rngCounter: rng.getCounter(),
      },
    };

    const weaponForQuality = weaponId && weaponId !== "unarmed" ? currentSave.weaponsById?.[weaponId] : null;
    const isMagicFueled = hasWeaponQuality(weaponForQuality, "magic_fueled");
    const magicFueledRank = getWeaponQualityRank(weaponForQuality, "magic_fueled") ?? 1;

    // Apply damage if hit (pass resolutionId to correlate with check)
    let damageResult = { save: currentSave, didApplyDamage: false, targetKo: false } as ReturnType<
      typeof applyCombatDamageIfHit
    >;
    const onDamageEffects: Effect[] = [];

    if (usesAoE) {
      if (targetPreview && targetPreview.affectedActorIds.length > 0) {
        const targetNames = aoeTargets.map((id) => currentSave.actorsById[id]?.name || id).join(", ");
        if (targetNames) {
          currentSave = appendCombatLog(currentSave, `Bersagli: ${targetNames}`);
        }
      }

      if (result.success && aoeTargets.length > 0) {
        for (const targetId of aoeTargets) {
          const aoeCheck: CombatAttackCheck = {
            ...attackCheckForRoll,
            defender: { actorRef: { mode: "byId", actorId: targetId } },
          };
          const targetResolutionId = `${attackResolutionId}:aoe:${targetId}`;
          damageResult = applyCombatDamageIfHit(
            aoeCheck,
            result,
            currentSave,
            rng,
            storyPack,
            targetResolutionId,
            catalogs,
            isMagicFueled,
          );
          currentSave = damageResult.save;
          if (damageResult.effects && damageResult.effects.length > 0) {
            onDamageEffects.push(...damageResult.effects);
          }

          if (damageResult.actorDied) {
            const deadActor = currentSave.actorsById[targetId];
            if (deadActor) {
              const pcDied = deadActor.kind === "PC";
              const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
              const allPartyDead =
                partyActors.length > 0 && partyActors.every((actor) => actor.resources.isDead === true);

              if (pcDied || allPartyDead) {
                currentSave = {
                  ...currentSave,
                  runtime: {
                    ...currentSave.runtime,
                    gameOver: {
                      reason: pcDied ? "playerDead" : "partyDead",
                      sceneId: currentSave.runtime.currentSceneId,
                    },
                    combat: undefined,
                  },
                };
                currentSave = appendCombatLog(currentSave, "Game Over.");
              }
            }
          }

          if (currentSave.runtime.gameOver) {
            break;
          }
        }
      }
    } else {
      damageResult = applyCombatDamageIfHit(
        attackCheck,
        result,
        currentSave,
        rng,
        storyPack,
        attackResolutionId,
        catalogs,
        isMagicFueled,
      );
      currentSave = damageResult.save;
      if (damageResult.effects && damageResult.effects.length > 0) {
        onDamageEffects.push(...damageResult.effects);
      }
    }

    if (isMagicFueled && result.success && !usesAoE) {
      const totalDoS = result.dos + channelDoS;
      const hits = Math.min(magicFueledRank, Math.max(1, totalDoS));
      if (hits > 1) {
        for (let hitNumber = 2; hitNumber <= hits; hitNumber++) {
          damageResult = applyCombatDamageIfHit(
            attackCheck,
            result,
            currentSave,
            rng,
            storyPack,
            attackResolutionId,
            catalogs,
            true,
          );
          currentSave = damageResult.save;
          if (damageResult.actorDied && currentSave.runtime.gameOver) {
            break;
          }
        }
        const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
        const defenderName = defender?.name || effect.defenderId;
        const hitsLogEntry =
          attacker?.kind === "PC"
            ? `Colpisci ${defenderName} ${hits} volte con l'energia magica!`
            : `${attacker?.name || effect.attackerId} colpisce ${defenderName} ${hits} volte con energia magica.`;
        currentSave = appendCombatLog(currentSave, hitsLogEntry);
      }
    }

    // Handle death and game over
    if (!usesAoE && damageResult.actorDied) {
      const deadActor = currentSave.actorsById[effect.defenderId];
      if (deadActor) {
        const pcDied = deadActor.kind === "PC";
        const partyActors = currentSave.party.actors.map((id) => currentSave.actorsById[id]).filter(Boolean);
        const allPartyDead = partyActors.length > 0 && partyActors.every((actor) => actor.resources.isDead === true);

        if (pcDied || allPartyDead) {
          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              gameOver: {
                reason: pcDied ? "playerDead" : "partyDead",
                sceneId: currentSave.runtime.currentSceneId,
              },
              combat: undefined,
            },
          };
          currentSave = appendCombatLog(currentSave, "Game Over.");
        }
      }
    }

    if (!usesAoE) {
      const defender = resolveActor({ mode: "byId", actorId: effect.defenderId }, currentSave);
      if (attacker && defender) {
        currentSave = appendAttackNarration(currentSave, attacker, defender, result);
      }
    }

    if (!usesAoE && damageResult.actorDied && currentSave.runtime.combat?.active) {
      const deadActor = currentSave.actorsById[effect.defenderId];
      if (deadActor && deadActor.resources.isDead === true) {
        const aliveParticipants = currentSave.runtime.combat.participants.filter((id) => {
          const actor = currentSave.actorsById[id];
          return actor && actor.resources.isDead !== true;
        });

        const partyIds = new Set(currentSave.party.actors);
        const enemyIds = aliveParticipants.filter((id) => !partyIds.has(id));

        const partyAlive = aliveParticipants.filter((id) => {
          const actor = currentSave.actorsById[id];
          return partyIds.has(id) && actor && actor.resources.isDead !== true;
        });

        const enemiesAlive = aliveParticipants.filter((id) => {
          const actor = currentSave.actorsById[id];
          return enemyIds.includes(id) && actor && actor.resources.isDead !== true;
        });

        if (enemiesAlive.length === 0 && partyAlive.length > 0) {
          const combatState = currentSave.runtime.combat;
          const endedSceneId = combatState?.startedBySceneId || currentSave.runtime.currentSceneId;
          currentSave = appendCombatLog(currentSave, "Tutti i nemici presenti nell'area sono stati sconfitti.");

          const last = currentSave.runtime.lastCheck;
          const endCheck: CheckResult = last
            ? {
                ...last,
                tags: [...last.tags, "combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
              }
            : {
                checkId: "combat:end",
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: true,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: ["combat:state=end", "combat:outcome=victory", `combat:winner=${partyAlive[0]}`],
              };

          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              combat: undefined,
              lastCheck: endCheck,
              combatEndedSceneId: endedSceneId,
            },
          };
        } else if (partyAlive.length === 0) {
          const combatState = currentSave.runtime.combat;
          const endedSceneId = combatState?.startedBySceneId || currentSave.runtime.currentSceneId;
          currentSave = appendCombatLog(currentSave, "Il party è stato annientato. Game over.");

          const last = currentSave.runtime.lastCheck;
          const endCheck: CheckResult = last
            ? {
                ...last,
                tags: [
                  ...last.tags,
                  "combat:state=end",
                  "combat:outcome=defeat",
                  ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
                ],
              }
            : {
                checkId: "combat:end",
                actorId: currentSave.party.activeActorId,
                roll: 0,
                target: 0,
                success: true,
                dos: 0,
                dof: 0,
                critical: "none",
                tags: [
                  "combat:state=end",
                  "combat:outcome=defeat",
                  ...(enemiesAlive.length > 0 ? [`combat:winner=${enemiesAlive[0]}`] : []),
                ],
              };

          currentSave = {
            ...currentSave,
            runtime: {
              ...currentSave.runtime,
              combat: undefined,
              lastCheck: endCheck,
              combatEndedSceneId: endedSceneId,
            },
          };
        }
      }
    }

    if (result.success) {
      if (effect.onSuccessEffects && effect.onSuccessEffects.length > 0) {
        emittedEffects.push(...effect.onSuccessEffects);
      }
      if (onDamageEffects.length > 0) {
        emittedEffects.push(...onDamageEffects);
      }
    } else {
      if (effect.onFailureEffects && effect.onFailureEffects.length > 0) {
        emittedEffects.push(...effect.onFailureEffects);
      }
    }

    if (currentSave.runtime.gameOver) {
      break;
    }

    if (usesAoE && currentSave.runtime.combat?.active) {
      currentSave = finalizeCombatIfEnded(currentSave);
    }
  }

  return { save: currentSave, emittedEffects: emittedEffects.length > 0 ? emittedEffects : undefined };
}
