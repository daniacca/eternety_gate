import { View, Text, StyleSheet } from "react-native";
import { getCurrentTurnActorId, type GameSave } from "@eg/engine";

interface CombatGridProps {
  containerWidth: number;
  containerHeight: number;
  combat: GameSave["runtime"]["combat"];
  save: GameSave;
  styles: any;
}

export function CombatGrid({ containerWidth, containerHeight, combat, save, styles }: CombatGridProps) {
  if (!combat?.active) {
    return (
      <View style={styles.gameArea}>
        <Text style={styles.gameAreaTitle}>Game Area</Text>
        <Text style={styles.gameAreaSubtitle}>No combat active</Text>
      </View>
    );
  }

  const { grid, positions, round } = combat;
  const currentTurnActorId = getCurrentTurnActorId(save);

  // Calculate grid size: smallest of width/height minus padding
  const padding = 32;
  const availableWidth = containerWidth - padding;
  const availableHeight = containerHeight - padding;
  const gridSize = Math.min(availableWidth, availableHeight);

  // Calculate cell size
  const cellWidth = gridSize / grid.width;
  const cellHeight = gridSize / grid.height;

  // Get PC and NPC positions for overlay
  const pcPos = positions[save.party.activeActorId];
  const npcIds = combat.participants.filter((id) => id !== save.party.activeActorId);
  const npcPos = npcIds.length > 0 ? positions[npcIds[0]] : null;

  // Calculate Chebyshev distance
  let distance: number | null = null;
  if (pcPos && npcPos) {
    const dx = Math.abs(pcPos.x - npcPos.x);
    const dy = Math.abs(pcPos.y - npcPos.y);
    distance = Math.max(dx, dy);
  }

  // Clamp position to grid bounds
  const clampPosition = (pos: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(grid.width - 1, pos.x)),
    y: Math.max(0, Math.min(grid.height - 1, pos.y)),
  });

  return (
    <View style={styles.gameArea}>
      <View style={[styles.gridContainer, { width: gridSize, height: gridSize }]}>
        {/* Grid background with cell borders - simplified approach */}
        <View style={styles.gridBackground}>
          {/* Vertical lines */}
          {Array.from({ length: grid.width + 1 }).map((_, col) => (
            <View
              key={`v-${col}`}
              style={[
                styles.gridLine,
                {
                  left: (col * gridSize) / grid.width,
                  width: 1,
                  height: gridSize,
                },
              ]}
            />
          ))}
          {/* Horizontal lines */}
          {Array.from({ length: grid.height + 1 }).map((_, row) => (
            <View
              key={`h-${row}`}
              style={[
                styles.gridLine,
                {
                  top: (row * gridSize) / grid.height,
                  width: gridSize,
                  height: 1,
                },
              ]}
            />
          ))}
        </View>

        {/* Tokens */}
        {combat.participants.map((actorId) => {
          const actor = save.actorsById[actorId];
          const pos = clampPosition(positions[actorId]);
          const isPC = actor?.kind === "PC";

          // Position token at cell center
          const tokenX = (pos.x / grid.width) * gridSize + cellWidth / 2;
          const tokenY = (pos.y / grid.height) * gridSize + cellHeight / 2;

          return (
            <View
              key={actorId}
              style={[
                styles.token,
                {
                  left: tokenX,
                  top: tokenY,
                  backgroundColor: isPC ? "#007AFF" : "#DC3545",
                },
              ]}
            >
              <Text style={styles.tokenText} numberOfLines={1}>
                {actorId}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Overlay text */}
      <View style={styles.gridOverlay}>
        <Text style={styles.overlayText}>Round: {round}</Text>
        <Text style={styles.overlayText}>Turn: {currentTurnActorId || "N/A"}</Text>
        {pcPos && (
          <Text style={styles.overlayText}>
            PC pos: ({pcPos.x}, {pcPos.y})
          </Text>
        )}
        {npcPos && (
          <Text style={styles.overlayText}>
            NPC pos: ({npcPos.x}, {npcPos.y})
          </Text>
        )}
        {distance !== null && <Text style={styles.overlayText}>distChebyshev = {distance}</Text>}
      </View>
    </View>
  );
}

