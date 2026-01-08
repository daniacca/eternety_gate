import type { Effect, GameSave } from "../types";

export function applyGoto(effect: Extract<Effect, { op: "goto" }>, save: GameSave): GameSave {
  const newSceneId = effect.sceneId;
  const newVisitedScenes = save.runtime.history.visitedScenes.includes(newSceneId)
    ? save.runtime.history.visitedScenes
    : [...save.runtime.history.visitedScenes, newSceneId];

  const isChangingScene = save.runtime.currentSceneId !== newSceneId;
  const combatNotActive = save.runtime.combat?.active !== true;

  // Clear lastCheck and combatEndedSceneId when changing scenes to avoid combat tags persisting
  const clearedLastCheck = isChangingScene ? undefined : save.runtime.lastCheck;
  const clearedCombatEndedSceneId = isChangingScene ? undefined : save.runtime.combatEndedSceneId;

  // Clear combat log state when changing scenes if combat is not active
  const clearedCombatLog = isChangingScene && combatNotActive ? [] : save.runtime.combatLog;
  const clearedCombatTurnStartIndex = isChangingScene && combatNotActive ? 0 : save.runtime.combatTurnStartIndex;
  const clearedCombatLogSceneId = isChangingScene && combatNotActive ? undefined : save.runtime.combatLogSceneId;

  return {
    ...save,
    runtime: {
      ...save.runtime,
      currentSceneId: newSceneId,
      lastCheck: clearedLastCheck,
      combatEndedSceneId: clearedCombatEndedSceneId,
      combatLog: clearedCombatLog,
      combatTurnStartIndex: clearedCombatTurnStartIndex,
      combatLogSceneId: clearedCombatLogSceneId,
      history: {
        ...save.runtime.history,
        visitedScenes: newVisitedScenes,
      },
    },
  };
}

