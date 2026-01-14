import type { GameSave, ActorId } from "@eg/engine";

/**
 * Formats an actor ID into a human-readable name.
 * Uses actor.name if available, otherwise falls back to the actorId.
 */
export function formatActorName(save: GameSave | undefined, actorId: ActorId): string {
  if (!save) {
    return actorId;
  }
  const actor = save.actorsById[actorId];
  if (!actor) {
    return actorId;
  }
  return actor.name || actorId;
}

/**
 * Formats a checkId into a human-readable title.
 * Parses known combat check patterns and formats them naturally.
 * Falls back to a generic formatting for unknown patterns.
 */
export function formatCheckTitle(checkId: string, save: GameSave | undefined): string {
  if (!checkId) {
    return "Unknown Check";
  }

  // Pattern: combat:requestAttack:{melee|ranged}:{attackerId}:{defenderId}[:allOut]
  const attackMatch = checkId.match(/^combat:requestAttack:(melee|ranged):([^:]+):([^:]+)(?::allOut)?$/);
  if (attackMatch) {
    const [, mode, attackerId, defenderId] = attackMatch;
    const attackerName = formatActorName(save, attackerId);
    const defenderName = formatActorName(save, defenderId);
    const modeLabel = mode === "melee" ? "Melee" : "Ranged";
    return `${modeLabel} attack: ${attackerName} → ${defenderName}`;
  }

  // Pattern: combat:requestAttack:{melee|ranged}:{attackerId}:{defenderId}[:allOut]:defense:{parry|dodge}
  const defenseMatch = checkId.match(/^combat:requestAttack:(melee|ranged):([^:]+):([^:]+)(?::allOut)?:defense:(parry|dodge)$/);
  if (defenseMatch) {
    const [, , attackerId, defenderId, defenseType] = defenseMatch;
    const defenderName = formatActorName(save, defenderId);
    const attackerName = formatActorName(save, attackerId);
    const defenseLabel = defenseType === "parry" ? "Parry" : "Dodge";
    return `${defenseLabel}: ${defenderName} vs ${attackerName}`;
  }

  // Pattern: combat:knockdown:{attackerId}:{defenderId}
  const knockdownMatch = checkId.match(/^combat:knockdown:([^:]+):([^:]+)$/);
  if (knockdownMatch) {
    const [, attackerId, defenderId] = knockdownMatch;
    const attackerName = formatActorName(save, attackerId);
    const defenderName = formatActorName(save, defenderId);
    return `Knockdown: ${attackerName} → ${defenderName}`;
  }

  // Pattern: combat:disarm:{attackerId}:{defenderId}
  const disarmMatch = checkId.match(/^combat:disarm:([^:]+):([^:]+)$/);
  if (disarmMatch) {
    const [, attackerId, defenderId] = disarmMatch;
    const attackerName = formatActorName(save, attackerId);
    const defenderName = formatActorName(save, defenderId);
    return `Disarm: ${attackerName} → ${defenderName}`;
  }

  // Fallback: generic formatting
  // Replace ":" with " · ", "_" with " ", and title-case segments
  const segments = checkId.split(":");
  const formattedSegments = segments.map((segment) => {
    // Replace underscores with spaces
    const spaced = segment.replace(/_/g, " ");
    // Title case: capitalize first letter, lowercase rest
    return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
  });
  return formattedSegments.join(" · ");
}

