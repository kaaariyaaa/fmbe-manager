import { world, type Entity } from "@minecraft/server";
import { type FmbeRecord, type StoredTransform } from "./types.ts";
import { normalizeTransform } from "./helpers.ts";

const SCALE = 1000;

const SCORE_OBJECTIVES: Record<keyof StoredTransform, string> = {
  xOffset: "fmbe:xOffset",
  yOffset: "fmbe:yOffset",
  zOffset: "fmbe:zOffset",
  xRot: "fmbe:xRot",
  yRot: "fmbe:yRot",
  zRot: "fmbe:zRot",
  scale: "fmbe:scl",
  extendScale: "fmbe:extendScale",
  extendXrot: "fmbe:extendXrot",
  extendYrot: "fmbe:extendYrot",
  extendZrot: "fmbe:extendZrot",
  xBasePos: "fmbe:xBasePos",
  yBasePos: "fmbe:yBasePos",
  zBasePos: "fmbe:zBasePos",
};

const LOCATION_OBJECTIVES = {
  x: "fmbe:locationX",
  y: "fmbe:locationY",
  z: "fmbe:locationZ",
} as const;

const PRESET_OBJECTIVE = "fmbe:preset";

const GROUP_SCORE_OBJECTIVES: Record<keyof StoredTransform, string> = {
  xOffset: "fmbe:group:xOffset",
  yOffset: "fmbe:group:yOffset",
  zOffset: "fmbe:group:zOffset",
  xRot: "fmbe:group:gxRot",
  yRot: "fmbe:group:gyRot",
  zRot: "fmbe:group:gzRot",
  scale: "fmbe:group:gscl",
  extendScale: "fmbe:group:gExtendScale",
  extendXrot: "fmbe:group:gExtendXrot",
  extendYrot: "fmbe:group:gExtendYrot",
  extendZrot: "fmbe:group:gExtendZrot",
  xBasePos: "fmbe:group:gxBasePos",
  yBasePos: "fmbe:group:gyBasePos",
  zBasePos: "fmbe:group:gzBasePos",
};

const GROUP_LOCATION_OBJECTIVES = {
  x: "fmbe:group:LocationX",
  y: "fmbe:group:LocationY",
  z: "fmbe:group:LocationZ",
} as const;

const GROUP_PRESET_OBJECTIVE = "fmbe:group:Preset";

const GROUP_OPERATION_OBJECTIVES = {
  seq: "fmbe:group:OpSeq",
  target: "fmbe:group:OpTarget",
  type: "fmbe:group:OpType",
  value: "fmbe:group:OpValue",
} as const;

export function ensureGroupOperationObjectives(): void {
  getObjective(GROUP_OPERATION_OBJECTIVES.seq);
  getObjective(GROUP_OPERATION_OBJECTIVES.target);
  getObjective(GROUP_OPERATION_OBJECTIVES.type);
  getObjective(GROUP_OPERATION_OBJECTIVES.value);
}

const GROUP_TARGET_MAP = {
  1: "xOffset",
  2: "yOffset",
  3: "zOffset",
  4: "xRot",
  5: "yRot",
  6: "zRot",
  7: "scale",
  8: "extendScale",
  9: "extendXrot",
  10: "extendYrot",
  11: "extendZrot",
  12: "xBasePos",
  13: "yBasePos",
  14: "zBasePos",
  15: "x",
  16: "y",
  17: "z",
} as const;

const GROUP_OPERATION_TYPE_MAP = {
  1: "add",
  2: "sub",
  3: "mul",
  4: "div",
} as const;

export type GroupOperationTarget = (typeof GROUP_TARGET_MAP)[keyof typeof GROUP_TARGET_MAP];
export type GroupOperationType = (typeof GROUP_OPERATION_TYPE_MAP)[keyof typeof GROUP_OPERATION_TYPE_MAP];

export interface GroupOperation {
  seq: number;
  target: GroupOperationTarget;
  type: GroupOperationType;
  value: number;
}

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

function getGroupParticipant(groupName: string): string {
  return `fmbe:group:${groupName}`;
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
    const objective = getObjective(objectiveId);
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
    const objective = getObjective(objectiveId);
    if (!objective) continue;
    const score = objective.getScore(entity);
    if (score === undefined) continue;

    const value = fromScore(score);
    const prev = getTransformValue(next.transform, key);
    if (almostEqual(prev, value)) continue;

    next.transform[key] = value;
    changed = true;
  }

  const xScore = getObjective(LOCATION_OBJECTIVES.x)?.getScore(entity);
  if (xScore !== undefined) {
    const x = fromScore(xScore);
    if (!almostEqual(x, next.x)) {
      next.x = x;
      changed = true;
    }
  }

  const yScore = getObjective(LOCATION_OBJECTIVES.y)?.getScore(entity);
  if (yScore !== undefined) {
    const y = fromScore(yScore);
    if (!almostEqual(y, next.y)) {
      next.y = y;
      changed = true;
    }
  }

  const zScore = getObjective(LOCATION_OBJECTIVES.z)?.getScore(entity);
  if (zScore !== undefined) {
    const z = fromScore(zScore);
    if (!almostEqual(z, next.z)) {
      next.z = z;
      changed = true;
    }
  }

  const presetScore = getObjective(PRESET_OBJECTIVE)?.getScore(entity);
  if (presetScore !== undefined) {
    const preset = SCORE_TO_PRESET[presetScore];
    if (preset && preset !== next.preset) {
      next.preset = preset;
      changed = true;
    }
  }

  const normalized = normalizeTransform(next.transform);
  if (JSON.stringify(normalized) !== JSON.stringify(next.transform)) {
    next.transform = normalized;
    changed = true;
  }

  return { changed, record: next };
}

export function syncGroupScores(groupName: string, record: FmbeRecord): void {
  const participant = getGroupParticipant(groupName);

  for (const [key, objectiveId] of Object.entries(GROUP_SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    getObjective(objectiveId).setScore(participant, toScore(getTransformValue(record.transform, key)));
  }

  getObjective(GROUP_LOCATION_OBJECTIVES.x).setScore(participant, toScore(record.x));
  getObjective(GROUP_LOCATION_OBJECTIVES.y).setScore(participant, toScore(record.y));
  getObjective(GROUP_LOCATION_OBJECTIVES.z).setScore(participant, toScore(record.z));
  getObjective(GROUP_PRESET_OBJECTIVE).setScore(participant, PRESET_TO_SCORE[record.preset]);
}

export function removeGroupScores(groupName: string): void {
  const participant = getGroupParticipant(groupName);
  const objectives = [
    ...Object.values(GROUP_SCORE_OBJECTIVES),
    GROUP_LOCATION_OBJECTIVES.x,
    GROUP_LOCATION_OBJECTIVES.y,
    GROUP_LOCATION_OBJECTIVES.z,
    GROUP_PRESET_OBJECTIVE,
  ];

  for (const objectiveId of objectives) {
    const objective = getObjective(objectiveId);
    if (!objective) continue;
    objective.removeParticipant(participant);
  }
}

export function readGroupScores(groupName: string, fallback: FmbeRecord): { changed: boolean; record: FmbeRecord } {
  const participant = getGroupParticipant(groupName);
  const next: FmbeRecord = {
    ...fallback,
    transform: { ...fallback.transform },
  };

  let changed = false;

  for (const [key, objectiveId] of Object.entries(GROUP_SCORE_OBJECTIVES) as Array<[keyof StoredTransform, string]>) {
    const objective = getObjective(objectiveId);
    if (!objective) continue;

    const score = objective.getScore(participant);
    if (score === undefined) continue;

    const value = fromScore(score);
    const prev = getTransformValue(next.transform, key);
    if (almostEqual(prev, value)) continue;

    next.transform[key] = value;
    changed = true;
  }

  const xScore = getObjective(GROUP_LOCATION_OBJECTIVES.x)?.getScore(participant);
  if (xScore !== undefined) {
    const x = fromScore(xScore);
    if (!almostEqual(x, next.x)) {
      next.x = x;
      changed = true;
    }
  }

  const yScore = getObjective(GROUP_LOCATION_OBJECTIVES.y)?.getScore(participant);
  if (yScore !== undefined) {
    const y = fromScore(yScore);
    if (!almostEqual(y, next.y)) {
      next.y = y;
      changed = true;
    }
  }

  const zScore = getObjective(GROUP_LOCATION_OBJECTIVES.z)?.getScore(participant);
  if (zScore !== undefined) {
    const z = fromScore(zScore);
    if (!almostEqual(z, next.z)) {
      next.z = z;
      changed = true;
    }
  }

  const presetScore = getObjective(GROUP_PRESET_OBJECTIVE)?.getScore(participant);
  if (presetScore !== undefined) {
    const preset = SCORE_TO_PRESET[presetScore];
    if (preset && preset !== next.preset) {
      next.preset = preset;
      changed = true;
    }
  }

  const normalized = normalizeTransform(next.transform);
  if (JSON.stringify(normalized) !== JSON.stringify(next.transform)) {
    next.transform = normalized;
    changed = true;
  }

  return { changed, record: next };
}

export function readGroupOperation(groupName: string): GroupOperation | undefined {
  const participant = getGroupParticipant(groupName);

  const seq = getObjective(GROUP_OPERATION_OBJECTIVES.seq)?.getScore(participant);
  if (seq === undefined) return undefined;

  const targetCode = getObjective(GROUP_OPERATION_OBJECTIVES.target)?.getScore(participant);
  const typeCode = getObjective(GROUP_OPERATION_OBJECTIVES.type)?.getScore(participant);
  const valueScore = getObjective(GROUP_OPERATION_OBJECTIVES.value)?.getScore(participant);
  if (targetCode === undefined || typeCode === undefined || valueScore === undefined) return undefined;

  const target = GROUP_TARGET_MAP[targetCode as keyof typeof GROUP_TARGET_MAP];
  const type = GROUP_OPERATION_TYPE_MAP[typeCode as keyof typeof GROUP_OPERATION_TYPE_MAP];
  if (!target || !type) return undefined;

  return {
    seq,
    target,
    type,
    value: fromScore(valueScore),
  };
}
