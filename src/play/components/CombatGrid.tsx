import { View, Text, StyleSheet, Image, ScrollView, Pressable, Platform } from "react-native";
import { useMemo, useState } from "react";
import {
  getCurrentTurnActorId,
  type GameSave,
  type TargetPreview,
  type Position,
  calculateMaxHp,
  getCurrentHp,
  loadCharacterCatalogs,
  loadTerrainCatalogs,
  getActorFootprint,
  getActorSize,
  getFootprintRadius,
  getCellTerrain,
} from "@eg/engine";
import { InitiativeOrderPanel } from "./InitiativeOrderPanel";
import { sigilContentPack } from "@eg/content/src";
import { TILE_IMAGES } from "../terrain/tileImages";

interface CombatGridProps {
  containerWidth: number;
  containerHeight: number;
  combat: GameSave["runtime"]["combat"];
  save: GameSave;
  styles: any;
  targetingPreview?: TargetPreview | null;
  onCellPress?: (pos: Position) => void;
}

export function CombatGrid({
  containerWidth,
  containerHeight,
  combat,
  save,
  styles,
  targetingPreview,
  onCellPress,
}: CombatGridProps) {
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
  const selectableCells = targetingPreview?.selectableCells ?? [];
  const affectedCells = targetingPreview?.affectedCells ?? [];

  // Viewport size inside the right pane (leave some breathing room)
  const padding = 16;
  const availableWidth = Math.max(0, containerWidth - padding);
  const availableHeight = Math.max(0, containerHeight - padding);
  const isNarrowControls = availableWidth < 360;

  // Fit tile size (would fill the viewport); we cap the default to avoid huge/blurred tiles on small grids.
  const fitTileSize = Math.floor(Math.min(availableWidth / grid.width, availableHeight / grid.height));
  const minTileSize = 16;
  const maxTileSize = 96;
  const clamp = (n: number) => Math.max(minTileSize, Math.min(maxTileSize, n));
  const snap = (n: number) => {
    // Keep zoom steps predictable and often integer-multiples of 16 for pixel art.
    const step = 8;
    return Math.round(n / step) * step;
  };

  const defaultTileSize = useMemo(() => clamp(snap(Math.min(fitTileSize, 48))), [fitTileSize]);
  const [tileSize, setTileSize] = useState<number>(defaultTileSize);
  const [showDebug, setShowDebug] = useState<boolean>(false);

  // Cell size (square cells)
  const cellWidth = tileSize;
  const cellHeight = tileSize;

  // Map pixel dimensions
  // IMPORTANT: use a single coordinate system for all grid placement.
  // On React Native, mixing `tileSize` for left/top with `cellWidth/cellHeight` for width/height
  // can cause rounding/scaling misalignment. Keep everything in `cellWidth/cellHeight`.
  const mapWidth = cellWidth * grid.width;
  const mapHeight = cellHeight * grid.height;

  // Get PC and NPC positions for overlay (only alive actors)
  const pcPos = positions[save.party.activeActorId];
  const npcIds = combat.participants.filter((id) => {
    if (id === save.party.activeActorId) return false;
    const actor = save.actorsById[id];
    return actor && actor.resources.isDead !== true;
  });
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

  // Load terrain catalogs
  const terrainCatalogs = loadTerrainCatalogs(sigilContentPack);

  // Deterministic hash function for variant selection
  // Returns a stable hash value for the given string
  const hashString = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  };

  // Get tile image source with deterministic variant selection
  const getTileImageSource = (tileId: string, x: number, y: number): any => {
    const tileDef = terrainCatalogs.tilesById[tileId];
    if (!tileDef) {
      return null;
    }

    // If multiple variants exist, select deterministically based on position
    if (tileDef.images && tileDef.images.length > 0) {
      const key = `${tileId}:${x},${y}`;
      const hash = hashString(key);
      const variantIndex = hash % tileDef.images.length;
      
      // Look up variant in TILE_IMAGES (format: tileId_variantIndex)
      const variantKey = `${tileId}_${variantIndex}`;
      if (TILE_IMAGES[variantKey]) {
        return TILE_IMAGES[variantKey];
      }
      
      // Fallback: if variant not found, try single image
      if (TILE_IMAGES[tileId]) {
        return TILE_IMAGES[tileId];
      }
      
      return null; // Will fall back to background color
    }

    // Single image (legacy support)
    if (tileDef.image) {
      return TILE_IMAGES[tileId] || null;
    }

    return null;
  };

  return (
    <View style={styles.gameArea}>
      {/* Simple camera controls (no extra deps): zoom + reset/fit */}
      <View
        style={[
          localStyles.cameraControls,
          isNarrowControls ? localStyles.cameraControlsNarrow : null,
          { maxWidth: Math.max(0, availableWidth - 16) },
        ]}
      >
        <Pressable
          style={[localStyles.cameraButton, isNarrowControls ? localStyles.cameraButtonNarrow : null]}
          onPress={() => setTileSize((s) => clamp(snap(s - 8)))}
        >
          <Text style={localStyles.cameraButtonText}>−</Text>
        </Pressable>
        <Text style={[localStyles.cameraLabel, isNarrowControls ? localStyles.cameraLabelNarrow : null]}>{tileSize}px</Text>
        <Pressable
          style={[localStyles.cameraButton, isNarrowControls ? localStyles.cameraButtonNarrow : null]}
          onPress={() => setTileSize((s) => clamp(snap(s + 8)))}
        >
          <Text style={localStyles.cameraButtonText}>+</Text>
        </Pressable>
        <Pressable
          style={[
            localStyles.cameraButton,
            localStyles.cameraButtonSecondary,
            isNarrowControls ? localStyles.cameraButtonNarrow : null,
          ]}
          onPress={() => setTileSize(defaultTileSize)}
        >
          <Text style={[localStyles.cameraButtonText, localStyles.cameraButtonTextSecondary]}>Reset</Text>
        </Pressable>
        <Pressable
          style={[
            localStyles.cameraButton,
            localStyles.cameraButtonSecondary,
            isNarrowControls ? localStyles.cameraButtonNarrow : null,
          ]}
          onPress={() => setTileSize(clamp(snap(Math.min(fitTileSize, maxTileSize))))}
        >
          <Text style={[localStyles.cameraButtonText, localStyles.cameraButtonTextSecondary]}>Fit</Text>
        </Pressable>
        <Pressable
          style={[
            localStyles.cameraButton,
            localStyles.cameraButtonSecondary,
            isNarrowControls ? localStyles.cameraButtonNarrow : null,
            showDebug ? localStyles.cameraButtonActive : null,
          ]}
          onPress={() => setShowDebug((v) => !v)}
        >
          <Text style={[localStyles.cameraButtonText, localStyles.cameraButtonTextSecondary]}>
            {showDebug ? "Debug: On" : "Debug: Off"}
          </Text>
        </Pressable>
      </View>

      {/* Pan: nested scroll views for two-axis scrolling (works well on web; acceptable on native for now). */}
      <View style={[localStyles.viewport, { width: availableWidth, height: availableHeight }]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: mapWidth < availableWidth ? "center" : "flex-start",
          }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: mapHeight < availableHeight ? "center" : "flex-start",
            }}
          >
            <View style={[styles.gridContainer, { width: mapWidth, height: mapHeight }]}>
        {/* Grid background with subtle cell borders */}
        <View style={styles.gridBackground}>
          {/* Vertical lines - very subtle */}
          {Array.from({ length: grid.width + 1 }).map((_, col) => (
            <View
              key={`v-${col}`}
              style={[
                styles.gridLine,
                {
                  left: col * cellWidth,
                  width: 1,
                  height: mapHeight,
                  opacity: 0.1,
                },
              ]}
            />
          ))}
          {/* Horizontal lines - very subtle */}
          {Array.from({ length: grid.height + 1 }).map((_, row) => (
            <View
              key={`h-${row}`}
              style={[
                styles.gridLine,
                {
                  top: row * cellHeight,
                  width: mapWidth,
                  height: 1,
                  opacity: 0.1,
                },
              ]}
            />
          ))}
        </View>

        {/* Tile rendering - render below all overlays */}
        {Array.from({ length: grid.height }).map((_, row) =>
          Array.from({ length: grid.width }).map((_, col) => {
            const pos = { x: col, y: row };
            const terrain = getCellTerrain(save, pos, sigilContentPack);
            const tileImageSrc = getTileImageSource(terrain.tileId, col, row);

            // Map tile IDs to background colors as fallback
            const tileColors: Record<string, string> = {
              plains: "#90EE90",
              wall: "#696969",
              forestBroadleaf: "#228B22",
              mountain: "#808080",
              grass: "#7CFC00",
              forest: "#006400",
              rock: "#A9A9A9",
              water: "#4169E1",
              floor: "#D3D3D3",
              dirt: "#8B7355",
              hills: "#8B7355",
              desert: "#F4A460",
              snow: "#FFFAFA",
              marsh: "#556B2F",
            };

            return (
              <View
                key={`tile-${col}-${row}`}
                style={{
                  position: "absolute",
                  left: col * cellWidth,
                  top: row * cellHeight,
                  width: cellWidth,
                  height: cellHeight,
                  zIndex: 0,
                  backgroundColor: tileColors[terrain.tileId] || "#90EE90",
                }}
              >
                {tileImageSrc && (
                  <Image
                    source={tileImageSrc}
                    style={{
                      width: "100%",
                      height: "100%",
                      resizeMode: "stretch",
                      ...(Platform.OS === "web" ? ({ imageRendering: "pixelated" } as any) : null),
                    }}
                  />
                )}
              </View>
            );
          })
        )}

        {/* Debug overlays for walkable and cover */}
        {showDebug &&
          Array.from({ length: grid.height }).map((_, row) =>
            Array.from({ length: grid.width }).map((_, col) => {
              const pos = { x: col, y: row };
              const terrain = getCellTerrain(save, pos, sigilContentPack);

              return (
                <View
                  key={`debug-${col}-${row}`}
                  style={{
                    position: "absolute",
                    left: col * cellWidth,
                    top: row * cellHeight,
                    width: cellWidth,
                    height: cellHeight,
                    zIndex: 1,
                    pointerEvents: "none",
                  }}
                >
                  {/* Non-walkable overlay - subtle */}
                  {!terrain.walkable && (
                    <View
                      style={{
                        width: "100%",
                        height: "100%",
                        backgroundColor: "rgba(0, 0, 0, 0.2)",
                        borderWidth: 1,
                        borderColor: "rgba(255, 0, 0, 0.3)",
                      }}
                    />
                  )}
                  {/* Light cover overlay - subtle */}
                  {terrain.walkable && terrain.cover === "light" && (
                    <View
                      style={{
                        width: "100%",
                        height: "100%",
                        borderWidth: 1,
                        borderColor: "rgba(255, 255, 0, 0.3)",
                        backgroundColor: "rgba(255, 255, 0, 0.05)",
                      }}
                    />
                  )}
                  {/* Heavy cover overlay - subtle */}
                  {terrain.walkable && terrain.cover === "heavy" && (
                    <View
                      style={{
                        width: "100%",
                        height: "100%",
                        borderWidth: 1,
                        borderColor: "rgba(255, 165, 0, 0.4)",
                        backgroundColor: "rgba(255, 165, 0, 0.1)",
                      }}
                    />
                  )}
                </View>
              );
            })
          )}

        {/* Targeting overlays */}
        {targetingPreview &&
          selectableCells.map((cell, idx) => (
            <View
              key={`selectable-${idx}`}
              style={{
                position: "absolute",
                left: cell.x * cellWidth,
                top: cell.y * cellHeight,
                width: cellWidth,
                height: cellHeight,
                backgroundColor: "rgba(34, 197, 94, 0.35)",
                borderWidth: 1,
                borderColor: "rgba(34, 197, 94, 0.55)",
                zIndex: 5,
              }}
              pointerEvents="none"
            />
          ))}
        {targetingPreview &&
          affectedCells.map((cell, idx) => (
            <View
              key={`affected-${idx}`}
              style={{
                position: "absolute",
                left: cell.x * cellWidth,
                top: cell.y * cellHeight,
                width: cellWidth,
                height: cellHeight,
                backgroundColor: "rgba(239, 68, 68, 0.4)",
                borderWidth: 1,
                borderColor: "rgba(239, 68, 68, 0.7)",
                zIndex: 6,
              }}
              pointerEvents="none"
            />
          ))}

        {onCellPress &&
          Array.from({ length: grid.height }).map((_, row) =>
            Array.from({ length: grid.width }).map((_, col) => (
              <Pressable
                key={`cell-press-${col}-${row}`}
                style={{
                  position: "absolute",
                  left: col * cellWidth,
                  top: row * cellHeight,
                  width: cellWidth,
                  height: cellHeight,
                  zIndex: 15,
                }}
                onPress={() => onCellPress({ x: col, y: row })}
              />
            ))
          )}

        {/* Tokens (all actors, including dead ones) */}
        {combat.participants.map((actorId) => {
          const actor = save.actorsById[actorId];
          const pos = clampPosition(positions[actorId]);
          const isPC = actor?.kind === "PC";
          const isDead = actor?.resources.isDead === true;

          // Position token at cell center
          const tokenX = pos.x * cellWidth + cellWidth / 2;
          const tokenY = pos.y * cellHeight + cellHeight / 2;

          // Get HP and critical damage for NPCs
          // Load catalogs for HP calculation (fallback to derived if not available)
          const catalogs = loadCharacterCatalogs(sigilContentPack as any);
          const hpMax = actor ? calculateMaxHp(save, actor, catalogs) : combat.initialHpByActorId?.[actorId] ?? 100;
          const hp = actor ? getCurrentHp(save, actor, catalogs) : 0;
          const criticalDamage = actor?.resources.criticalDamage ?? 0;
          const hasCriticalDamage = criticalDamage > 0;
          const criticalMax = 10; // Critical damage goes from 0 to 10
          const hpPercent = hpMax > 0 ? Math.max(0, Math.min(100, (hp / hpMax) * 100)) : 0;
          const criticalPercent = hasCriticalDamage
            ? Math.max(0, Math.min(100, (criticalDamage / criticalMax) * 100))
            : 0;

          // Get actor size and footprint
          const actorSize = actor ? getActorSize(actor) : 4;
          const radius = getFootprintRadius(actorSize);
          const footprint = actor ? getActorFootprint(save, actorId) : [];
          
          // Adjust token size based on actor size (scale factor)
          // Size 1-5: normal size (1x), Size 6-8: 1.5x, Size 9-10: 2x
          const tokenSizeMultiplier = radius === 0 ? 1 : radius === 1 ? 1.5 : 2;
          const baseTokenSize = Math.max(18, Math.floor(tileSize * 0.7)); // keep readable at low zoom
          const tokenSize = baseTokenSize * tokenSizeMultiplier;

          // Bars should scale with zoom but stay compact at "standard" tile sizes.
          const clampRange = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
          const barHeight = clampRange(Math.round(tileSize * 0.14), 5, 8);
          const barWidth = clampRange(Math.round(tokenSize * 1.05), 44, 74);
          const barGap = clampRange(Math.round(tileSize * 0.12), 4, 8);
          const barFontSize = clampRange(Math.round(tileSize * 0.18), 9, 12);
          const barTop = tokenY - tokenSize / 2 - (barHeight + barGap);
          const barBottom = tokenY + tokenSize / 2 + barGap;
          const showHpText = tileSize >= 64; // keep the UI clean at normal zoom
          const showCritText = tileSize >= 72;

          return (
            <View key={actorId}>
              {/* Footprint overlay (for radius 1 or 2) */}
              {radius > 0 && !isDead && footprint.map((cell, idx) => {
                const cellX = cell.x * cellWidth;
                const cellY = cell.y * cellHeight;
                return (
                  <View
                    key={`footprint-${actorId}-${idx}`}
                    style={[
                      {
                        position: "absolute",
                        left: cellX,
                        top: cellY,
                        width: cellWidth,
                        height: cellHeight,
                        borderWidth: 1,
                        borderColor: isPC ? "rgba(0, 122, 255, 0.3)" : "rgba(220, 53, 69, 0.3)",
                        backgroundColor: isPC ? "rgba(0, 122, 255, 0.1)" : "rgba(220, 53, 69, 0.1)",
                        zIndex: 0,
                      },
                    ]}
                  />
                );
              })}

              {/* HP/Wounds bar (above token, for both PC & NPC, only if alive) */}
              {!isDead && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: tokenX,
                    top: barTop,
                    transform: [{ translateX: -barWidth / 2 }],
                    zIndex: 60,
                    ...(Platform.OS === "android" ? { elevation: 10 } : null),
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(0,0,0,0.65)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.22)",
                    }}
                  >
                    <View
                      style={{
                        width: barWidth,
                        height: barHeight,
                        backgroundColor: "rgba(255,255,255,0.22)",
                        borderRadius: 999,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${hpPercent}%`,
                          height: "100%",
                          backgroundColor: isPC ? "#22c55e" : "#4CAF50",
                        }}
                      />
                    </View>
                    {showHpText && (
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: barFontSize,
                          fontWeight: "700",
                          minWidth: 44,
                          textAlign: "right",
                          textShadowColor: "rgba(0,0,0,0.7)",
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}
                      >
                        {hp}/{hpMax}
                      </Text>
                    )}
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
                    width: tokenSize,
                    height: tokenSize,
                    borderRadius: tokenSize / 2,
                    backgroundColor: isDead ? "#666666" : isPC ? "#007AFF" : "#DC3545",
                    opacity: isDead ? 0.5 : 1,
                    zIndex: 20,
                    transform: [{ translateX: -tokenSize / 2 }, { translateY: -tokenSize / 2 }],
                  },
                ]}
              >
                <Text style={[styles.tokenText, { fontSize: Math.max(8, tokenSize * 0.35) }]} numberOfLines={1}>
                  {actorId}
                </Text>
              </View>
              {/* DEAD indicator (only for dead actors) */}
              {isDead && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: tokenX,
                    top: barBottom,
                    transform: [{ translateX: -24 }],
                    zIndex: 60,
                    ...(Platform.OS === "android" ? { elevation: 10 } : null),
                  }}
                >
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "rgba(0,0,0,0.7)",
                      borderWidth: 1,
                      borderColor: "rgba(255, 0, 0, 0.5)",
                    }}
                  >
                    <Text style={{ color: "#ff4d4d", fontWeight: "900", fontSize: Math.max(10, barFontSize) }}>
                      DEAD
                    </Text>
                  </View>
                </View>
              )}

              {/* Critical Damage Bar (below token, only for NPCs, only if alive and has critical damage) */}
              {!isPC && !isDead && hasCriticalDamage && (
                <View
                  pointerEvents="none"
                  style={{
                    position: "absolute",
                    left: tokenX,
                    top: barBottom,
                    transform: [{ translateX: -barWidth / 2 }],
                    zIndex: 60,
                    ...(Platform.OS === "android" ? { elevation: 10 } : null),
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 6,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: "rgba(0,0,0,0.65)",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.22)",
                    }}
                  >
                    <View
                      style={{
                        width: barWidth,
                        height: barHeight,
                        backgroundColor: "rgba(255,255,255,0.22)",
                        borderRadius: 999,
                        overflow: "hidden",
                      }}
                    >
                      <View
                        style={{
                          width: `${criticalPercent}%`,
                          height: "100%",
                          backgroundColor: "#F44336",
                        }}
                      />
                    </View>
                    {showCritText && (
                      <Text
                        style={{
                          color: "#fff",
                          fontSize: barFontSize,
                          fontWeight: "700",
                          minWidth: 26,
                          textAlign: "right",
                          textShadowColor: "rgba(0,0,0,0.7)",
                          textShadowOffset: { width: 0, height: 1 },
                          textShadowRadius: 2,
                        }}
                      >
                        {criticalDamage.toFixed(0)}
                      </Text>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        })}
            </View>
          </ScrollView>
        </ScrollView>
      </View>

      {/* Overlay text (debug) */}
      {showDebug && (
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
      )}

      {/* Initiative Order Panel - overlay in upper right */}
      {combat?.active && (
        <View style={styles.initiativeOverlay}>
          <InitiativeOrderPanel save={save} styles={styles} />
        </View>
      )}
    </View>
  );
}

const localStyles = StyleSheet.create({
  viewport: {
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "#fff",
  },
  cameraControls: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 50,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
  },
  cameraControlsNarrow: {
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  cameraButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: "#007AFF",
  },
  cameraButtonNarrow: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 7,
  },
  cameraButtonSecondary: {
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  cameraButtonActive: {
    borderColor: "#007AFF",
    backgroundColor: "#e8f2ff",
  },
  cameraButtonText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 14,
  },
  cameraButtonTextSecondary: {
    color: "#111827",
  },
  cameraLabel: {
    minWidth: 54,
    textAlign: "center",
    fontSize: 12,
    color: "#111827",
    fontFamily: Platform.OS === "web" ? ("monospace" as any) : undefined,
  },
  cameraLabelNarrow: {
    minWidth: 44,
    fontSize: 11,
  },
});
