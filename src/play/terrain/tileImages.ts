/**
 * Tile image mappings for React Native
 * Maps tileId to require() statements for local image assets
 * Only includes files that exist in assets/tiles_simple/
 * 
 * Supports both single images (tileId) and variants (tileId_variantIndex)
 * Variants are selected deterministically based on position hash
 */
export const TILE_IMAGES: Record<string, any> = {
  // Training arena tiles
  gymFloor: require("../../../assets/tiles_simple/tile_dirt_106.png"),
  gymWall: require("../../../assets/tiles_simple/tile_stone_dark_117.png"),
  gymMat: require("../../../assets/tiles_simple/tile_stone_light_346.png"),
  gymRing: require("../../../assets/tiles_simple/tile_stone_119.png"),
  gymMarker: require("../../../assets/tiles_simple/tile_magic_187.png"),

  // Single image tiles - using tiles_simple pack
  plains: require("../../../assets/tiles_simple/tile_grass_14.png"),
  wall: require("../../../assets/tiles_simple/tile_stone_dark_117.png"),
  forestBroadleaf: require("../../../assets/tiles_simple/tile_moss_131.png"),
  mountain: require("../../../assets/tiles_simple/tile_stone_dark_117.png"),
  grass: require("../../../assets/tiles_simple/tile_grass_14.png"),
  forest: require("../../../assets/tiles_simple/tile_moss_131.png"),
  rock: require("../../../assets/tiles_simple/tile_stone_119.png"),
  water: require("../../../assets/tiles_simple/tile_water_101.png"),
  floor: require("../../../assets/tiles_simple/tile_dirt_106.png"),
  dirt: require("../../../assets/tiles_simple/tile_dirt_106.png"),
  hills: require("../../../assets/tiles_simple/tile_stone_119.png"),
  desert: require("../../../assets/tiles_simple/tile_sand_102.png"),
  snow: require("../../../assets/tiles_simple/tile_snow_100.png"),
  marsh: require("../../../assets/tiles_simple/tile_water_101.png"),
  
  // Variant examples (uncomment and add as needed):
  // plains_0: require("../../../assets/tiles_simple/tile_grass_14.png"),
  // plains_1: require("../../../assets/tiles_simple/tile_grass_156.png"),
  // grass_0: require("../../../assets/tiles_simple/tile_grass_14.png"),
  // grass_1: require("../../../assets/tiles_simple/tile_grass_156.png"),
};
