# mcbe-db

This is a lightweight SQL-like database library for Minecraft Bedrock Edition (Script API). It persists data using `world.getDynamicProperty`.

Japanese README: [README.md](README.md)

---

## Features
- Persistent storage via World Dynamic Property
- CREATE / DROP / ALTER TABLE (ADD/RENAME/DROP COLUMN)
- INSERT / UPDATE / DELETE / SELECT
- JOIN: INNER / LEFT / RIGHT / FULL / CROSS / USING / ON (AND/OR)
- WHERE: AND / OR / NOT / IN / LIKE / BETWEEN / IS NULL
- GROUP BY / HAVING / DISTINCT
- ORDER BY (position, NULLS FIRST/LAST)
- LIMIT / OFFSET / TOP / FETCH FIRST
- Aggregates: COUNT / SUM / AVG / MIN / MAX (COUNT DISTINCT)
- Subqueries (IN / EXISTS / scalar in SELECT)
- CTE (WITH)
- UNION / INTERSECT / EXCEPT (ALL supported)
- Triggers (BEFORE/AFTER, INSERT/UPDATE/DELETE)
- Common functions: LENGTH / LOWER / UPPER / TRIM / SUBSTR / REPLACE / CONCAT / ABS / ROUND / FLOOR / CEIL / COALESCE / IFNULL / NOW

---

## Install
Clone this repository into your project's `libs` directory.

Example:
```sh
git clone https://github.com/kaaariyaaa/MCBEDatabase.git libs/MCBEDatabase
```

This repo includes prebuilt `lib/` output, so you can use it directly from JS.
When you update the library, run `npm run build:lib` to regenerate.

---

## Basic Usage

```ts
import { WorldSqlDatabase } from "../libs/MCBEDatabase/lib/index.js";

const db = new WorldSqlDatabase({ prefix: "mcbedatabase:db:main" });
db.load();

// Create table
try {
  db.exec("CREATE TABLE players (id TEXT PRIMARY KEY, name TEXT, joinCount INTEGER, lastJoin INTEGER)");
} catch {
  // already exists
}

// Insert
const now = Date.now();
db.exec("INSERT INTO players (id, name, joinCount, lastJoin) VALUES (?, ?, ?, ?)", ["p1", "Steve", 1, now]);

// Update
const rows = db.query("SELECT joinCount FROM players WHERE id = ?", ["p1"]);
const next = (rows[0]?.joinCount ?? 0) + 1;
db.exec("UPDATE players SET joinCount = ?, lastJoin = ? WHERE id = ?", [next, now, "p1"]);

// Query
const list = db.query("SELECT id, name, joinCount FROM players ORDER BY joinCount DESC LIMIT 5");
```

---

## Trigger Example

```ts
try {
  db.exec("CREATE TABLE player_audit (id INTEGER PRIMARY KEY, playerId TEXT, oldName TEXT, newName TEXT, at INTEGER)");
} catch {}

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

## Limitations
- Trigger body supports multiple statements separated by `;`
- `NEW/OLD` can be used as tables inside trigger bodies
- Scalar subquery is expected to return 1 row / 1 column
- Query engine is table-scan based

---

## API
- `exec(sql, params?)`
- `query<T>(sql, params?)`
- `transaction(fn)`
- `getTables()`, `getSchema(name)`
- `getLastInsertId()`, `changes()`, `totalChanges()`
- `export()`, `import()`

---

## License
MIT
