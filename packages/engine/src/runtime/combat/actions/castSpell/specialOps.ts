import type { SpecialOpParams, SpecialOpResult } from "./types";
import { resolveCombatBlinkStep } from "./specialOps/resolveCombatBlinkStep";
import { resolveCombatControlMind } from "./specialOps/resolveCombatControlMind";
import { resolveCombatDaemonbane } from "./specialOps/resolveCombatDaemonbane";
import { resolveCombatDisarmAtRange } from "./specialOps/resolveCombatDisarmAtRange";
import { resolveCombatHaemorrhage } from "./specialOps/resolveCombatHaemorrhage";
import { resolveCombatHellchain } from "./specialOps/resolveCombatHellchain";
import { resolveCombatInfernalGaze } from "./specialOps/resolveCombatInfernalGaze";
import { resolveCombatHolocaust } from "./specialOps/resolveCombatHolocaust";
import { resolveCombatPurgeConditions } from "./specialOps/resolveCombatPurgeConditions";
import { resolveCombatSoulRend } from "./specialOps/resolveCombatSoulRend";
import { resolveCombatSummonDaemon } from "./specialOps/resolveCombatSummonDaemon";
import { resolveCombatSummonDivine } from "./specialOps/resolveCombatSummonDivine";
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
  resolveCombatHolocaust,
  resolveCombatDaemonbane,
  resolveCombatSoulRend,
  resolveCombatInfernalGaze,
  resolveCombatDisarmAtRange,
  resolveCombatHellchain,
  resolveCombatSummonDivine,
  resolveCombatSummonDaemon,
];
