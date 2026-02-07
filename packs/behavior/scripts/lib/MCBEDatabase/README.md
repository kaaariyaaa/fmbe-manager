# mcbe-db

Minecraft Bedrock Edition (Script API) 用の軽量 SQL ライクなデータベースライブラリです。永続化には `world.getDynamicProperty` を利用します。

英語版: [README.en.md](README.en.md)

---

## 特徴
- World Dynamic Property を利用した永続化
- CREATE / DROP / ALTER TABLE（ADD/RENAME/DROP COLUMN）
- INSERT / UPDATE / DELETE / SELECT
- JOIN: INNER / LEFT / RIGHT / FULL / CROSS / USING / ON(AND/OR)
- WHERE: AND / OR / NOT / IN / LIKE / BETWEEN / IS NULL
- GROUP BY / HAVING / DISTINCT
- ORDER BY（位置指定・NULLS FIRST/LAST 対応）
- LIMIT / OFFSET / TOP / FETCH FIRST
- 集約関数: COUNT / SUM / AVG / MIN / MAX（COUNT DISTINCT）
- サブクエリ（IN / EXISTS / SELECT 内スカラー）
- CTE（WITH）
- UNION / INTERSECT / EXCEPT（ALL 対応）
- トリガー（BEFORE/AFTER, INSERT/UPDATE/DELETE）
- 便利関数: LENGTH / LOWER / UPPER / TRIM / SUBSTR / REPLACE / CONCAT / ABS / ROUND / FLOOR / CEIL / COALESCE / IFNULL / NOW

---

## インストール
GitHub からクローンして、他プロジェクトの `libs` に配置してください。

例:
```sh
git clone https://github.com/kaaariyaaa/MCBEDatabase.git libs/MCBEDatabase
```

このリポジトリにはビルド済みの `lib/` が含まれているため、そのまま JS から利用できます。
更新した場合は `npm run build:lib` で再生成できます。

---

## 基本的な使い方

```ts
import { WorldSqlDatabase } from "../libs/MCBEDatabase/lib/index.js";

const db = new WorldSqlDatabase({ prefix: "mcbedatabase:db:main" });
db.load();

// テーブル作成
try {
  db.exec("CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT, joinCount INTEGER, lastJoin INTEGER)");
} catch {
  // already exists
}

// 追加
const now = Date.now();
db.exec("INSERT INTO players (id, name, joinCount, lastJoin) VALUES (?, ?, ?, ?)", ["p1", "Steve", 1, now]);

// 更新
const rows = db.query("SELECT joinCount FROM players WHERE id = ?", ["p1"]);
const next = (rows[0]?.joinCount ?? 0) + 1;
db.exec("UPDATE players SET joinCount = ?, lastJoin = ? WHERE id = ?", [next, now, "p1"]);

// 取得
const list = db.query("SELECT id, name, joinCount FROM players ORDER BY joinCount DESC LIMIT 5");
```

---

## トリガー例

```ts
// テーブル
try {
  db.exec("CREATE TABLE player_audit (id INTEGER PRIMARY KEY, playerId TEXT, oldName TEXT, newName TEXT, at INTEGER)");
} catch {}

// トリガー
try {
  db.exec(
    "CREATE TRIGGER player_name_audit AFTER UPDATE ON players BEGIN " +
    "INSERT INTO player_audit (playerId, oldName, newName, at) " +
    "SELECT OLD.id, OLD.name, NEW.name, NOW() FROM NEW; " +
    "END"
  );
} catch {}
```

---

## 注意点 / Limitations
- トリガー本体は `BEGIN ... END` 内の複数文に対応（`;` 区切り）
- `NEW/OLD` はトリガー内でテーブルとして参照できます
- スカラーサブクエリは 1行1列を想定（標準SQL準拠）
- 大量データでは全表走査が基本です

---

## API
- `exec(sql, params?)`: 更新系
- `query<T>(sql, params?)`: 取得系
- `transaction(fn)`: トランザクション
- `getTables()`, `getSchema(name)`
- `getLastInsertId()`, `changes()`, `totalChanges()`
- `export()`, `import()`

---

## License
MIT
