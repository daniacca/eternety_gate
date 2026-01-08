import { View, Text, StyleSheet } from "react-native";
import { getCurrentTurnActorId, type GameSave, calculateMaxHp, getCurrentHp, loadCharacterCatalogs } from "@eg/engine";
import { InitiativeOrderPanel } from "./InitiativeOrderPanel";
import sigilContent from "@eg/content/sigil.content.json";
import skillsCatalog from "@eg/content/src/catalogs/skills.json";
import talentsCatalog from "@eg/content/src/catalogs/talents.json";
import traitsCatalog from "@eg/content/src/catalogs/traits.json";

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

          // Get HP and critical damage for NPCs
          // Load catalogs for HP calculation (fallback to derived if not available)
          const catalogs = loadCharacterCatalogs({
            ...sigilContent,
            skills: skillsCatalog as any,
            talents: talentsCatalog as any,
            traits: traitsCatalog as any,
          } as any);
          const hpMax = actor ? calculateMaxHp(save, actor, catalogs) : (combat.initialHpByActorId?.[actorId] ?? 100);
          const hp = actor ? getCurrentHp(save, actor, catalogs) : 0;
          const criticalDamage = actor?.resources.criticalDamage ?? 0;
          const hasCriticalDamage = criticalDamage > 0;
          const criticalMax = 10; // Critical damage goes from 0 to 10
          const hpPercent = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
          const criticalPercent = hasCriticalDamage
            ? Math.max(0, Math.min(100, (criticalDamage / criticalMax) * 100))
            : 0;

          return (
            <View key={actorId}>
              {/* HP Bar (above token, only for NPCs) */}
              {!isPC && (
                <View
                  style={[
                    styles.barsContainer,
                    {
                      left: tokenX,
                      top: tokenY - 30, // Position above token
                    },
                  ]}
                >
                  <View style={styles.barRow}>
                    <View style={styles.healthBarBackground}>
                      <View
                        style={[
                          styles.healthBarFill,
                          {
                            width: `${hpPercent}%`,
                            backgroundColor: "#4CAF50", // Green
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barText}>
                      {hp}/{hpMax}
                    </Text>
                  </View>
                </View>
              )}

              {/* Token */}
              <View
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

              {/* Critical Damage Bar (below token, only for NPCs, only show if there's critical damage) */}
              {!isPC && (
                <View
                  style={[
                    styles.barsContainer,
                    {
                      left: tokenX,
                      top: tokenY + 20, // Position below token
                    },
                  ]}
                >
                  <View style={styles.barRow}>
                    <View style={styles.criticalBarBackground}>
                      <View
                        style={[
                          styles.criticalBarFill,
                          {
                            width: `${criticalPercent}%`,
                            backgroundColor: "#F44336", // Red
                          },
                        ]}
                      />
                    </View>
                    <Text style={styles.barText}>{criticalDamage.toFixed(0)}</Text>
                  </View>
                </View>
              )}
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

      {/* Initiative Order Panel - overlay in upper right */}
      {combat?.active && (
        <View style={styles.initiativeOverlay}>
          <InitiativeOrderPanel save={save} styles={styles} />
        </View>
      )}
    </View>
  );
}
