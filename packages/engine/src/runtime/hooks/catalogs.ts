import type { HookDefinition } from "./types";
import hooksCatalog from "../../../../content/src/catalogs/hooks.json";

export function getGlobalHooks(): HookDefinition[] {
  return hooksCatalog as HookDefinition[];
}
