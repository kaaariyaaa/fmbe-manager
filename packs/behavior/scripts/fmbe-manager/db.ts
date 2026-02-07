import { world } from "@minecraft/server";
import { MinecraftDimensionTypes } from "@minecraft/vanilla-data";
import { now, parseTransformJson } from "./helpers.ts";
import { removeRecordScores, syncRecordScores } from "./scoreboard.ts";
import { type FmbeRecord } from "./types.ts";

const STORE_KEY = "fmbe:records";

let records = new Map<string, FmbeRecord>();
let loaded = false;

function ensureLoaded(): void {
  if (loaded) return;

  const raw = world.getDynamicProperty(STORE_KEY);
  if (typeof raw !== "string" || raw.length === 0) {
    records = new Map<string, FmbeRecord>();
    loaded = true;
    return;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;
    records = new Map<string, FmbeRecord>();
    for (const [id, value] of Object.entries(parsed)) {
      const row = toRecord({ ...value, id });
      records.set(id, row);
    }
  } catch {
    records = new Map<string, FmbeRecord>();
  }

  loaded = true;
}

function save(): void {
  const snapshot: Record<string, FmbeRecord> = {};
  for (const [id, record] of records) {
    snapshot[id] = record;
  }
  world.setDynamicProperty(STORE_KEY, JSON.stringify(snapshot));
}

function toRecord(row: Record<string, unknown>): FmbeRecord {
  return {
    id: String(row.id ?? ""),
    preset: String(row.preset ?? "item") as FmbeRecord["preset"],
    blockTypeId: row.blockTypeId == null ? null : String(row.blockTypeId),
    itemTypeId: row.itemTypeId == null ? null : String(row.itemTypeId),
    dimensionId: String(row.dimensionId ?? MinecraftDimensionTypes.Overworld),
    x: Number(row.x ?? 0),
    y: Number(row.y ?? 0),
    z: Number(row.z ?? 0),
    transform: parseTransformJson(row.transformJson),
    updatedAt: Number(row.updatedAt ?? now()),
  };
}

export function ensureSchema(): void {
  ensureLoaded();
}

export function upsertRecord(record: FmbeRecord): void {
  ensureLoaded();
  records.set(record.id, { ...record });
  save();
  syncRecordScores(record);
}

export function getRecordById(id: string): FmbeRecord | undefined {
  ensureLoaded();
  const row = records.get(id);
  return row ? { ...row } : undefined;
}

export function getAllRecords(): FmbeRecord[] {
  ensureLoaded();
  return [...records.values()]
    .map((row) => ({ ...row }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function removeRecordById(id: string): void {
  ensureLoaded();
  records.delete(id);
  save();
  removeRecordScores(id);
}
