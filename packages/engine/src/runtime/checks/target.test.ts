import { describe, it, expect } from "vitest";
import { resolveDifficulty } from "./target";
import type { StoryPack } from "../types";

describe("resolveDifficulty defaults", () => {
  it("uses default bands when storyPack is missing", () => {
    expect(resolveDifficulty("Easy", undefined)).toBe(30);
    expect(resolveDifficulty("Hard", undefined)).toBe(-20);
  });

  it("uses default bands when storyPack systems are missing", () => {
    const storyPack = {
      id: "test",
      title: "Test",
      version: "1.0.0",
      startSceneId: "scene",
      stateSchema: {},
      initialState: { flags: {}, counters: {} },
      scenes: [],
    } as StoryPack;

    expect(resolveDifficulty("Easy", storyPack)).toBe(30);
    expect(resolveDifficulty("Hellish", storyPack)).toBe(-60);
  });

  it("prefers storyPack bands when provided", () => {
    const storyPack = {
      id: "test",
      title: "Test",
      version: "1.0.0",
      startSceneId: "scene",
      stateSchema: {},
      initialState: { flags: {}, counters: {} },
      systems: {
        checks: {
          difficultyBands: {
            Easy: 99,
          },
          criticals: {
            autoSuccess: [1],
            autoFail: [100],
          },
        },
      },
      scenes: [],
    } as StoryPack;

    expect(resolveDifficulty("Easy", storyPack)).toBe(99);
  });
});
