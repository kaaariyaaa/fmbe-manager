# fmbe-manager

[日本語 README](./README.md)

Addon for managing FMBE (Fox Model Block Entity) in Minecraft Bedrock ScriptAPI.

## Overview

- FMBE entity type is fixed to `fox`
- Managed check uses common tag `fmbe` + DynamicProperty (`fmbe:managed`, `fmbe:id`)
- Persistence uses world DynamicProperty (`fmbe:records`, `fmbe:groups`)
- `EntitySelector` params are handled as `Entity[]`; all matched entities are processed
- Group system is supported (one group per entity)
- Group scoreboard values are applied only when changed

## Setup

This repository uses git submodules (for example: `packs/behavior/scripts/lib/fmbe-lib`).

### 1) Clone (recommended)

```bash
git clone --recurse-submodules https://github.com/kaaariyaaa/fmbe-manager.git
cd fmbe-manager
```

### 2) If already cloned

```bash
git submodule update --init --recursive
```

### 3) Install and validate

```bash
npm install
npm run typecheck
npm run lint
npm run build:local
```

## Packaging

```bash
npm run package:local
```

This writes `.mcpack` (and `.mcaddon` when applicable) into `dist`.

- With the current `bkit.config.json`, `resource` is `false`, so it usually generates `fmbe-manager_behavior.mcpack`.
- If both `behavior` and `resource` are enabled, `fmbe-manager.mcaddon` is also generated.

## Main Commands

### Create

- `/fmbe:create_block block:<BlockType> preset:<2D|3D> ?location ?xOffset ?yOffset ?zOffset ?scale`
- `/fmbe:create_item item:<ItemType> ?location ?xOffset ?yOffset ?zOffset ?scale`

### List / Inspect

- `/fmbe:list ?preset:<Item|2D|3D>`
- `/fmbe:data content:info ?entity:<EntitySelector>`
  - If `entity` is omitted: run command, then hit the first FMBE to inspect

### Edit

- `/fmbe:set_preset preset:<Item|2D|3D> entity:<EntitySelector>`
- `/fmbe:set_block block:<BlockType> entity:<EntitySelector>`
- `/fmbe:set_item item:<ItemType> entity:<EntitySelector>`
- `/fmbe:set_location location:<Location> entity:<EntitySelector>`

### Clone / Remove

- `/fmbe:clone fromEntity:<EntitySelector> ?toEntity:<EntitySelector> ?location:<Location>`
- `/fmbe:remove entity:<EntitySelector>`

### Data Sync

- `/fmbe:data content:<cleanup|fix|validate|info> ?entity:<EntitySelector>`

### Group

- `/fmbe:group_create group:<String>`
- `/fmbe:group_delete group:<String>`
- `/fmbe:group_list ?group:<String>`
- `/fmbe:group_info group:<String>`
- `/fmbe:group_set group:<String> entity:<EntitySelector>`
- `/fmbe:group_clear entity:<EntitySelector>`
- `/fmbe:group_move entity:<EntitySelector> toGroup:<String>`

### Help

- `/fmbe:help language:<English|Japanese> command:<Enum>`

## Group Scoreboard

Group shared values are stored on dummy participant `fmbe:group:<groupName>`.

- Absolute objectives (examples):
  - `fmbe:group:xOffset`, `fmbe:group:yOffset`, `fmbe:group:zOffset`
  - `fmbe:group:gxRot`, `fmbe:group:gyRot`, `fmbe:group:gzRot`
  - `fmbe:group:gscl`
  - `fmbe:group:gExtendScale`, `fmbe:group:gExtendXrot`, `fmbe:group:gExtendYrot`, `fmbe:group:gExtendZrot`
  - `fmbe:group:gxBasePos`, `fmbe:group:gyBasePos`, `fmbe:group:gzBasePos`
  - `fmbe:group:LocationX`, `fmbe:group:LocationY`, `fmbe:group:LocationZ`
  - `fmbe:group:Preset`

Float values use `x1000` scaling (example: `1.5 -> 1500`).

### Relative Operations

Use the following objectives:

- `fmbe:group:OpTarget`
- `fmbe:group:OpType`
- `fmbe:group:OpValue`
- `fmbe:group:OpSeq` (applies only when this value changes)

`OpTarget`:

- `1:xOffset 2:yOffset 3:zOffset 4:xRot 5:yRot 6:zRot 7:scale 8:extendScale 9:extendXrot 10:extendYrot 11:extendZrot 12:xBasePos 13:yBasePos 14:zBasePos 15:x 16:y 17:z`

`OpType`:

- `1:add 2:sub 3:mul 4:div`

Example (`+0.5` to `xOffset` for group `teamA`):

```mcfunction
scoreboard players set fmbe:group:teamA fmbe:group:OpTarget 1
scoreboard players set fmbe:group:teamA fmbe:group:OpType 1
scoreboard players set fmbe:group:teamA fmbe:group:OpValue 500
scoreboard players add fmbe:group:teamA fmbe:group:OpSeq 1
```

## Notes

- FMBE is fox-based; too many entities can cause lag
- If `replaceitem` receives an invalid id, mainhand update is skipped
- After changing command parameter definitions, some environments require a restart
