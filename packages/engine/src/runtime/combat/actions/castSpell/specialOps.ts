import type { SpecialOpParams, SpecialOpResult } from "./types";
import { resolveCombatBlinkStep } from "./specialOps/resolveCombatBlinkStep";
import { resolveCombatControlMind } from "./specialOps/resolveCombatControlMind";
import { resolveCombatDaemonbane } from "./specialOps/resolveCombatDaemonbane";
import { resolveCombatDisarmAtRange } from "./specialOps/resolveCombatDisarmAtRange";
import { resolveCombatHaemorrhage } from "./specialOps/resolveCombatHaemorrhage";
import { resolveCombatInfernalGaze } from "./specialOps/resolveCombatInfernalGaze";
import { resolveCombatPurgeConditions } from "./specialOps/resolveCombatPurgeConditions";
import { resolveCombatSunburst } from "./specialOps/resolveCombatSunburst";
import { resolveCombatVisionOfTerror } from "./specialOps/resolveCombatVisionOfTerror";

type SpecialOpHandler = (params: SpecialOpParams) => SpecialOpResult | null;

export function handleSpecialOp(params: SpecialOpParams): SpecialOpResult {
  for (const handler of specialOpHandlers) {
    const result = handler(params);
    if (result) {
      return result;
    }
  }

  return { handled: false, save: params.save };
}

const specialOpHandlers: SpecialOpHandler[] = [
  resolveCombatPurgeConditions,
  resolveCombatHaemorrhage,
  resolveCombatControlMind,
  resolveCombatVisionOfTerror,
  resolveCombatSunburst,
  resolveCombatBlinkStep,
  resolveCombatDaemonbane,
  resolveCombatInfernalGaze,
  resolveCombatDisarmAtRange,
];
