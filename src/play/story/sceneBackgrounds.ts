import type { ImageSourcePropType } from "react-native";
import type { Scene, StoryId } from "@eg/engine";

export type BackgroundSourceConfig = {
  mode: "asset" | "remote";
  remoteBaseUri?: string;
};

const brunholtBackgrounds: Record<string, ImageSourcePropType> = {
  S0_BRIEFING: require("../../../assets/oneshot_brunholt/S0_BRIEFING.png"),
  S1_ARRIVAL: require("../../../assets/oneshot_brunholt/S1_ARRIVAL.png"),
  S1A_FARMERS: require("../../../assets/oneshot_brunholt/S1A_FARMERS.png"),
  S1B_VILLAGE_EDGE: require("../../../assets/oneshot_brunholt/S1B_VILLAGE_EDGE.png"),
  S2_CLOSED_HOUSE: require("../../../assets/oneshot_brunholt/S2_CLOSED_HOUSE.png"),
  S2_CLOSED_HOUSE_INSIDE: require("../../../assets/oneshot_brunholt/S2_CLOSED_HOUSE_INSIDE.png"),
  S2_EIRIK_THREAD: require("../../../assets/oneshot_brunholt/S2_EIRIK_THREAD.png"),
  S2_GRANARY: require("../../../assets/oneshot_brunholt/S2_GRANARY.png"),
  S2_HARL: require("../../../assets/oneshot_brunholt/S2_HARL.png"),
  S2_NIGHTFALL: require("../../../assets/oneshot_brunholt/S2_NIGHTFALL.png"),
  S2_RETURN_SQUARE: require("../../../assets/oneshot_brunholt/S2_RETURN_SQUARE.png"),
  S2_WELL: require("../../../assets/oneshot_brunholt/S2_WELL.png"),
  S2_WOODS_PATH: require("../../../assets/oneshot_brunholt/S2_WOODS_PATH.png"),
  S3_WOODS_CREAK: require("../../../assets/oneshot_brunholt/S3_WOODS_CREAK.png"),
  S3_RESET: require("../../../assets/oneshot_brunholt/S3_RESET.png"),
  S4_INVESTIGATION_HUB: require("../../../assets/oneshot_brunholt/S4_INVESTIGATION_HUB.png"),
  S6_RITUAL_SITE: require("../../../assets/oneshot_brunholt/S6_RITUAL_SITE.png"),
  S6_SHRINE: require("../../../assets/oneshot_brunholt/S6_SHRINE.png"),
  S7_WITCH: require("../../../assets/oneshot_brunholt/S7_WITCH.png"),
  S8_THIRD_WAY: require("../../../assets/oneshot_brunholt/S8_THIRD_WAY.png"),
  END_BREAK: require("../../../assets/oneshot_brunholt/END_BREAK.png"),
  END_STABILIZE: require("../../../assets/oneshot_brunholt/END_STABILIZE.png"),
  END_THIRD_FAIL: require("../../../assets/oneshot_brunholt/END_THIRD_FAIL.png"),
  END_THIRD_SUCCESS: require("../../../assets/oneshot_brunholt/END_THIRD_SUCCESS.png"),
};

const storyBackgroundAssets: Record<StoryId, Record<string, ImageSourcePropType>> = {
  oneshot_brunholt: brunholtBackgrounds,
};

const fallbackBackground = require("../../../assets/fallback_background_scene.png");

export function resolveSceneBackground(
  storyId: StoryId,
  scene: Scene,
  config: BackgroundSourceConfig
): { source: ImageSourcePropType; label: string } {
  if (scene.backgroundImage?.kind === "remote") {
    return { source: { uri: scene.backgroundImage.uri }, label: "remote" };
  }

  const assetId =
    scene.backgroundImage?.kind === "storyAsset" && scene.backgroundImage.assetId
      ? scene.backgroundImage.assetId
      : scene.id;

  if (config.mode === "remote" && config.remoteBaseUri) {
    const ext =
      scene.backgroundImage?.kind === "storyAsset" && scene.backgroundImage.ext ? scene.backgroundImage.ext : "png";
    return { source: { uri: `${config.remoteBaseUri}/${storyId}/${assetId}.${ext}` }, label: "remote" };
  }

  const assetSource = storyBackgroundAssets[storyId]?.[assetId];
  if (assetSource) {
    return { source: assetSource, label: "asset" };
  }

  return { source: fallbackBackground, label: "fallback" };
}
