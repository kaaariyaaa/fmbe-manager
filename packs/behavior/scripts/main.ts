import { world, system } from "@minecraft/server";
const addonName = "fmbe-manager";
let init = false;

system.runInterval(() => {
  if (!init) {
    world.sendMessage(`[${addonName}] Initialized`);
    init = true;
  }
});
