import { Player, world } from "@minecraft/server";
import { getRecordById } from "./db.ts";
import { isManagedEntity } from "./entities.ts";
import { formatRecord, DP_ID } from "./helpers.ts";
import { consumePendingGet, setLastHit } from "./state.ts";

export function registerHitTracking(): void {
  world.afterEvents.entityHitEntity.subscribe((event) => {
    if (!(event.damagingEntity instanceof Player)) return;
    if (!isManagedEntity(event.hitEntity)) return;

    const player = event.damagingEntity;
    setLastHit(player.id, event.hitEntity.id);

    if (!consumePendingGet(player.id)) return;

    const fmbeId = event.hitEntity.getDynamicProperty(DP_ID);
    if (typeof fmbeId !== "string") return;
    const row = getRecordById(fmbeId);
    if (!row) {
      player.sendMessage(`§8[§bFMBE§8]§r §cno DB row for ${fmbeId}`);
      return;
    }
    player.sendMessage(`§8[§bFMBE§8]§r §b${formatRecord(row)}`);
    player.sendMessage(`§8[§bFMBE§8]§r §7transform=${JSON.stringify(row.transform)}`);
  });
}
