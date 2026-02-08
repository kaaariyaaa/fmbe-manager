import { world } from "@minecraft/server";
import { startAutoRenderLoop } from "../lib/fmbe-lib/index.ts";
import { registerCommands } from "./commands.ts";
import { ensureSchema } from "./db.ts";
import { registerHitTracking } from "./events.ts";
import { ADDON_NAME } from "./helpers.ts";
import { registerRuntimeSync } from "./runtime.ts";

let initialized = false;

export function initializeFmbeManager(): void {
  registerCommands();

  world.afterEvents.worldLoad.subscribe(() => {
    if (initialized) return;
    initialized = true;

    ensureSchema();
    registerHitTracking();
    registerRuntimeSync();
    startAutoRenderLoop();
    world.sendMessage(`§8[§b${ADDON_NAME}§8]§r §aInitialized`);
  });
}
