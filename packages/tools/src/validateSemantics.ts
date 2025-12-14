// Minimal type definitions (avoid importing from @eg/engine to keep tools Node-only)
type StoryPack = {
  id: string;
  title: string;
  version: string;
  startSceneId: string;
  scenes: Array<{
    id: string;
    onEnter?: Array<{ op: string; sceneId?: string; [key: string]: any }>;
    checks?: Array<{ id: string; kind: string; [key: string]: any }>;
    choices: Array<{
      id: string;
      checks?: Array<{ id: string; kind: string; [key: string]: any }>;
      effects: Array<{ op: string; sceneId?: string; [key: string]: any }>;
    }>;
  }>;
  systems?: {
    checks?: {
      difficultyBands?: Record<string, number>;
    };
  };
};

export type ValidationIssue = {
  type: 'error' | 'warning';
  message: string;
  path?: string;
};

/**
 * Performs semantic validation on a story pack
 */
export function validateStoryPackSemantics(storyPack: StoryPack): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Check startSceneId exists
  if (!storyPack.scenes.some(s => s.id === storyPack.startSceneId)) {
    issues.push({
      type: 'error',
      message: `startSceneId "${storyPack.startSceneId}" does not exist in scenes`,
      path: 'startSceneId',
    });
  }

  // Check unique scene ids
  const sceneIds = new Set<string>();
  for (const scene of storyPack.scenes) {
    if (sceneIds.has(scene.id)) {
      issues.push({
        type: 'error',
        message: `Duplicate scene id: "${scene.id}"`,
        path: `scenes[].id`,
      });
    }
    sceneIds.add(scene.id);
  }

  // Get difficulty bands
  const difficultyBands = storyPack.systems?.checks?.difficultyBands || {};
  const validDifficulties = new Set(Object.keys(difficultyBands));

  // Check all goto targets exist
  for (const scene of storyPack.scenes) {
    // Check scene onEnter effects
    if (scene.onEnter) {
      validateEffects(scene.onEnter, scene.id, `scenes[${scene.id}].onEnter`, sceneIds, issues);
    }

    // Check scene checks
    if (scene.checks) {
      for (const check of scene.checks) {
        validateCheck(check, scene.id, 'scenes', validDifficulties, sceneIds, issues);
      }
    }

    // Check choices
    for (const choice of scene.choices) {
      // Check choice checks
      if (choice.checks) {
        for (const check of choice.checks) {
          validateCheck(check, scene.id, `scenes[].choices[${choice.id}]`, validDifficulties, sceneIds, issues);
        }
      }

      // Check choice effects
      validateEffects(choice.effects, scene.id, `scenes[${scene.id}].choices[${choice.id}].effects`, sceneIds, issues);
    }
  }

  return issues;
}

function validateCheck(
  check: any,
  sceneId: string,
  contextPath: string,
  validDifficulties: Set<string>,
  sceneIds: Set<string>,
  issues: ValidationIssue[]
): void {
  // Check difficulties
  if (check.kind === 'single' && check.difficulty) {
    if (!validDifficulties.has(check.difficulty)) {
      issues.push({
        type: 'error',
        message: `Difficulty "${check.difficulty}" does not exist in difficultyBands`,
        path: `${contextPath}.checks[${check.id}].difficulty`,
      });
    }
  }

  if (check.kind === 'multi' && check.options) {
    for (const option of check.options) {
      if (!validDifficulties.has(option.difficulty)) {
        issues.push({
          type: 'error',
          message: `Difficulty "${option.difficulty}" does not exist in difficultyBands`,
          path: `${contextPath}.checks[${check.id}].options[].difficulty`,
        });
      }
    }
  }

  if (check.kind === 'opposed') {
    if (check.attacker?.difficulty && !validDifficulties.has(check.attacker.difficulty)) {
      issues.push({
        type: 'error',
        message: `Difficulty "${check.attacker.difficulty}" does not exist in difficultyBands`,
        path: `${contextPath}.checks[${check.id}].attacker.difficulty`,
      });
    }
    if (check.defender?.difficulty && !validDifficulties.has(check.defender.difficulty)) {
      issues.push({
        type: 'error',
        message: `Difficulty "${check.defender.difficulty}" does not exist in difficultyBands`,
        path: `${contextPath}.checks[${check.id}].defender.difficulty`,
      });
    }
  }

  // Check magic checks
  if (check.kind === 'magicChannel') {
    if (typeof check.targetDoS !== 'number' || check.targetDoS < 1) {
      issues.push({
        type: 'error',
        message: `magicChannel check "${check.id}" must have targetDoS >= 1`,
        path: `${contextPath}.checks[${check.id}].targetDoS`,
      });
    }
  }

  if (check.kind === 'magicEffect') {
    if (typeof check.castingNumberDoS !== 'number' || check.castingNumberDoS < 1) {
      issues.push({
        type: 'error',
        message: `magicEffect check "${check.id}" must have castingNumberDoS >= 1`,
        path: `${contextPath}.checks[${check.id}].castingNumberDoS`,
      });
    }
  }

  // Check sequence checks recursively
  if (check.kind === 'sequence' && check.steps) {
    for (const step of check.steps) {
      validateCheck(step, sceneId, `${contextPath}.checks[${check.id}].steps[]`, validDifficulties, sceneIds, issues);
    }
  }

  // Check check effects for goto
  if (check.onSuccess) {
    validateEffects(check.onSuccess, sceneId, `${contextPath}.checks[${check.id}].onSuccess`, sceneIds, issues);
  }

  if (check.onFailure) {
    validateEffects(check.onFailure, sceneId, `${contextPath}.checks[${check.id}].onFailure`, sceneIds, issues);
  }
}

/**
 * Recursively validates effects for goto targets
 */
function validateEffects(
  effects: Array<{ op: string; sceneId?: string; cases?: Array<{ then: Array<{ op: string; sceneId?: string }> }>; [key: string]: any }>,
  sceneId: string,
  contextPath: string,
  sceneIds: Set<string>,
  issues: ValidationIssue[]
): void {
  for (const effect of effects) {
    if (effect.op === 'goto') {
      if (!sceneIds.has(effect.sceneId!)) {
        issues.push({
          type: 'error',
          message: `goto target "${effect.sceneId}" does not exist`,
          path: `${contextPath}[].goto.sceneId`,
        });
      }
    }

    // Check conditional effects recursively
    if (effect.op === 'conditionalEffects' && effect.cases) {
      for (let i = 0; i < effect.cases.length; i++) {
        const case_ = effect.cases[i];
        if (case_.then) {
          validateEffects(case_.then, sceneId, `${contextPath}[].conditionalEffects[${i}].then`, sceneIds, issues);
        }
      }
    }
  }
}

