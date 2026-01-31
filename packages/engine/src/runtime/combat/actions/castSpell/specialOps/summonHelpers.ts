import type { Actor, ActorId, GameSave, Position, StatKey } from "../../../../types";
import type { ContentPack } from "../../../../content/types";
import { canPlaceActorAt } from "../../../footprint";

const summonOffsets: Position[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export function buildSummonStats(params: {
  base: number;
  wil: number;
  wsBs: number;
  cha: number;
}): Record<StatKey, number> {
  const { base, wil, wsBs, cha } = params;
  return {
    STR: base,
    TOU: base,
    AGI: base,
    INT: base,
    WIL: wil,
    CHA: cha,
    WS: wsBs,
    BS: wsBs,
    INI: base,
    PER: base,
  };
}

export function findSummonPosition(params: {
  save: GameSave;
  casterId: ActorId;
  summonId: ActorId;
  contentPack?: ContentPack;
}): Position | null {
  const { save, casterId, summonId, contentPack } = params;
  const combat = save.runtime.combat;
  const casterPos = combat?.positions[casterId];
  if (!combat || !casterPos) {
    return null;
  }

  for (const offset of summonOffsets) {
    const candidate: Position = { x: casterPos.x + offset.x, y: casterPos.y + offset.y };
    if (canPlaceActorAt(save, summonId, candidate, contentPack, false)) {
      return candidate;
    }
  }

  return null;
}

export function buildSummonedBaseActor(params: {
  id: ActorId;
  name: string;
  stats: Record<StatKey, number>;
  traits: Record<string, any>;
  skills: Record<string, number>;
  talents: Record<string, number>;
  spells: Record<string, boolean>;
  equipment: Actor["equipment"];
}): Actor {
  const { id, name, stats, traits, skills, talents, spells, equipment } = params;
  return {
    id,
    name,
    kind: "NPC",
    stats,
    resources: {
      wounds: 0,
      rf: 0,
    },
    skills,
    talents,
    traits,
    spells,
    equipment,
    status: {
      conditions: [],
      tempModifiers: [],
    },
  };
}
