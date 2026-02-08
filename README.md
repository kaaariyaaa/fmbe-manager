# fmbe-manager

[English README](./README.en.md)

Minecraft Bedrock ScriptAPI で FMBE (Fox Model Block Entity) を管理するアドオンです。

## 概要

- FMBE 実体は `fox` 固定
- 管理対象判定は共通 tag `fmbe` + DynamicProperty (`fmbe:managed`, `fmbe:id`)
- 永続化は `world` の DynamicProperty (`fmbe:records`, `fmbe:groups`)
- `EntitySelector` 引数は `Entity[]` として処理され、複数一致時は全件に実行
- Group 機能あり（1体1グループ）
- Group 用 scoreboard は「値変化時のみ」反映

## セットアップ

このリポジトリは submodule を使用しています（例: `packs/behavior/scripts/lib/fmbe-lib`）。

### 1) Clone（推奨）

```bash
git clone --recurse-submodules <repo-url>
cd fmbe-manager
```

### 2) 既に clone 済みの場合

```bash
git submodule update --init --recursive
```

### 3) 依存インストールと検証

```bash
npm install
npm run typecheck
npm run lint
npm run build:local
```

## パッケージ方法

```bash
npm run package:local
```

`dist` に `.mcpack`（必要条件を満たす場合は `.mcaddon`）を出力します。

- 現在の `bkit.config.json` では `resource` が `false` のため、通常は `fmbe-manager_behavior.mcpack` が生成されます。
- `behavior` と `resource` の両方を有効化した場合は `fmbe-manager.mcaddon` も生成されます。

## 主要コマンド

### 作成

- `/fmbe:create_block block:<BlockType> preset:<2D|3D> ?location ?xOffset ?yOffset ?zOffset ?scale`
- `/fmbe:create_item item:<ItemType> ?location ?xOffset ?yOffset ?zOffset ?scale`

### 一覧/参照

- `/fmbe:list ?preset:<Item|2D|3D>`
- `/fmbe:data content:info ?entity:<EntitySelector>`
  - `entity` 省略時: 実行後に最初に殴った FMBE を表示

### 編集

- `/fmbe:set_preset preset:<Item|2D|3D> entity:<EntitySelector>`
- `/fmbe:set_block block:<BlockType> entity:<EntitySelector>`
- `/fmbe:set_item item:<ItemType> entity:<EntitySelector>`
- `/fmbe:set_location location:<Location> entity:<EntitySelector>`

### 複製/削除

- `/fmbe:clone fromEntity:<EntitySelector> ?toEntity:<EntitySelector> ?location:<Location>`
- `/fmbe:remove entity:<EntitySelector>`

### データ整合

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

## Group scoreboard

Group 共有値は dummy participant `fmbe:group:<groupName>` で管理します。

- 絶対値 objective 例:
  - `fmbe:group:xOffset`, `fmbe:group:yOffset`, `fmbe:group:zOffset`
  - `fmbe:group:gxRot`, `fmbe:group:gyRot`, `fmbe:group:gzRot`
  - `fmbe:group:gscl`
  - `fmbe:group:gExtendScale`, `fmbe:group:gExtendXrot`, `fmbe:group:gExtendYrot`, `fmbe:group:gExtendZrot`
  - `fmbe:group:gxBasePos`, `fmbe:group:gyBasePos`, `fmbe:group:gzBasePos`
  - `fmbe:group:LocationX`, `fmbe:group:LocationY`, `fmbe:group:LocationZ`
  - `fmbe:group:Preset`

小数は `x1000` スケールです（例: `1.5 -> 1500`）。

### 相対演算

相対演算は以下 objective を使用します。

- `fmbe:group:OpTarget`
- `fmbe:group:OpType`
- `fmbe:group:OpValue`
- `fmbe:group:OpSeq`（この値が変化した時だけ適用）

`OpTarget`:

- `1:xOffset 2:yOffset 3:zOffset 4:xRot 5:yRot 6:zRot 7:scale 8:extendScale 9:extendXrot 10:extendYrot 11:extendZrot 12:xBasePos 13:yBasePos 14:zBasePos 15:x 16:y 17:z`

`OpType`:

- `1:add 2:sub 3:mul 4:div`

例（group `teamA` の `xOffset` を `+0.5`）:

```mcfunction
scoreboard players set fmbe:group:teamA fmbe:group:OpTarget 1
scoreboard players set fmbe:group:teamA fmbe:group:OpType 1
scoreboard players set fmbe:group:teamA fmbe:group:OpValue 500
scoreboard players add fmbe:group:teamA fmbe:group:OpSeq 1
```

## 注意

- FMBE は fox ベースなので大量生成は負荷が上がります
- `replaceitem` に無効 ID を渡すと手持ち反映はスキップされます
- コマンド引数仕様を変更した後は、環境によって再起動が必要な場合があります
