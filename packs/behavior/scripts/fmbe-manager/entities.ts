import { world, type CustomCommandOrigin, type Entity, type Vector3 } from "@minecraft/server";
import { MinecraftEntityTypes } from "@minecraft/vanilla-data";
import { FmbeRenderTypes, defaultFmbeManager } from "../lib/fmbe-lib/index.ts";
import { getLastHit } from "./state.ts";
import {
  DIMENSIONS,
  DP_BLOCK,
  DP_EXTEND_ZROT,
  DP_ID,
  DP_ITEM,
  DP_MANAGED,
  DP_PRESET,
  asNumber,
  getOriginPlayer,
  normalizeTransform,
  renderVariablesToTransform,
  transformToRenderVariables,
} from "./helpers.ts";
import { now } from "./helpers.ts";
import { type FmbePreset, type FmbeRecord } from "./types.ts";
import { removeEntityScores, syncEntityScores } from "./scoreboard.ts";
import { clearEntityGroupMembership, syncEntityGroupMembership } from "./groups.ts";

const ID_TAG_PREFIX = "fmbe:";
const MANAGED_TAG = "fmbe";

function sanitizeIdForTag(id: string): string {
  return id.replace(/[^a-zA-Z0-9_:\-./]/g, "_");
}

function getIdTag(id: string): string {
  return `${ID_TAG_PREFIX}${sanitizeIdForTag(id)}`;
}

function syncIdTag(entity: Entity, id: string): void {
  const expected = getIdTag(id);
  for (const tag of entity.getTags()) {
    if (!tag.startsWith(ID_TAG_PREFIX)) continue;
    if (tag === expected) return;
    entity.removeTag(tag);
  }
  entity.addTag(expected);
}

function ensureManagedTag(entity: Entity): void {
  if (entity.getTags().includes(MANAGED_TAG)) return;
  entity.addTag(MANAGED_TAG);
}

function getMainhandTypeId(record: FmbeRecord): string | undefined {
  if (record.preset === "item") {
    return record.itemTypeId ?? record.blockTypeId ?? undefined;
  }
  return record.blockTypeId ?? record.itemTypeId ?? undefined;
}

function enforceMainhand(entity: Entity, record: FmbeRecord): void {
  const typeId = getMainhandTypeId(record);
  if (!typeId) return;
  try {
    entity.runCommand(`replaceitem entity @s slot.weapon.mainhand 0 ${typeId} 1`);
  } catch {
    // ignore invalid item/block ids for replaceitem
  }
}

function presetToRenderType(preset: FmbePreset): FmbeRenderTypes {
  switch (preset) {
    case "item":
      return FmbeRenderTypes.Item;
    case "block2d":
      return FmbeRenderTypes.Block2D;
    case "block3d":
      return FmbeRenderTypes.Block3D;
  }
}

export function isManagedEntity(entity: Entity): boolean {
  if (entity.typeId !== MinecraftEntityTypes.Fox) return false;
  if (!entity.getTags().includes(MANAGED_TAG)) return false;
  const managed = entity.getDynamicProperty(DP_MANAGED);
  const fmbeId = entity.getDynamicProperty(DP_ID);
  return managed === true && typeof fmbeId === "string" && fmbeId.length > 0;
}

export function applyRecordToEntity(entity: Entity, record: FmbeRecord): void {
  const normalizedTransform = normalizeTransform(record.transform);

  entity.setDynamicProperty(DP_MANAGED, true);
  entity.setDynamicProperty(DP_ID, record.id);
  entity.setDynamicProperty(DP_PRESET, record.preset);
  entity.setDynamicProperty(DP_BLOCK, record.blockTypeId ?? undefined);
  entity.setDynamicProperty(DP_ITEM, record.itemTypeId ?? undefined);
  entity.setDynamicProperty(DP_EXTEND_ZROT, normalizedTransform.extendZrot ?? undefined);
  ensureManagedTag(entity);
  syncIdTag(entity, record.id);
  syncEntityGroupMembership(entity, record.id);
  syncEntityScores(entity, { ...record, transform: normalizedTransform });

  defaultFmbeManager.applyRenderData(entity, {
    type: presetToRenderType(record.preset),
    variables: transformToRenderVariables(normalizedTransform),
  });

  enforceMainhand(entity, record);
}

export function removeManagedEntity(entity: Entity): void {
  removeEntityScores(entity);
  clearEntityGroupMembership(entity);
  entity.removeTag(MANAGED_TAG);
  for (const tag of entity.getTags()) {
    if (tag.startsWith(ID_TAG_PREFIX)) entity.removeTag(tag);
  }
  entity.setDynamicProperty(DP_MANAGED, undefined);
  entity.setDynamicProperty(DP_ID, undefined);
  entity.setDynamicProperty(DP_PRESET, undefined);
  entity.setDynamicProperty(DP_BLOCK, undefined);
  entity.setDynamicProperty(DP_ITEM, undefined);
  entity.setDynamicProperty(DP_EXTEND_ZROT, undefined);
  defaultFmbeManager.clearRenderData(entity);
  entity.remove();
}

export function getAllManagedEntities(): Entity[] {
  const result: Entity[] = [];
  for (const dimensionId of DIMENSIONS) {
    const dimension = world.getDimension(dimensionId);
    for (const entity of dimension.getEntities({ type: MinecraftEntityTypes.Fox })) {
      if (isManagedEntity(entity)) result.push(entity);
    }
  }
  return result;
}

export function findEntityByRuntimeId(runtimeId: string): Entity | undefined {
  for (const entity of getAllManagedEntities()) {
    if (entity.id === runtimeId) return entity;
  }
  return undefined;
}

export function findEntityByFmbeId(id: string): Entity | undefined {
  for (const entity of getAllManagedEntities()) {
    const fmbeId = entity.getDynamicProperty(DP_ID);
    if (fmbeId === id) return entity;
  }
  return undefined;
}

export function resolveTargetEntity(origin: CustomCommandOrigin, entityArg?: Entity): Entity | undefined {
  if (entityArg && isManagedEntity(entityArg)) return entityArg;

  const player = getOriginPlayer(origin);
  if (!player) return undefined;
  const lastHit = getLastHit(player.id);
  if (!lastHit) return undefined;
  return findEntityByRuntimeId(lastHit);
}

export function toEntityRecord(entity: Entity): FmbeRecord | undefined {
  if (!isManagedEntity(entity)) return undefined;

  const id = entity.getDynamicProperty(DP_ID);
  const preset = entity.getDynamicProperty(DP_PRESET);
  const blockTypeId = entity.getDynamicProperty(DP_BLOCK);
  const itemTypeId = entity.getDynamicProperty(DP_ITEM);
  const extendZrot = entity.getDynamicProperty(DP_EXTEND_ZROT);

  if (typeof id !== "string") return undefined;
  if (preset !== "item" && preset !== "block2d" && preset !== "block3d") return undefined;

  const transform = renderVariablesToTransform(defaultFmbeManager.getRenderVariables(entity) ?? {}, asNumber(extendZrot));

  return {
    id,
    preset,
    blockTypeId: typeof blockTypeId === "string" ? blockTypeId : null,
    itemTypeId: typeof itemTypeId === "string" ? itemTypeId : null,
    dimensionId: entity.dimension.id,
    x: entity.location.x,
    y: entity.location.y,
    z: entity.location.z,
    transform,
    updatedAt: now(),
  };
}

export function spawnFromRecord(record: FmbeRecord, at?: { dimensionId: string; location: Vector3 }): Entity {
  const dimension = world.getDimension(at?.dimensionId ?? record.dimensionId);
  const location = at?.location ?? { x: record.x, y: record.y, z: record.z };
  const entity = dimension.spawnEntity(MinecraftEntityTypes.Fox, location);
  applyRecordToEntity(entity, {
    ...record,
    dimensionId: dimension.id,
    x: location.x,
    y: location.y,
    z: location.z,
  });
  return entity;
}
