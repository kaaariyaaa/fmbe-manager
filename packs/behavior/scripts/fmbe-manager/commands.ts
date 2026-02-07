import {
  CommandPermissionLevel,
  CustomCommandParamType,
  CustomCommandStatus,
  system,
  world,
  type BlockType,
  type CustomCommand,
  type CustomCommandOrigin,
  type CustomCommandRegistry,
  type Entity,
  type ItemType,
  type Vector3,
} from "@minecraft/server";
import { MinecraftDimensionTypes } from "@minecraft/vanilla-data";
import { addPendingGet } from "./state.ts";
import { getAllRecords, getRecordById, removeRecordById, upsertRecord } from "./db.ts";
import {
  applyRecordToEntity,
  findEntityByFmbeId,
  getAllManagedEntities,
  isManagedEntity,
  removeManagedEntity,
  resolveTargetEntity,
  spawnFromRecord,
  toEntityRecord,
} from "./entities.ts";
import {
  formatRecord,
  getOriginPlayer,
  isNamespacedId,
  now,
  presetFromAnyEnum,
  presetFromBlockEnum,
  presetToDisplay,
  sendToOrigin,
  toTransform,
  DP_ID,
} from "./helpers.ts";
import { type FmbeDataMode, type FmbeRecord } from "./types.ts";

function registerManagedCommand(
  registry: CustomCommandRegistry,
  command: CustomCommand,
  handler: (origin: CustomCommandOrigin, ...args: unknown[]) => void
): void {
  registry.registerCommand(command, (origin, ...args) => {
    system.run(() => {
      try {
        handler(origin, ...args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendToOrigin(origin, `§c[FMBE] ${message}`);
      }
    });
    return { status: CustomCommandStatus.Success };
  });
}

function commandBase(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    cheatsRequired: true,
    permissionLevel: CommandPermissionLevel.GameDirectors,
  };
}

export function registerCommands(): void {
  system.beforeEvents.startup.subscribe((startup) => {
    const { customCommandRegistry: registry } = startup;

    registry.registerEnum("fmbe:new_block_preset", ["2D", "3D"]);
    registry.registerEnum("fmbe:list_preset", ["Item", "2D", "3D"]);
    registry.registerEnum("fmbe:set_preset", ["Item", "2D", "3D"]);
    registry.registerEnum("fmbe:data_content", ["cleanup", "fix", "validate"]);

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:new_block", "Create a new FMBE block"),
        mandatoryParameters: [
          { type: CustomCommandParamType.String, name: "id" },
          { type: CustomCommandParamType.BlockType, name: "block" },
          { type: CustomCommandParamType.Enum, name: "preset", enumName: "fmbe:new_block_preset" },
        ],
        optionalParameters: [
          { type: CustomCommandParamType.Location, name: "location" },
          { type: CustomCommandParamType.Float, name: "xOffset" },
          { type: CustomCommandParamType.Float, name: "yOffset" },
          { type: CustomCommandParamType.Float, name: "zOffset" },
          { type: CustomCommandParamType.Float, name: "xRot" },
          { type: CustomCommandParamType.Float, name: "yRot" },
          { type: CustomCommandParamType.Float, name: "zRot" },
          { type: CustomCommandParamType.Float, name: "scale" },
          { type: CustomCommandParamType.Float, name: "extendScale" },
          { type: CustomCommandParamType.Float, name: "extendXrot" },
          { type: CustomCommandParamType.Float, name: "extendYrot" },
          { type: CustomCommandParamType.Float, name: "extendZrot" },
          { type: CustomCommandParamType.Float, name: "xBasePos" },
          { type: CustomCommandParamType.Float, name: "yBasePos" },
          { type: CustomCommandParamType.Float, name: "zBasePos" },
        ],
      },
      (
        origin,
        id,
        block,
        preset,
        location,
        xOffset,
        yOffset,
        zOffset,
        xRot,
        yRot,
        zRot,
        scale,
        extendScale,
        extendXrot,
        extendYrot,
        extendZrot,
        xBasePos,
        yBasePos,
        zBasePos
      ) => {
        const fmbeId = String(id ?? "");
        if (!isNamespacedId(fmbeId)) throw new Error("id must be namespaced. e.g. fmbe:sample");
        if (getRecordById(fmbeId)) throw new Error(`id already exists: ${fmbeId}`);

        const blockTypeId = (block as BlockType).id;
        const presetValue = presetFromBlockEnum(String(preset));

        const sourcePlayer = getOriginPlayer(origin);
        const sourceDimensionId = sourcePlayer?.dimension.id ?? MinecraftDimensionTypes.Overworld;
        const sourceLocation = sourcePlayer?.location ?? { x: 0, y: 80, z: 0 };
        const spawnLocation = (location as Vector3 | undefined) ?? sourceLocation;

        const transform = toTransform({
          xOffset,
          yOffset,
          zOffset,
          xRot,
          yRot,
          zRot,
          scale,
          extendScale,
          extendXrot,
          extendYrot,
          extendZrot,
          xBasePos,
          yBasePos,
          zBasePos,
        });

        const record: FmbeRecord = {
          id: fmbeId,
          preset: presetValue,
          blockTypeId,
          itemTypeId: null,
          dimensionId: sourceDimensionId,
          x: spawnLocation.x,
          y: spawnLocation.y,
          z: spawnLocation.z,
          transform,
          updatedAt: now(),
        };

        const entity = spawnFromRecord(record);
        upsertRecord(record);
        sendToOrigin(origin, `§a[FMBE] created block ${fmbeId} (${presetToDisplay(record.preset)}) runtimeId=${entity.id}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:new_item", "Create a new FMBE item"),
        mandatoryParameters: [
          { type: CustomCommandParamType.String, name: "id" },
          { type: CustomCommandParamType.ItemType, name: "item" },
          { type: CustomCommandParamType.Location, name: "location" },
        ],
        optionalParameters: [
          { type: CustomCommandParamType.Float, name: "xOffset" },
          { type: CustomCommandParamType.Float, name: "yOffset" },
          { type: CustomCommandParamType.Float, name: "zOffset" },
          { type: CustomCommandParamType.Float, name: "xRot" },
          { type: CustomCommandParamType.Float, name: "yRot" },
          { type: CustomCommandParamType.Float, name: "zRot" },
          { type: CustomCommandParamType.Float, name: "scale" },
          { type: CustomCommandParamType.Float, name: "extendScale" },
          { type: CustomCommandParamType.Float, name: "extendXrot" },
          { type: CustomCommandParamType.Float, name: "extendYrot" },
          { type: CustomCommandParamType.Float, name: "extendZrot" },
          { type: CustomCommandParamType.Float, name: "xBasePos" },
          { type: CustomCommandParamType.Float, name: "yBasePos" },
          { type: CustomCommandParamType.Float, name: "zBasePos" },
        ],
      },
      (
        origin,
        id,
        item,
        location,
        xOffset,
        yOffset,
        zOffset,
        xRot,
        yRot,
        zRot,
        scale,
        extendScale,
        extendXrot,
        extendYrot,
        extendZrot,
        xBasePos,
        yBasePos,
        zBasePos
      ) => {
        const fmbeId = String(id ?? "");
        if (!isNamespacedId(fmbeId)) throw new Error("id must be namespaced. e.g. fmbe:sample");
        if (getRecordById(fmbeId)) throw new Error(`id already exists: ${fmbeId}`);

        const itemTypeId = (item as ItemType).id;
        const sourcePlayer = getOriginPlayer(origin);
        const sourceDimensionId = sourcePlayer?.dimension.id ?? MinecraftDimensionTypes.Overworld;

        const transform = toTransform({
          xOffset,
          yOffset,
          zOffset,
          xRot,
          yRot,
          zRot,
          scale,
          extendScale,
          extendXrot,
          extendYrot,
          extendZrot,
          xBasePos,
          yBasePos,
          zBasePos,
        });

        const spawnLocation = location as Vector3;
        const record: FmbeRecord = {
          id: fmbeId,
          preset: "item",
          blockTypeId: null,
          itemTypeId,
          dimensionId: sourceDimensionId,
          x: spawnLocation.x,
          y: spawnLocation.y,
          z: spawnLocation.z,
          transform,
          updatedAt: now(),
        };

        const entity = spawnFromRecord(record);
        upsertRecord(record);
        sendToOrigin(origin, `§a[FMBE] created item ${fmbeId} runtimeId=${entity.id}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:list", "List FMBE records"),
        optionalParameters: [{ type: CustomCommandParamType.Enum, name: "preset", enumName: "fmbe:list_preset" }],
      },
      (origin, preset) => {
        const rows = getAllRecords();
        const filter = typeof preset === "string" ? presetFromAnyEnum(preset) : undefined;
        const filtered = filter ? rows.filter((row) => row.preset === filter) : rows;
        if (filtered.length === 0) {
          sendToOrigin(origin, "§e[FMBE] no entries.");
          return;
        }

        sendToOrigin(origin, `§b[FMBE] ${filtered.length} entries`);
        for (const row of filtered) {
          sendToOrigin(origin, `§7- ${formatRecord(row)}`);
        }
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:get", "Get FMBE data"),
        optionalParameters: [{ type: CustomCommandParamType.String, name: "id" }],
      },
      (origin, id) => {
        const fmbeId = typeof id === "string" ? id : undefined;

        if (fmbeId) {
          const row = getRecordById(fmbeId);
          if (!row) throw new Error(`id not found: ${fmbeId}`);
          sendToOrigin(origin, `§b[FMBE] ${formatRecord(row)}`);
          sendToOrigin(origin, `§7transform=${JSON.stringify(row.transform)}`);
          return;
        }

        const target = resolveTargetEntity(origin);
        if (target) {
          const targetId = target.getDynamicProperty(DP_ID);
          if (typeof targetId === "string") {
            const row = getRecordById(targetId);
            if (row) {
              sendToOrigin(origin, `§b[FMBE] ${formatRecord(row)}`);
              sendToOrigin(origin, `§7transform=${JSON.stringify(row.transform)}`);
              return;
            }
          }
        }

        const player = getOriginPlayer(origin);
        if (!player) throw new Error("id omitted and no player context.");
        addPendingGet(player.id);
        sendToOrigin(origin, "§e[FMBE] hit an FMBE to inspect it.");
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_id", "Change FMBE id"),
        mandatoryParameters: [
          { type: CustomCommandParamType.String, name: "beforeId" },
          { type: CustomCommandParamType.String, name: "afterId" },
        ],
      },
      (origin, beforeId, afterId) => {
        const oldId = String(beforeId ?? "");
        const newId = String(afterId ?? "");
        if (!isNamespacedId(newId)) throw new Error("afterId must be namespaced.");

        const row = getRecordById(oldId);
        if (!row) throw new Error(`id not found: ${oldId}`);
        if (getRecordById(newId)) throw new Error(`id already exists: ${newId}`);

        const target = findEntityByFmbeId(oldId);
        const next: FmbeRecord = { ...row, id: newId, updatedAt: now() };
        removeRecordById(oldId);
        upsertRecord(next);
        if (target) target.setDynamicProperty(DP_ID, newId);
        sendToOrigin(origin, `§a[FMBE] id changed ${oldId} -> ${newId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_preset", "Set preset"),
        mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "preset", enumName: "fmbe:set_preset" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, preset, entity, id) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined, id as string | undefined);
        if (!target) throw new Error("target not found. specify entity/id or hit target first.");

        const targetId = target.getDynamicProperty(DP_ID);
        if (typeof targetId !== "string") throw new Error("target has no fmbe:id.");

        const row = getRecordById(targetId);
        if (!row) throw new Error(`id not found in DB: ${targetId}`);

        const nextPreset = presetFromAnyEnum(String(preset));
        const next: FmbeRecord = { ...row, preset: nextPreset, updatedAt: now() };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] preset updated: ${targetId} -> ${presetToDisplay(nextPreset)}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_block", "Set block type"),
        mandatoryParameters: [{ type: CustomCommandParamType.BlockType, name: "block" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, block, entity, id) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined, id as string | undefined);
        if (!target) throw new Error("target not found. specify entity/id or hit target first.");

        const targetId = target.getDynamicProperty(DP_ID);
        if (typeof targetId !== "string") throw new Error("target has no fmbe:id.");

        const row = getRecordById(targetId);
        if (!row) throw new Error(`id not found in DB: ${targetId}`);
        const next: FmbeRecord = {
          ...row,
          blockTypeId: (block as BlockType).id,
          itemTypeId: row.preset === "item" ? row.itemTypeId : null,
          updatedAt: now(),
        };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] block updated: ${targetId} -> ${next.blockTypeId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_item", "Set item type"),
        mandatoryParameters: [{ type: CustomCommandParamType.ItemType, name: "item" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, item, entity, id) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined, id as string | undefined);
        if (!target) throw new Error("target not found. specify entity/id or hit target first.");

        const targetId = target.getDynamicProperty(DP_ID);
        if (typeof targetId !== "string") throw new Error("target has no fmbe:id.");

        const row = getRecordById(targetId);
        if (!row) throw new Error(`id not found in DB: ${targetId}`);
        const next: FmbeRecord = {
          ...row,
          itemTypeId: (item as ItemType).id,
          blockTypeId: row.preset === "item" ? null : row.blockTypeId,
          updatedAt: now(),
        };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] item updated: ${targetId} -> ${next.itemTypeId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_location", "Set FMBE location"),
        mandatoryParameters: [{ type: CustomCommandParamType.Location, name: "location" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, location, entity, id) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined, id as string | undefined);
        if (!target) throw new Error("target not found. specify entity/id or hit target first.");

        const targetId = target.getDynamicProperty(DP_ID);
        if (typeof targetId !== "string") throw new Error("target has no fmbe:id.");

        const row = getRecordById(targetId);
        if (!row) throw new Error(`id not found in DB: ${targetId}`);

        const pos = location as Vector3;
        target.teleport(pos);
        const next: FmbeRecord = {
          ...row,
          dimensionId: target.dimension.id,
          x: pos.x,
          y: pos.y,
          z: pos.z,
          updatedAt: now(),
        };
        upsertRecord(next);
        sendToOrigin(origin, `§a[FMBE] moved: ${targetId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:clone", "Clone FMBE record"),
        mandatoryParameters: [
          { type: CustomCommandParamType.String, name: "fromId" },
          { type: CustomCommandParamType.String, name: "toId" },
        ],
        optionalParameters: [{ type: CustomCommandParamType.Location, name: "location" }],
      },
      (origin, fromId, toId, location) => {
        const from = getRecordById(String(fromId ?? ""));
        if (!from) throw new Error(`fromId not found: ${String(fromId ?? "")}`);
        const toIdValue = String(toId ?? "");
        if (!isNamespacedId(toIdValue)) throw new Error("toId must be namespaced.");

        const toExisting = getRecordById(toIdValue);
        const toEntity = findEntityByFmbeId(toIdValue);

        const cloneBase: FmbeRecord = {
          ...from,
          id: toIdValue,
          updatedAt: now(),
        };

        const specifiedLoc = location as Vector3 | undefined;
        if (toExisting && !specifiedLoc) {
          cloneBase.dimensionId = toExisting.dimensionId;
          cloneBase.x = toExisting.x;
          cloneBase.y = toExisting.y;
          cloneBase.z = toExisting.z;
        }
        if (specifiedLoc) {
          const originPlayer = getOriginPlayer(origin);
          cloneBase.dimensionId = originPlayer?.dimension.id ?? cloneBase.dimensionId;
          cloneBase.x = specifiedLoc.x;
          cloneBase.y = specifiedLoc.y;
          cloneBase.z = specifiedLoc.z;
        }

        upsertRecord(cloneBase);

        if (toEntity) {
          if (specifiedLoc) toEntity.teleport(specifiedLoc);
          applyRecordToEntity(toEntity, cloneBase);
        } else {
          spawnFromRecord(cloneBase);
        }

        sendToOrigin(origin, `§a[FMBE] cloned: ${from.id} -> ${toIdValue}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:remove", "Remove FMBE"),
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, entity, id) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined, id as string | undefined);
        if (!target) throw new Error("target not found. specify entity/id or hit target first.");

        const targetId = target.getDynamicProperty(DP_ID);
        if (typeof targetId !== "string") throw new Error("target has no fmbe:id.");

        removeRecordById(targetId);
        removeManagedEntity(target);
        sendToOrigin(origin, `§a[FMBE] removed: ${targetId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:data", "Synchronize data and entities"),
        mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "content", enumName: "fmbe:data_content" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "id" },
        ],
      },
      (origin, content, entity, id) => {
        const mode = String(content) as FmbeDataMode;
        const scopeEntity = entity as Entity | undefined;
        const scopeId = id as string | undefined;

        const scopedFmbeId =
          scopeId ??
          (() => {
            if (!scopeEntity) return undefined;
            const value = scopeEntity.getDynamicProperty(DP_ID);
            return typeof value === "string" ? value : undefined;
          })();

        const dbRecords = scopedFmbeId
          ? (() => {
              const row = getRecordById(scopedFmbeId);
              return row ? [row] : [];
            })()
          : getAllRecords();
        const dbMap = new Map<string, FmbeRecord>();
        for (const row of dbRecords) dbMap.set(row.id, row);

        const entities = scopeEntity
          ? isManagedEntity(scopeEntity)
            ? [scopeEntity]
            : []
          : scopeId
            ? (() => {
                const byId = findEntityByFmbeId(scopeId);
                return byId ? [byId] : [];
              })()
            : getAllManagedEntities();
        const entityMap = new Map<string, Entity>();
        for (const ent of entities) {
          const entityId = ent.getDynamicProperty(DP_ID);
          if (typeof entityId === "string") entityMap.set(entityId, ent);
        }

        if (mode === "cleanup") {
          let removedDb = 0;
          let removedEntity = 0;

          for (const [fmbeId] of dbMap) {
            if (!entityMap.has(fmbeId)) {
              removeRecordById(fmbeId);
              removedDb++;
            }
          }

          for (const [fmbeId, ent] of entityMap) {
            if (!dbMap.has(fmbeId)) {
              removeManagedEntity(ent);
              removedEntity++;
            }
          }

          sendToOrigin(origin, `§a[FMBE] cleanup done dbRemoved=${removedDb} entityRemoved=${removedEntity}`);
          return;
        }

        if (mode === "fix") {
          let spawned = 0;
          let imported = 0;

          for (const [fmbeId, row] of dbMap) {
            if (!entityMap.has(fmbeId)) {
              spawnFromRecord(row);
              spawned++;
            }
          }

          for (const [fmbeId, ent] of entityMap) {
            if (dbMap.has(fmbeId)) continue;
            const row = toEntityRecord(ent);
            if (!row) continue;
            upsertRecord(row);
            imported++;
          }

          sendToOrigin(origin, `§a[FMBE] fix done spawned=${spawned} imported=${imported}`);
          return;
        }

        let spawned = 0;
        let updated = 0;
        let removed = 0;

        for (const [fmbeId, row] of dbMap) {
          const ent = entityMap.get(fmbeId);
          if (!ent) {
            spawnFromRecord(row);
            spawned++;
            continue;
          }

          if (
            ent.dimension.id !== row.dimensionId ||
            ent.location.x !== row.x ||
            ent.location.y !== row.y ||
            ent.location.z !== row.z
          ) {
            const targetDimension = world.getDimension(row.dimensionId);
            ent.teleport({ x: row.x, y: row.y, z: row.z }, { dimension: targetDimension });
          }
          applyRecordToEntity(ent, row);
          updated++;
        }

        for (const [fmbeId, ent] of entityMap) {
          if (!dbMap.has(fmbeId)) {
            removeManagedEntity(ent);
            removed++;
          }
        }

        sendToOrigin(origin, `§a[FMBE] validate done spawned=${spawned} updated=${updated} removed=${removed}`);
      }
    );
  });
}
