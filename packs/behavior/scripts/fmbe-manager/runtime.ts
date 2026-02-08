import { system, world } from "@minecraft/server";
import { getAllRecords, getRecordById, upsertRecord } from "./db.ts";
import { applyRecordToEntity, getAllManagedEntities } from "./entities.ts";
import { DP_ID, now } from "./helpers.ts";
import {
  readGroupOperation,
  readGroupScores,
  readRecordFromEntityScores,
  syncEntityScores,
  syncGroupScores,
  type GroupOperation,
} from "./scoreboard.ts";
import { getGroupForRecord, getGroupMembers, listGroups, removeRecordFromGroups } from "./groups.ts";
import { type FmbeRecord } from "./types.ts";

const groupSnapshotCache = new Map<string, string>();
const groupOperationSeqCache = new Map<string, number>();

const defaultTransformValue: Record<Exclude<GroupOperation["target"], "x" | "y" | "z">, number> = {
  xOffset: 0,
  yOffset: 0,
  zOffset: 0,
  xRot: 0,
  yRot: 0,
  zRot: 0,
  scale: 1,
  extendScale: 1,
  extendXrot: -90,
  extendYrot: 0,
  extendZrot: 0,
  xBasePos: 0,
  yBasePos: 0,
  zBasePos: 0,
};

function isTransformTarget(target: GroupOperation["target"]): target is Exclude<GroupOperation["target"], "x" | "y" | "z"> {
  return target !== "x" && target !== "y" && target !== "z";
}

function applyOperation(current: number, operation: GroupOperation): number {
  switch (operation.type) {
    case "add":
      return current + operation.value;
    case "sub":
      return current - operation.value;
    case "mul":
      return current * operation.value;
    case "div":
      if (operation.value === 0) return current;
      return current / operation.value;
    default:
      return current;
  }
}

function applyGroupRelativeOperation(record: FmbeRecord, operation: GroupOperation): FmbeRecord {
  const next = {
    ...record,
    transform: { ...record.transform },
    updatedAt: now(),
  };

  switch (operation.target) {
    case "x":
      next.x = applyOperation(next.x, operation);
      break;
    case "y":
      next.y = applyOperation(next.y, operation);
      break;
    case "z":
      next.z = applyOperation(next.z, operation);
      break;
    default: {
      if (!isTransformTarget(operation.target)) return next;
      const key: Exclude<GroupOperation["target"], "x" | "y" | "z"> = operation.target;
      const transform = next.transform as Record<Exclude<GroupOperation["target"], "x" | "y" | "z">, number | undefined>;
      const current = transform[key] ?? defaultTransformValue[key];
      transform[key] = applyOperation(current, operation);
      break;
    }
  }

  return next;
}

function applyGroupRelativeOperations(entityMap: Map<string, ReturnType<typeof getAllManagedEntities>[number]>): void {
  const groups = listGroups();
  const groupSet = new Set(groups);

  for (const groupName of groups) {
    const operation = readGroupOperation(groupName);
    if (!operation) continue;

    const prevSeq = groupOperationSeqCache.get(groupName);
    if (prevSeq === undefined) {
      groupOperationSeqCache.set(groupName, operation.seq);
      continue;
    }
    if (prevSeq === operation.seq) continue;

    groupOperationSeqCache.set(groupName, operation.seq);

    const memberIds = getGroupMembers(groupName);
    for (const memberId of memberIds) {
      const current = getRecordById(memberId);
      if (!current) {
        removeRecordFromGroups(memberId);
        continue;
      }

      const next = applyGroupRelativeOperation(current, operation);
      upsertRecord(next);

      const entity = entityMap.get(memberId);
      if (entity) applyRecordToEntity(entity, next);
    }
  }

  for (const key of [...groupOperationSeqCache.keys()]) {
    if (!groupSet.has(key)) groupOperationSeqCache.delete(key);
  }
}

function snapshot(record: { preset: string; x: number; y: number; z: number; transform: unknown }): string {
  return JSON.stringify({
    preset: record.preset,
    x: record.x,
    y: record.y,
    z: record.z,
    transform: record.transform,
  });
}

function applyGroupScoreChanges(entityMap: Map<string, ReturnType<typeof getAllManagedEntities>[number]>): void {
  const groups = listGroups();
  const groupSet = new Set(groups);

  for (const groupName of groups) {
    const memberIds = getGroupMembers(groupName);
    const firstMember = memberIds.map((id) => getRecordById(id)).find((value) => value !== undefined);
    if (!firstMember) continue;

    const prev = groupSnapshotCache.get(groupName);
    if (!prev) {
      syncGroupScores(groupName, firstMember);
      groupSnapshotCache.set(groupName, snapshot(firstMember));
      continue;
    }

    const read = readGroupScores(groupName, firstMember);
    const nextSnapshot = snapshot(read.record);
    if (nextSnapshot === prev) continue;

    groupSnapshotCache.set(groupName, nextSnapshot);

    for (const memberId of memberIds) {
      const current = getRecordById(memberId);
      if (!current) {
        removeRecordFromGroups(memberId);
        continue;
      }

      const next = {
        ...current,
        preset: read.record.preset,
        x: read.record.x,
        y: read.record.y,
        z: read.record.z,
        transform: { ...read.record.transform },
        updatedAt: now(),
      };
      upsertRecord(next);

      const entity = entityMap.get(memberId);
      if (entity) applyRecordToEntity(entity, next);
    }
  }

  for (const cacheKey of [...groupSnapshotCache.keys()]) {
    if (!groupSet.has(cacheKey)) groupSnapshotCache.delete(cacheKey);
  }
}

function isSameLocation(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): boolean {
  return Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01 && Math.abs(a.z - b.z) < 0.01;
}

export function registerRuntimeSync(): void {
  system.runInterval(() => {
    const entityMap = new Map<string, ReturnType<typeof getAllManagedEntities>[number]>();
    for (const entity of getAllManagedEntities()) {
      const fmbeId = entity.getDynamicProperty(DP_ID);
      if (typeof fmbeId !== "string") continue;
      entityMap.set(fmbeId, entity);
    }

    applyGroupRelativeOperations(entityMap);
    applyGroupScoreChanges(entityMap);

    const records = getAllRecords();
    if (records.length === 0) return;

    for (const record of records) {
      const entity = entityMap.get(record.id);
      if (!entity) continue;

      if (getGroupForRecord(record.id)) {
        syncEntityScores(entity, record);
        if (entity.dimension.id !== record.dimensionId || !isSameLocation(entity.location, record)) {
          entity.teleport(
            { x: record.x, y: record.y, z: record.z },
            {
              dimension: world.getDimension(record.dimensionId),
            }
          );
        }
        applyRecordToEntity(entity, record);
        continue;
      }

      const scoreUpdate = readRecordFromEntityScores(entity, record);
      const effectiveRecord = scoreUpdate.changed
        ? {
            ...scoreUpdate.record,
            updatedAt: now(),
          }
        : record;

      if (scoreUpdate.changed) {
        upsertRecord(effectiveRecord);
      } else {
        syncEntityScores(entity, record);
      }

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
