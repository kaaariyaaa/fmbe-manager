import { MinecraftDimensionTypes } from "@minecraft/vanilla-data";
import { WorldSqlDatabase } from "../lib/MCBEDatabase/lib/database.ts";
import { now, parseTransformJson } from "./helpers.ts";
import { removeRecordScores, syncRecordScores } from "./scoreboard.ts";
import { type FmbeRecord } from "./types.ts";

const DB = new WorldSqlDatabase({ prefix: "fmbe:db:main", autoload: true });

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
  DB.exec(
    "CREATE TABLE IF NOT EXISTS fmbe_entities (" +
      "id TEXT PRIMARY KEY, " +
      "preset TEXT NOT NULL, " +
      "blockTypeId TEXT, " +
      "itemTypeId TEXT, " +
      "dimensionId TEXT NOT NULL, " +
      "x REAL NOT NULL, " +
      "y REAL NOT NULL, " +
      "z REAL NOT NULL, " +
      "transformJson TEXT NOT NULL, " +
      "updatedAt INTEGER NOT NULL" +
      ")"
  );
}

export function upsertRecord(record: FmbeRecord): void {
  DB.exec(
    "INSERT OR REPLACE INTO fmbe_entities " +
      "(id, preset, blockTypeId, itemTypeId, dimensionId, x, y, z, transformJson, updatedAt) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [
      record.id,
      record.preset,
      record.blockTypeId,
      record.itemTypeId,
      record.dimensionId,
      record.x,
      record.y,
      record.z,
      JSON.stringify(record.transform),
      record.updatedAt,
    ]
  );
  syncRecordScores(record);
}

export function getRecordById(id: string): FmbeRecord | undefined {
  const rows = DB.query("SELECT * FROM fmbe_entities WHERE id = ?", [id]);
  if (rows.length === 0) return undefined;
  return toRecord(rows[0] as Record<string, unknown>);
}

export function getAllRecords(): FmbeRecord[] {
  const rows = DB.query("SELECT * FROM fmbe_entities ORDER BY id ASC");
  return rows.map((row) => toRecord(row as Record<string, unknown>));
}

export function removeRecordById(id: string): void {
  DB.exec("DELETE FROM fmbe_entities WHERE id = ?", [id]);
  removeRecordScores(id);
}
