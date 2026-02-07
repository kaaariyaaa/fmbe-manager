import { world, type Entity } from "@minecraft/server";
import { type FmbeRecord, type StoredTransform } from "./types.ts";

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

export function syncEntityScores(entity: Entity, record: FmbeRecord): void {
  for (const [key, objectiveId] of Object.entries(SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    getObjective(objectiveId).setScore(entity, toScore(getTransformValue(record.transform, key)));
  }

  getObjective(LOCATION_OBJECTIVES.x).setScore(entity, toScore(record.x));
  getObjective(LOCATION_OBJECTIVES.y).setScore(entity, toScore(record.y));
  getObjective(LOCATION_OBJECTIVES.z).setScore(entity, toScore(record.z));
  getObjective(PRESET_OBJECTIVE).setScore(entity, PRESET_TO_SCORE[record.preset]);
}

export function removeEntityScores(entity: Entity): void {
  const allObjectives = [...Object.values(SCORE_OBJECTIVES), LOCATION_OBJECTIVES.x, LOCATION_OBJECTIVES.y, LOCATION_OBJECTIVES.z, PRESET_OBJECTIVE];
  for (const objectiveId of allObjectives) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) continue;
    objective.removeParticipant(entity);
  }
}

export function readRecordFromEntityScores(entity: Entity, record: FmbeRecord): { changed: boolean; record: FmbeRecord } {
  const next: FmbeRecord = {
    ...record,
    transform: { ...record.transform },
  };
  let changed = false;

  for (const [key, objectiveId] of Object.entries(SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    const objective = world.scoreboard.getObjective(objectiveId);
    if (!objective) continue;
    const score = objective.getScore(entity);
    if (score === undefined) continue;

    const value = fromScore(score);
    const prev = getTransformValue(next.transform, key);
    if (almostEqual(prev, value)) continue;

    next.transform[key] = value;
    changed = true;
  }

  const xScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.x)?.getScore(entity);
  if (xScore !== undefined) {
    const x = fromScore(xScore);
    if (!almostEqual(x, next.x)) {
      next.x = x;
      changed = true;
    }
  }

  const yScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.y)?.getScore(entity);
  if (yScore !== undefined) {
    const y = fromScore(yScore);
    if (!almostEqual(y, next.y)) {
      next.y = y;
      changed = true;
    }
  }

  const zScore = world.scoreboard.getObjective(LOCATION_OBJECTIVES.z)?.getScore(entity);
  if (zScore !== undefined) {
    const z = fromScore(zScore);
    if (!almostEqual(z, next.z)) {
      next.z = z;
      changed = true;
    }
  }

  const presetScore = world.scoreboard.getObjective(PRESET_OBJECTIVE)?.getScore(entity);
  if (presetScore !== undefined) {
    const preset = SCORE_TO_PRESET[presetScore];
    if (preset && preset !== next.preset) {
      next.preset = preset;
      changed = true;
    }
  }

  return { changed, record: next };
}
