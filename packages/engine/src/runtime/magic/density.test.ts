import { describe, it, expect } from "vitest";
import { channelDoSToMc, getMagicDensity } from "./density";
import type { GameSave } from "../types";

describe("channelDoSToMc", () => {
  it("Normal: 3 DoS => 1 MC", () => {
    expect(channelDoSToMc(6, "normal")).toBe(2);
    expect(channelDoSToMc(5, "normal")).toBe(1);
  });
  it("Very Dense: 1 DoS => 1 MC", () => {
    expect(channelDoSToMc(4, "veryDense")).toBe(4);
  });
  it("Rarefied: 4 DoS => 1 MC", () => {
    expect(channelDoSToMc(8, "rarefied")).toBe(2);
  });
  it("Almost Null: 5 DoS => 1 MC", () => {
    expect(channelDoSToMc(5, "almostNull")).toBe(1);
  });
});

describe("getMagicDensity", () => {
  it("returns combat.magicDensity when set", () => {
    const save = {
      runtime: { combat: { magicDensity: "veryDense" as const } },
    } as unknown as GameSave;
    expect(getMagicDensity(save)).toBe("veryDense");
  });
  it("returns normal when combat has no magicDensity", () => {
    const save = { runtime: { combat: {} } } as unknown as GameSave;
    expect(getMagicDensity(save)).toBe("normal");
  });
});
