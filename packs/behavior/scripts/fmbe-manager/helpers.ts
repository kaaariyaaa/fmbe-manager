import { Player, world, type CustomCommandOrigin } from "@minecraft/server";
import { MinecraftDimensionTypes } from "@minecraft/vanilla-data";
import { type FmbeRenderVariables } from "../lib/fmbe-lib/index.ts";
import { type FmbeListPreset, type FmbePreset, type FmbeRecord, type StoredTransform } from "./types.ts";

export const ADDON_NAME = "fmbe-manager";

export const DIMENSIONS = [
  MinecraftDimensionTypes.Overworld,
  MinecraftDimensionTypes.Nether,
  MinecraftDimensionTypes.TheEnd,
];

export const DP_MANAGED = "fmbe:managed";
export const DP_ID = "fmbe:id";
export const DP_PRESET = "fmbe:preset";
export const DP_BLOCK = "fmbe:block_type_id";
export const DP_ITEM = "fmbe:item_type_id";
export const DP_EXTEND_ZROT = "fmbe:extend_zrot";

export function isNamespacedId(id: string): boolean {
  return /^[a-z0-9_\-.]+:[a-z0-9_\-./]+$/i.test(id);
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function toTransform(input: {
  xOffset?: unknown;
  yOffset?: unknown;
  zOffset?: unknown;
  xRot?: unknown;
  yRot?: unknown;
  zRot?: unknown;
  scale?: unknown;
  extendScale?: unknown;
  extendXrot?: unknown;
  extendYrot?: unknown;
  extendZrot?: unknown;
  xBasePos?: unknown;
  yBasePos?: unknown;
  zBasePos?: unknown;
}): StoredTransform {
  return {
    xOffset: asNumber(input.xOffset),
    yOffset: asNumber(input.yOffset),
    zOffset: asNumber(input.zOffset),
    xRot: asNumber(input.xRot),
    yRot: asNumber(input.yRot),
    zRot: asNumber(input.zRot),
    scale: asNumber(input.scale),
    extendScale: asNumber(input.extendScale),
    extendXrot: asNumber(input.extendXrot),
    extendYrot: asNumber(input.extendYrot),
    extendZrot: asNumber(input.extendZrot),
    xBasePos: asNumber(input.xBasePos),
    yBasePos: asNumber(input.yBasePos),
    zBasePos: asNumber(input.zBasePos),
  };
}

export function transformToRenderVariables(transform: StoredTransform): FmbeRenderVariables {
  return {
    xpos: transform.xOffset,
    ypos: transform.yOffset,
    zpos: transform.zOffset,
    xrot: transform.xRot,
    yrot: transform.yRot,
    zrot: transform.zRot,
    scale: transform.scale,
    extendScale: transform.extendScale,
    extendXrot: transform.extendXrot,
    extendYrot: transform.extendYrot,
    xbasepos: transform.xBasePos,
    ybasepos: transform.yBasePos,
    zbasepos: transform.zBasePos,
  };
}

export function renderVariablesToTransform(variables: FmbeRenderVariables, extendZrot?: number): StoredTransform {
  return {
    xOffset: variables.xpos,
    yOffset: variables.ypos,
    zOffset: variables.zpos,
    xRot: variables.xrot,
    yRot: variables.yrot,
    zRot: variables.zrot,
    scale: variables.scale,
    extendScale: variables.extendScale,
    extendXrot: variables.extendXrot,
    extendYrot: variables.extendYrot,
    extendZrot,
    xBasePos: variables.xbasepos,
    yBasePos: variables.ybasepos,
    zBasePos: variables.zbasepos,
  };
}

export function presetFromBlockEnum(preset: string): FmbePreset {
  return preset === "2D" ? "block2d" : "block3d";
}

export function presetFromAnyEnum(preset: string): FmbePreset {
  if (preset === "Item") return "item";
  if (preset === "2D") return "block2d";
  return "block3d";
}

export function presetToDisplay(preset: FmbePreset): FmbeListPreset {
  if (preset === "item") return "Item";
  if (preset === "block2d") return "2D";
  return "3D";
}

export function now(): number {
  return Date.now();
}

export function parseTransformJson(value: unknown): StoredTransform {
  if (typeof value !== "string" || value.length === 0) return {};
  try {
    const parsed = JSON.parse(value) as StoredTransform;
    return toTransform(parsed);
  } catch {
    return {};
  }
}

export function formatRecord(record: FmbeRecord): string {
  const itemOrBlock = record.preset === "item" ? record.itemTypeId ?? "-" : record.blockTypeId ?? "-";
  return (
    `id=${record.id} ` +
    `preset=${presetToDisplay(record.preset)} ` +
    `type=${itemOrBlock} ` +
    `loc=${record.dimensionId} (${record.x.toFixed(2)}, ${record.y.toFixed(2)}, ${record.z.toFixed(2)})`
  );
}

export function getOriginPlayer(origin: CustomCommandOrigin): Player | undefined {
  const source = origin.sourceEntity;
  if (source instanceof Player) return source;
  return undefined;
}

export function sendToOrigin(origin: CustomCommandOrigin, message: string): void {
  const player = getOriginPlayer(origin);
  if (player) {
    player.sendMessage(message);
    return;
  }
  world.sendMessage(`[${ADDON_NAME}] ${message}`);
}
