import type { Actor } from "../../types";

export function getUnnaturalSenseRange(actor: Actor): number {
  const params = actor.traits?.["trait:unnatural_sense"];
  return typeof params === "object" && typeof params.x === "number" ? params.x : 0;
}

export function isActorBlind(actor: Actor): boolean {
  return actor.conditions?.blind !== undefined || actor.traits?.["trait:blind"] !== undefined;
}
