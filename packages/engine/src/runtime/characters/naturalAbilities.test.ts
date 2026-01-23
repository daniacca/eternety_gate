import { describe, it, expect } from "vitest";
import { getNaturalAbilityProfiles, getNaturalAbilityWeapons, getNaturalAbilityWeaponById } from "./naturalAbilities";
import { makeTestActor } from "../test-helpers/makeTestActor";

describe("naturalAbilities", () => {
  it("returns a weapon profile for a single natural ability", () => {
    const actor = makeTestActor({
      id: "NPC_1",
      traits: {
        "trait:natural_ability": {
          profile: {
            name: "Tail Lash",
            kind: "MELEE",
            damageType: "impact",
            damage: { tier: "single", add: 1 },
            penetration: 0,
            qualities: [{ id: "tearing" }],
          },
        },
      },
    });

    const profiles = getNaturalAbilityProfiles(actor);
    const weapons = getNaturalAbilityWeapons(actor);

    expect(profiles).toHaveLength(1);
    expect(weapons).toHaveLength(1);
    expect(weapons[0].name).toBe("Tail Lash");
    expect(weapons[0].kind).toBe("MELEE");
    expect(weapons[0].damageType).toBe("impact");
    expect(weapons[0].qualities).toEqual([{ id: "tearing" }]);
  });

  it("supports multiple natural ability profiles", () => {
    const actor = makeTestActor({
      id: "NPC_1",
      traits: {
        "trait:natural_ability": {
          profiles: [
            {
              name: "Horn Charge",
              kind: "MELEE",
              damageType: "rendering",
              damage: { tier: "double", add: 0 },
              penetration: 2,
            },
            {
              name: "Venom Spit",
              kind: "RANGED",
              damageType: "piercing",
              damage: { tier: "single", add: 0 },
              penetration: 1,
              range: { short: 3, long: 6 },
              qualities: [{ id: "spray" }],
            },
          ],
        },
      },
    });

    const weapons = getNaturalAbilityWeapons(actor);
    expect(weapons).toHaveLength(2);
    expect(weapons[1].kind).toBe("RANGED");
    expect(weapons[1].range).toEqual({ short: 3, long: 6 });
    expect(weapons[1].qualities).toEqual([{ id: "spray" }]);
  });

  it("can resolve natural ability weapon by id", () => {
    const actor = makeTestActor({
      id: "NPC_1",
      traits: {
        "trait:natural_ability": {
          profile: {
            name: "Fire Breath",
            kind: "RANGED",
            damageType: "energy",
            damage: { tier: "double", add: 0 },
            penetration: 3,
            range: { short: 4, long: 8 },
          },
        },
      },
    });

    const weapons = getNaturalAbilityWeapons(actor);
    const resolved = getNaturalAbilityWeaponById(actor, weapons[0].id);
    expect(resolved?.name).toBe("Fire Breath");
  });
});
