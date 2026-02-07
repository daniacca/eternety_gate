import type { ActorId, GameSave } from "../../types";
import { computeAliveParticipants } from "./computeAliveParticipants";

export function computeFinalAliveParticipants(save: GameSave, participants: ActorId[]): ActorId[] {
  return computeAliveParticipants(save, participants);
}
