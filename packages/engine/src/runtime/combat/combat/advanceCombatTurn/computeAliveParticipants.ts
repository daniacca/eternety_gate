import type { ActorId, GameSave } from "../../types";
import { isActorAlive } from "../../../characters/actors";

export function computeAliveParticipants(save: GameSave, participants: ActorId[]): ActorId[] {
  return participants.filter((id) => {
    const actor = save.actorsById[id];
    return isActorAlive(actor);
  });
}
