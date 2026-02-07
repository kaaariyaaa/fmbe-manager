import { world } from "@minecraft/server";
import { startAutoRenderLoop } from "../lib/fmbe-lib/index.ts";
import { registerCommands } from "./commands.ts";
import { ensureSchema } from "./db.ts";
import { registerHitTracking } from "./events.ts";
import { ADDON_NAME } from "./helpers.ts";
import { registerRuntimeSync } from "./runtime.ts";

export function initializeFmbeManager(): void {
  ensureSchema();
  registerCommands();
  registerHitTracking();
  registerRuntimeSync();
  startAutoRenderLoop();
  world.sendMessage(`[${ADDON_NAME}] Initialized`);
}
