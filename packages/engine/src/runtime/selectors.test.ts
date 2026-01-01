import { describe, it, expect } from "vitest";
import { getCurrentScene } from "./selectors";
import { makeTestSave } from "./test-helpers/makeTestSave";
import { makeTestStoryPack } from "./test-helpers/makeTestStoryPack";
import { makeTestActor } from "./test-helpers/makeTestActor";

describe("selectors", () => {
  describe("getCurrentScene", () => {
    it("should return the current scene", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Scene 1 text"],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = getCurrentScene(storyPack, save);

      expect(result.scene.id).toBe("scene1");
      expect(result.text).toEqual(["Scene 1 text"]);
    });

    it("should include base text", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Line 1", "Line 2"],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = getCurrentScene(storyPack, save);

      expect(result.text).toEqual(["Line 1", "Line 2"]);
    });

    it("should include conditional text blocks when conditions are met", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Base text"],
            textBlocks: [
              {
                conditions: { op: "flag", path: "showExtra", value: true },
                text: ["Extra text"],
              },
            ],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithFlag = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, showExtra: true },
        },
      };

      const result = getCurrentScene(storyPack, saveWithFlag);

      expect(result.text).toEqual(["Base text", "Extra text"]);
    });

    it("should exclude conditional text blocks when conditions are not met", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Base text"],
            textBlocks: [
              {
                conditions: { op: "flag", path: "showExtra", value: true },
                text: ["Extra text"],
              },
            ],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);

      const result = getCurrentScene(storyPack, save);

      expect(result.text).toEqual(["Base text"]);
    });

    it("should include multiple conditional text blocks when conditions are met", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Base text"],
            textBlocks: [
              {
                conditions: { op: "flag", path: "flag1", value: true },
                text: ["Text 1"],
              },
              {
                conditions: { op: "flag", path: "flag2", value: true },
                text: ["Text 2"],
              },
            ],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithFlags = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, flag1: true, flag2: true },
        },
      };

      const result = getCurrentScene(storyPack, saveWithFlags);

      expect(result.text).toEqual(["Base text", "Text 1", "Text 2"]);
    });

    it("should handle array conditions in text blocks", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Base text"],
            textBlocks: [
              {
                conditions: [
                  { op: "flag", path: "flag1", value: true },
                  { op: "flag", path: "flag2", value: true },
                ],
                text: ["Extra text"],
              },
            ],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithFlags = {
        ...save,
        state: {
          ...save.state,
          flags: { ...save.state.flags, flag1: true, flag2: false },
        },
      };

      const result = getCurrentScene(storyPack, saveWithFlags);

      // Array conditions use OR logic, so if flag1 is true, it should show
      expect(result.text).toEqual(["Base text", "Extra text"]);
    });

    it("should throw error if scene is not found", () => {
      const storyPack = makeTestStoryPack({
        startSceneId: "scene1",
        scenes: [
          {
            id: "scene1",
            type: "narration",
            title: "Scene 1",
            text: ["Scene 1 text"],
            choices: [],
          },
        ],
      });
      const actor = makeTestActor();
      const save = makeTestSave(storyPack, actor);
      const saveWithInvalidScene = {
        ...save,
        runtime: {
          ...save.runtime,
          currentSceneId: "nonexistent",
        },
      };

      expect(() => getCurrentScene(storyPack, saveWithInvalidScene)).toThrow("Scene not found: nonexistent");
    });
  });
});

