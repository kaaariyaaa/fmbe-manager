import { system, world } from "@minecraft/server";
import { getAllRecords, upsertRecord } from "./db.ts";
import { applyRecordToEntity, getAllManagedEntities } from "./entities.ts";
import { DP_ID, now } from "./helpers.ts";
import { readRecordFromScores, syncRecordScores } from "./scoreboard.ts";

function isSameLocation(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01;
}

export function registerRuntimeSync(): void {
  system.runInterval(() => {
    const records = getAllRecords();
    if (records.length === 0) return;

    const entityMap = new Map<string, ReturnType<typeof getAllManagedEntities>[number]>();
    for (const entity of getAllManagedEntities()) {
      const fmbeId = entity.getDynamicProperty(DP_ID);
      if (typeof fmbeId !== "string") continue;
      entityMap.set(fmbeId, entity);
    }

    for (const record of records) {
      const scoreUpdate = readRecordFromScores(record);
      const effectiveRecord = scoreUpdate.changed
        ? {
            ...scoreUpdate.record,
            updatedAt: now(),
          }
        : record;

      if (scoreUpdate.changed) {
        upsertRecord(effectiveRecord);
      } else {
        syncRecordScores(record);
      }

      const entity = entityMap.get(effectiveRecord.id);
      if (!entity) continue;

      if (entity.dimension.id !== effectiveRecord.dimensionId || !isSameLocation(entity.location, effectiveRecord)) {
        entity.teleport(
          { x: effectiveRecord.x, y: effectiveRecord.y, z: effectiveRecord.z },
          {
            dimension: world.getDimension(effectiveRecord.dimensionId),
          }
        );
      }

      applyRecordToEntity(entity, effectiveRecord);
    }
  }, 1);
}
