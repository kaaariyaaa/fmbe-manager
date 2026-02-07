import { world } from "@minecraft/server";
import { type StoredTransform, type FmbeRecord } from "./types.ts";

const SCALE = 1000;

const SCORE_OBJECTIVES: Record<keyof StoredTransform, string> = {
  xOffset: "fmbe_xof",
  yOffset: "fmbe_yof",
  zOffset: "fmbe_zof",
  xRot: "fmbe_xrot",
  yRot: "fmbe_yrot",
  zRot: "fmbe_zrot",
  scale: "fmbe_scl",
  extendScale: "fmbe_escl",
  extendXrot: "fmbe_exrt",
  extendYrot: "fmbe_eyrt",
  extendZrot: "fmbe_ezrt",
  xBasePos: "fmbe_xbas",
  yBasePos: "fmbe_ybas",
  zBasePos: "fmbe_zbas",
};

const LOCATION_OBJECTIVES = {
  x: "fmbe_locx",
  y: "fmbe_locy",
  z: "fmbe_locz",
} as const;

const PRESET_OBJECTIVE = "fmbe_prst";

const PRESET_TO_SCORE: Record<FmbeRecord["preset"], number> = {
  item: 0,
  block2d: 1,
  block3d: 2,
};

const SCORE_TO_PRESET: Record<number, FmbeRecord["preset"]> = {
  0: "item",
  1: "block2d",
  2: "block3d",
};

const DEFAULT_TRANSFORM_VALUES: Record<keyof StoredTransform, number> = {
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

function toScore(value: number): number {
  return Math.round(value * SCALE);
}

function fromScore(value: number): number {
  return value / SCALE;
}

function getObjective(objectiveId: string) {
  return world.scoreboard.getObjective(objectiveId) ?? world.scoreboard.addObjective(objectiveId, objectiveId);
}

function getTransformValue(transform: StoredTransform, key: keyof StoredTransform): number {
  return transform[key] ?? DEFAULT_TRANSFORM_VALUES[key];
}

function almostEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1 / SCALE;
}

export function syncRecordTransformScores(record: FmbeRecord): void {
  for (const [key, objectiveId] of Object.entries(SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    const objective = getObjective(objectiveId);
    objective.setScore(record.id, toScore(getTransformValue(record.transform, key)));
  }
}

export function syncRecordScores(record: FmbeRecord): void {
  syncRecordTransformScores(record);

  getObjective(LOCATION_OBJECTIVES.x).setScore(record.id, toScore(record.x));
  getObjective(LOCATION_OBJECTIVES.y).setScore(record.id, toScore(record.y));
  getObjective(LOCATION_OBJECTIVES.z).setScore(record.id, toScore(record.z));
  getObjective(PRESET_OBJECTIVE).setScore(record.id, PRESET_TO_SCORE[record.preset]);
}

export function removeRecordTransformScores(fmbeId: string): void {
  for (const objectiveId of Object.values(SCORE_OBJECTIVES)) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) continue;
    objective.removeParticipant(fmbeId);
  }
}

export function removeRecordScores(fmbeId: string): void {
  removeRecordTransformScores(fmbeId);

  const locationObjectives = [LOCATION_OBJECTIVES.x, LOCATION_OBJECTIVES.y, LOCATION_OBJECTIVES.z, PRESET_OBJECTIVE];
  for (const objectiveId of locationObjectives) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) continue;
    objective.removeParticipant(fmbeId);
  }
}

export function readTransformFromScores(fmbeId: string, current: StoredTransform): { changed: boolean; transform: StoredTransform } {
  const next: StoredTransform = { ...current };
  let changed = false;

  for (const [key, objectiveId] of Object.entries(SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) continue;

    const score = objective.getScore(fmbeId);
    if (score === undefined) continue;

    const value = fromScore(score);
    const prev = getTransformValue(next, key);
    if (almostEqual(prev, value)) continue;

    next[key] = value;
    changed = true;
  }

  return { changed, transform: next };
}

export function readRecordFromScores(record: FmbeRecord): { changed: boolean; record: FmbeRecord } {
  const transformResult = readTransformFromScores(record.id, record.transform);

  let changed = transformResult.changed;
  const next: FmbeRecord = {
    ...record,
    transform: transformResult.transform,
  };

  const xScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.x)?.getScore(record.id);
  if (xScore !== undefined) {
    const x = fromScore(xScore);
    if (!almostEqual(x, next.x)) {
      next.x = x;
      changed = true;
    }
  }

  const yScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.y)?.getScore(record.id);
  if (yScore !== undefined) {
    const y = fromScore(yScore);
    if (!almostEqual(y, next.y)) {
      next.y = y;
      changed = true;
    }
  }

  const zScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.z)?.getScore(record.id);
  if (zScore !== undefined) {
    const z = fromScore(zScore);
    if (!almostEqual(z, next.z)) {
      next.z = z;
      changed = true;
    }
  }

  const presetScore = world.scoreboard.getObjective(PRESET_OBJECTIVE)?.getScore(record.id);
  if (presetScore !== undefined) {
    const preset = SCORE_TO_PRESET[presetScore];
    if (preset && preset !== next.preset) {
      next.preset = preset;
      changed = true;
    }
  }

  return { changed, record: next };
}
