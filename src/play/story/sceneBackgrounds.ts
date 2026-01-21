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
