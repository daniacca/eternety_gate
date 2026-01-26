import { createNewGame, type Actor } from "@eg/engine";
import { sigilContentPack } from "@eg/content/src";
import { getStoryPackById } from "../../storypacks";

export const createDebugSave = () => {
  const storyPack = getStoryPackById("oneshot_brunholt");
  if (!storyPack) {
    throw new Error("Debug story pack not found.");
  }

  const actor: Actor = {
    id: "PC_1",
    name: "Debug Hero",
    kind: "PC",
    tags: ["debug"],
    stats: {
      STR: 50,
      TOU: 50,
      AGI: 50,
      INT: 50,
      WIL: 60,
      CHA: 45,
      WS: 55,
      BS: 55,
      INI: 50,
      PER: 50,
    },
    resources: {
      wounds: 0,
      rf: 0,
      fatePoints: 4,
      xp: 250,
      xpEarned: 250,
      xpSpent: 0,
      gold: 10,
      baseStats: {
        STR: 50,
        TOU: 50,
        AGI: 50,
        INT: 50,
        WIL: 60,
        CHA: 45,
        WS: 55,
        BS: 55,
        INI: 50,
        PER: 50,
      },
    },
    skills: {
      "skill:dodge": 2,
      "skill:parry": 1,
    },
    talents: {},
    traits: {
      "trait:weaver": true,
      "trait:size": { size: 4 },
    },
    spells: {
      "spell:flame_bolt": true,
      "spell:soothe_wounds": true,
    },
    equipment: {
      mainHand: { kind: "weapon", id: "longsword" },
      armor: { kind: "armor", id: "leather" },
    },
    inventory: [
      { kind: "weapon", id: "longbow" },
      { kind: "item", id: "ammo:arrow", qty: 10 },
      { kind: "item", id: "potion:healing", qty: 2 },
      { kind: "item", id: "potion:fatigue", qty: 1 },
    ],
    status: { conditions: [], tempModifiers: [] },
  };

  const party = {
    actors: [actor.id],
    activeActorId: actor.id,
  };

  return createNewGame(storyPack, 424242, party, { [actor.id]: actor }, sigilContentPack as any);
};
