export type FmbePreset = "item" | "block2d" | "block3d";
export type FmbeListPreset = "Item" | "2D" | "3D";
export type FmbeDataMode = "cleanup" | "fix" | "validate";

export interface StoredTransform {
  xOffset?: number;
  yOffset?: number;
  zOffset?: number;
  xRot?: number;
  yRot?: number;
  zRot?: number;
  scale?: number;
  extendScale?: number;
  extendXrot?: number;
  extendYrot?: number;
  extendZrot?: number;
  xBasePos?: number;
  yBasePos?: number;
  zBasePos?: number;
}

export interface FmbeRecord {
  id: string;
  preset: FmbePreset;
  blockTypeId: string | null;
  itemTypeId: string | null;
  dimensionId: string;
  x: number;
  y: number;
  z: number;
  transform: StoredTransform;
  updatedAt: number;
}
