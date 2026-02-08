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
  clearRecordGroup,
  createGroup,
  deleteGroup,
  getGroupForRecord,
  getGroupMembers,
  hasGroup,
  listGroups,
  removeRecordFromGroups,
  setRecordGroup,
} from "./groups.ts";
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
  DP_ID,
  formatRecord,
  generateUuidLike,
  getOriginPlayer,
  now,
  presetFromAnyEnum,
  presetFromBlockEnum,
  presetToDisplay,
  sendToOrigin,
  toTransform,
} from "./helpers.ts";
import { type FmbeDataMode, type FmbeRecord } from "./types.ts";
import { readGroupScores, removeGroupScores } from "./scoreboard.ts";

function registerManagedCommand(
  registry: CustomCommandRegistry,
  command: CustomCommand,
  handler: (origin: CustomCommandOrigin, ...args: unknown[]) => void
): void {
  try {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    system.run(() => {
      try {
        world.sendMessage(`§c[FMBE] command register failed: ${command.name} (${message})`);
      } catch {
        // ignore when world messaging is unavailable
      }
    });
  }
}

function commandBase(name: string, description: string): CustomCommand {
  return {
    name,
    description,
    cheatsRequired: true,
    permissionLevel: CommandPermissionLevel.GameDirectors,
  };
}

function generateRecordId(): string {
  let id = `fmbe:${generateUuidLike()}`;
  while (getRecordById(id)) {
    id = `fmbe:${generateUuidLike()}`;
  }
  return id;
}

function getEntityRecordOrThrow(target: Entity): FmbeRecord {
  const targetId = target.getDynamicProperty(DP_ID);
  if (typeof targetId !== "string") throw new Error("target has no fmbe id.");
  const row = getRecordById(targetId);
  if (!row) throw new Error(`record missing for ${targetId}`);
  return row;
}

function validateGroupName(value: unknown): string {
  const groupName = String(value ?? "").trim();
  if (groupName.length === 0) throw new Error("group must not be empty.");
  if (groupName.length > 64) throw new Error("group name too long.");
  return groupName;
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
          { type: CustomCommandParamType.BlockType, name: "block" },
          { type: CustomCommandParamType.Enum, name: "preset", enumName: "fmbe:new_block_preset" },
        ],
        optionalParameters: [
          { type: CustomCommandParamType.Location, name: "location" },
          { type: CustomCommandParamType.Float, name: "xOffset" },
          { type: CustomCommandParamType.Float, name: "yOffset" },
          { type: CustomCommandParamType.Float, name: "zOffset" },
          { type: CustomCommandParamType.Float, name: "scale" },
        ],
      },
      (origin, block, preset, location, xOffset, yOffset, zOffset, scale) => {
        const fmbeId = generateRecordId();
        const blockTypeId = (block as BlockType).id;
        const presetValue = presetFromBlockEnum(String(preset));

        const sourcePlayer = getOriginPlayer(origin);
        const sourceDimensionId = sourcePlayer?.dimension.id ?? MinecraftDimensionTypes.Overworld;
        const sourceLocation = sourcePlayer?.location ?? { x: 0, y: 80, z: 0 };
        const spawnLocation = (location as Vector3 | undefined) ?? sourceLocation;

        const record: FmbeRecord = {
          id: fmbeId,
          preset: presetValue,
          blockTypeId,
          itemTypeId: null,
          dimensionId: sourceDimensionId,
          x: spawnLocation.x,
          y: spawnLocation.y,
          z: spawnLocation.z,
          transform: toTransform({ xOffset, yOffset, zOffset, scale }),
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
          { type: CustomCommandParamType.ItemType, name: "item" },
          { type: CustomCommandParamType.Location, name: "location" },
        ],
        optionalParameters: [
          { type: CustomCommandParamType.Float, name: "xOffset" },
          { type: CustomCommandParamType.Float, name: "yOffset" },
          { type: CustomCommandParamType.Float, name: "zOffset" },
          { type: CustomCommandParamType.Float, name: "scale" },
        ],
      },
      (origin, item, location, xOffset, yOffset, zOffset, scale) => {
        const fmbeId = generateRecordId();
        const itemTypeId = (item as ItemType).id;
        const sourcePlayer = getOriginPlayer(origin);
        const sourceDimensionId = sourcePlayer?.dimension.id ?? MinecraftDimensionTypes.Overworld;
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
          transform: toTransform({ xOffset, yOffset, zOffset, scale }),
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
        for (const row of filtered) sendToOrigin(origin, `§7- ${formatRecord(row)}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_create", "Create group"),
        mandatoryParameters: [{ type: CustomCommandParamType.String, name: "group" }],
      },
      (origin, group) => {
        const groupName = validateGroupName(group);
        if (!createGroup(groupName)) throw new Error(`group already exists: ${groupName}`);
        sendToOrigin(origin, `§a[FMBE] group created: ${groupName}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_delete", "Delete group"),
        mandatoryParameters: [{ type: CustomCommandParamType.String, name: "group" }],
      },
      (origin, group) => {
        const groupName = validateGroupName(group);
        const removedMembers = deleteGroup(groupName);
        if (!removedMembers) throw new Error(`group not found: ${groupName}`);

        removeGroupScores(groupName);
        for (const id of removedMembers) {
          const ent = findEntityByFmbeId(id);
          const row = getRecordById(id);
          if (!ent || !row) continue;
          applyRecordToEntity(ent, row);
        }
        sendToOrigin(origin, `§a[FMBE] group deleted: ${groupName} members=${removedMembers.length}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_list", "List groups"),
        optionalParameters: [{ type: CustomCommandParamType.String, name: "group" }],
      },
      (origin, group) => {
        const groupNameArg = typeof group === "string" ? group.trim() : "";
        if (groupNameArg.length > 0) {
          if (!hasGroup(groupNameArg)) throw new Error(`group not found: ${groupNameArg}`);

          const members = getGroupMembers(groupNameArg);
          sendToOrigin(origin, `§b[FMBE] group=${groupNameArg} members=${members.length}`);
          for (const id of members) {
            const row = getRecordById(id);
            if (!row) continue;
            sendToOrigin(origin, `§7- ${formatRecord(row)}`);
          }
          return;
        }

        const groups = listGroups();
        if (groups.length === 0) {
          sendToOrigin(origin, "§e[FMBE] no groups.");
          return;
        }

        sendToOrigin(origin, `§b[FMBE] groups=${groups.length}`);
        for (const groupName of groups) {
          sendToOrigin(origin, `§7- ${groupName} members=${getGroupMembers(groupName).length}`);
        }
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_move", "Move FMBE to another group"),
        mandatoryParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
          { type: CustomCommandParamType.String, name: "toGroup" },
        ],
      },
      (origin, entity, toGroup) => {
        const target = entity as Entity | undefined;
        if (!target || !isManagedEntity(target)) throw new Error("entity must be an FMBE.");

        const nextGroup = validateGroupName(toGroup);
        if (!hasGroup(nextGroup)) throw new Error(`group not found: ${nextGroup}`);

        const row = getEntityRecordOrThrow(target);
        const prevGroup = getGroupForRecord(row.id);
        if (!prevGroup) throw new Error("entity is not in a group. use fmbe:group_set first.");
        if (prevGroup === nextGroup) throw new Error("entity is already in that group.");

        setRecordGroup(row.id, nextGroup);
        applyRecordToEntity(target, row);
        sendToOrigin(origin, `§a[FMBE] moved ${row.id}: ${prevGroup} -> ${nextGroup}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_info", "Show group info"),
        mandatoryParameters: [{ type: CustomCommandParamType.String, name: "group" }],
      },
      (origin, group) => {
        const groupName = validateGroupName(group);
        if (!hasGroup(groupName)) throw new Error(`group not found: ${groupName}`);

        const members = getGroupMembers(groupName);
        sendToOrigin(origin, `§b[FMBE] group=${groupName} members=${members.length}`);
        for (const id of members) sendToOrigin(origin, `§7- ${id}`);

        const first = members.map((id) => getRecordById(id)).find((value) => value !== undefined);
        if (!first) return;
        const view = readGroupScores(groupName, first).record;
        sendToOrigin(origin, `§7preset=${presetToDisplay(view.preset)} loc=(${view.x.toFixed(2)}, ${view.y.toFixed(2)}, ${view.z.toFixed(2)})`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_set", "Assign entity to group"),
        mandatoryParameters: [
          { type: CustomCommandParamType.String, name: "group" },
          { type: CustomCommandParamType.EntitySelector, name: "entity" },
        ],
      },
      (origin, group, entity) => {
        const groupName = validateGroupName(group);
        const target = entity as Entity | undefined;
        if (!target || !isManagedEntity(target)) throw new Error("entity must be an FMBE.");

        if (!hasGroup(groupName)) throw new Error(`group not found: ${groupName}`);

        const row = getEntityRecordOrThrow(target);
        setRecordGroup(row.id, groupName);
        applyRecordToEntity(target, row);
        sendToOrigin(origin, `§a[FMBE] ${row.id} -> group ${groupName}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:group_clear", "Remove entity from group"),
        mandatoryParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, entity) => {
        const target = entity as Entity | undefined;
        if (!target || !isManagedEntity(target)) throw new Error("entity must be an FMBE.");

        const row = getEntityRecordOrThrow(target);
        const prev = getGroupForRecord(row.id);
        if (!prev) throw new Error("entity is not in a group.");

        clearRecordGroup(row.id);
        applyRecordToEntity(target, row);
        sendToOrigin(origin, `§a[FMBE] ${row.id} removed from group ${prev}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:get", "Get FMBE data"),
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (target) {
          const row = getEntityRecordOrThrow(target);
          sendToOrigin(origin, `§b[FMBE] ${formatRecord(row)}`);
          sendToOrigin(origin, `§7transform=${JSON.stringify(row.transform)}`);
          return;
        }

        const player = getOriginPlayer(origin);
        if (!player) throw new Error("entity omitted and no player context.");
        addPendingGet(player.id);
        sendToOrigin(origin, "§e[FMBE] hit an FMBE to inspect it.");
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_preset", "Set preset"),
        mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "preset", enumName: "fmbe:set_preset" }],
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, preset, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (!target) throw new Error("target not found. specify entity or hit target first.");

        const row = getEntityRecordOrThrow(target);
        const nextPreset = presetFromAnyEnum(String(preset));
        const next: FmbeRecord = { ...row, preset: nextPreset, updatedAt: now() };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] preset updated: ${row.id} -> ${presetToDisplay(nextPreset)}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_block", "Set block type"),
        mandatoryParameters: [{ type: CustomCommandParamType.BlockType, name: "block" }],
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, block, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (!target) throw new Error("target not found. specify entity or hit target first.");

        const row = getEntityRecordOrThrow(target);
        const next: FmbeRecord = {
          ...row,
          blockTypeId: (block as BlockType).id,
          itemTypeId: row.preset === "item" ? row.itemTypeId : null,
          updatedAt: now(),
        };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] block updated: ${row.id} -> ${next.blockTypeId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_item", "Set item type"),
        mandatoryParameters: [{ type: CustomCommandParamType.ItemType, name: "item" }],
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, item, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (!target) throw new Error("target not found. specify entity or hit target first.");

        const row = getEntityRecordOrThrow(target);
        const next: FmbeRecord = {
          ...row,
          itemTypeId: (item as ItemType).id,
          blockTypeId: row.preset === "item" ? null : row.blockTypeId,
          updatedAt: now(),
        };
        upsertRecord(next);
        applyRecordToEntity(target, next);
        sendToOrigin(origin, `§a[FMBE] item updated: ${row.id} -> ${next.itemTypeId}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:set_location", "Set FMBE location"),
        mandatoryParameters: [{ type: CustomCommandParamType.Location, name: "location" }],
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, location, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (!target) throw new Error("target not found. specify entity or hit target first.");

        const row = getEntityRecordOrThrow(target);
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
        sendToOrigin(origin, `§a[FMBE] moved: ${row.id}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:clone", "Clone FMBE by entity"),
        mandatoryParameters: [{ type: CustomCommandParamType.EntitySelector, name: "fromEntity" }],
        optionalParameters: [
          { type: CustomCommandParamType.EntitySelector, name: "toEntity" },
          { type: CustomCommandParamType.Location, name: "location" },
        ],
      },
      (origin, fromEntity, toEntity, location) => {
        const from = fromEntity as Entity | undefined;
        if (!from || !isManagedEntity(from)) throw new Error("fromEntity must be an FMBE.");
        const fromRow = getEntityRecordOrThrow(from);

        const target = toEntity as Entity | undefined;
        const specifiedLoc = location as Vector3 | undefined;

        if (target && isManagedEntity(target)) {
          const toRow = getEntityRecordOrThrow(target);
          const next: FmbeRecord = {
            ...fromRow,
            id: toRow.id,
            dimensionId: specifiedLoc ? target.dimension.id : toRow.dimensionId,
            x: specifiedLoc ? specifiedLoc.x : toRow.x,
            y: specifiedLoc ? specifiedLoc.y : toRow.y,
            z: specifiedLoc ? specifiedLoc.z : toRow.z,
            updatedAt: now(),
          };
          if (specifiedLoc) target.teleport(specifiedLoc);
          upsertRecord(next);
          applyRecordToEntity(target, next);
          sendToOrigin(origin, `§a[FMBE] cloned to existing entity: ${next.id}`);
          return;
        }

        const cloneId = generateRecordId();
        const originPlayer = getOriginPlayer(origin);
        const cloneBase: FmbeRecord = {
          ...fromRow,
          id: cloneId,
          updatedAt: now(),
        };
        if (specifiedLoc) {
          cloneBase.dimensionId = originPlayer?.dimension.id ?? cloneBase.dimensionId;
          cloneBase.x = specifiedLoc.x;
          cloneBase.y = specifiedLoc.y;
          cloneBase.z = specifiedLoc.z;
        }

        upsertRecord(cloneBase);
        const cloned = spawnFromRecord(cloneBase);
        sendToOrigin(origin, `§a[FMBE] cloned new: ${cloneBase.id} runtimeId=${cloned.id}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:remove", "Remove FMBE"),
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, entity) => {
        const target = resolveTargetEntity(origin, entity as Entity | undefined);
        if (!target) throw new Error("target not found. specify entity or hit target first.");

        const row = getEntityRecordOrThrow(target);
        removeRecordFromGroups(row.id);
        removeRecordById(row.id);
        removeManagedEntity(target);
        sendToOrigin(origin, `§a[FMBE] removed: ${row.id}`);
      }
    );

    registerManagedCommand(
      registry,
      {
        ...commandBase("fmbe:data", "Synchronize data and entities"),
        mandatoryParameters: [{ type: CustomCommandParamType.Enum, name: "content", enumName: "fmbe:data_content" }],
        optionalParameters: [{ type: CustomCommandParamType.EntitySelector, name: "entity" }],
      },
      (origin, content, entity) => {
        const mode = String(content) as FmbeDataMode;
        const scopeEntity = entity as Entity | undefined;

        const scopedId = scopeEntity?.getDynamicProperty(DP_ID);
        const targetId = typeof scopedId === "string" ? scopedId : undefined;

        const dbRecords = targetId
          ? (() => {
              const row = getRecordById(targetId);
              return row ? [row] : [];
            })()
          : getAllRecords();
        const dbMap = new Map<string, FmbeRecord>();
        for (const row of dbRecords) dbMap.set(row.id, row);

        const entities = scopeEntity ? (isManagedEntity(scopeEntity) ? [scopeEntity] : []) : getAllManagedEntities();
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
              removeRecordFromGroups(fmbeId);
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

          if (ent.dimension.id !== row.dimensionId || ent.location.x !== row.x || ent.location.y !== row.y || ent.location.z !== row.z) {
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
