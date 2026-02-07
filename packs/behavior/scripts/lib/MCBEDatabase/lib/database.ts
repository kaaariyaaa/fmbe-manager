import type {
  ColumnDef,
  DatabaseSnapshotV1,
  ParsedQuery,
  Row,
  SelectQuery,
  JsonValue,
  SqlPrimitive,
  TableRef,
  TableData,
  TableDef,
  ColumnRef,
  WhereClause,
  WhereNode,
  SelectColumn,
  OrderBySpec,
  SelectExpr,
  ReturnSpec,
  OrderByRef,
  JoinOnNode,
  CteDef,
  SetQuery,
  Expr,
  TriggerDef,
  TriggerTiming,
  TriggerEvent,
} from "./types.js";
import { parseSql, parseWhereExpression } from "./sql.js";
import { WorldDynamicPropertyJsonStore } from "./worldDynamicPropertyStore.js";

function emptySnapshot(): DatabaseSnapshotV1 {
  return { v: 1, tables: {}, triggers: [] };
}

// SQLのLIKEパターン（%:任意長, _:1文字）を正規表現に変換して照合する。
function matchLike(value: string, pattern: string, escapeChar?: string): boolean {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (escapeChar && ch === escapeChar) {
      const next = pattern[i + 1] ?? "";
      out += next.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      i++;
      continue;
    }
    if (ch === "%") {
      out += ".*";
      continue;
    }
    if (ch === "_") {
      out += ".";
      continue;
    }
    out += ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  out += "$";
  const re = new RegExp(out, "i");
  return re.test(value);
}

function stableStringify(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  const keys = Object.keys(value).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, JsonValue>)[k]!)}`);
  return `{${entries.join(",")}}`;
}

function jsonEqual(a: JsonValue, b: JsonValue): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== "object" || typeof b !== "object") return Object.is(a, b);
  return stableStringify(a) === stableStringify(b);
}

function compare(clause: WhereClause, left: JsonValue): boolean {
  const op = clause.op;
  const right = clause.value;
  if (op === "IN") {
    if (!Array.isArray(right)) return false;
    return right.some((v) => jsonEqual(left, v));
  }
  if (op === "BETWEEN") {
    if (!Array.isArray(right) || right.length !== 2) return false;
    const [a, b] = right;
    if (typeof left === "number" && typeof a === "number" && typeof b === "number") return left >= a && left <= b;
    if (typeof left === "string" && typeof a === "string" && typeof b === "string") return left >= a && left <= b;
    return false;
  }
  if (op === "IS_NULL") return left === null || left === undefined;
  if (op === "IS_NOT_NULL") return left !== null && left !== undefined;
  if (op === "LIKE") {
    return typeof left === "string" && typeof right === "string" && matchLike(left, right, clause.escape);
  }

  if (typeof left === "number" && typeof right === "number") {
    if (op === "=") return left === right;
    if (op === "!=") return left !== right;
    if (op === "<") return left < right;
    if (op === "<=") return left <= right;
    if (op === ">") return left > right;
    if (op === ">=") return left >= right;
    return false;
  }

  if (typeof left === "string" && typeof right === "string") {
    if (op === "=") return left === right;
    if (op === "!=") return left !== right;
    if (op === "<") return left < right;
    if (op === "<=") return left <= right;
    if (op === ">") return left > right;
    if (op === ">=") return left >= right;
    return false;
  }

  if (op === "=") return jsonEqual(left, right as JsonValue);
  if (op === "!=") return !jsonEqual(left, right as JsonValue);
  return false;
}

function resolveColumnValue(row: Row, ref: ColumnRef, outerRow?: Row): JsonValue {
  if (ref.table) {
    const direct = row[`${ref.table}.${ref.column}`];
    if (direct !== undefined) return direct;
  }

  if (ref.column in row) return row[ref.column];
  if (outerRow) {
    if (ref.table) {
      const outerDirect = outerRow[`${ref.table}.${ref.column}`];
      if (outerDirect !== undefined) return outerDirect;
    }
    if (ref.column in outerRow) return outerRow[ref.column];
  }
  return row[ref.column];
}

// WHEREは OR で分割されたグループ（中は AND 条件）として評価する。
function rowMatchesWhereBasic(row: Row, where?: WhereNode): boolean {
  if (!where) return true;
  if (where.type === "clause") {
    const value = resolveColumnValue(row, where.clause.column);
    return compare(where.clause, value);
  }
  if (where.type === "not") return !rowMatchesWhereBasic(row, where.node);
  if (where.type === "and") return rowMatchesWhereBasic(row, where.left) && rowMatchesWhereBasic(row, where.right);
  if (where.type === "or") return rowMatchesWhereBasic(row, where.left) || rowMatchesWhereBasic(row, where.right);
  throw new Error("Subqueries are not supported in this context.");
}

function joinMatches(row: Row, on?: JoinOnNode): boolean {
  if (!on) return true;
  if (on.type === "clause") {
    const left = resolveColumnValue(row, on.clause.left);
    const right = resolveColumnValue(row, on.clause.right);
    return Object.is(left, right);
  }
  if (on.type === "not") return !joinMatches(row, on.node);
  if (on.type === "and") return joinMatches(row, on.left) && joinMatches(row, on.right);
  return joinMatches(row, on.left) || joinMatches(row, on.right);
}

function columnKey(ref: ColumnRef): string {
  return ref.table ? `${ref.table}.${ref.column}` : ref.column;
}

function exprKey(expr: SelectExpr, alias?: string): string {
  if (alias) return alias;
  if (expr.type === "column") return columnKey(expr.ref);
  if (expr.type === "subquery") {
    throw new Error("Scalar subquery requires an alias.");
  }
  if (expr.type === "expr") return exprToKey(expr.expr);
  const target = expr.ref ? columnKey(expr.ref) : "*";
  return `${expr.func}(${target})`;
}

function exprToKey(expr: Expr): string {
  if (expr.type === "literal") return JSON.stringify(expr.value);
  if (expr.type === "column") return columnKey(expr.ref);
  if (expr.type === "subquery") return "SUBQUERY";
  return `${expr.name.toUpperCase()}(${expr.args.map(exprToKey).join(",")})`;
}

function projectRow(row: Row, columns: SelectColumn[]): Row {
  const projected: Row = {};
  for (const c of columns) {
    if (c.expr.type === "column") {
      const value = resolveColumnValue(row, c.expr.ref);
      const key = exprKey(c.expr, c.alias);
      projected[key] = value;
    } else {
      const key = exprKey(c.expr, c.alias);
      projected[key] = row[key];
    }
  }
  return projected;
}

function projectReturningRows(rows: Row[], spec: ReturnSpec): Row[] {
  if (spec.columns === "*") return rows.map((r) => ({ ...r }));
  const columns = spec.columns as SelectColumn[];
  return rows.map((r) => projectRow(r, columns));
}

function isOrderByPosition(ref: OrderByRef): ref is { type: "position"; index: number } {
  return typeof (ref as { type?: string }).type === "string" && (ref as { type?: string }).type === "position";
}

const checkCache = new Map<string, WhereNode>();

function validateChecks(table: TableData, row: Row): void {
  for (const col of table.def.columns) {
    if (!col.check) continue;
    let node = checkCache.get(col.check);
    if (!node) {
      node = parseWhereExpression(col.check);
      checkCache.set(col.check, node);
    }
    if (!rowMatchesWhereBasic(row, node)) {
      throw new Error(`CHECK constraint failed: ${col.name}`);
    }
  }

  for (const check of table.def.checks ?? []) {
    let node = checkCache.get(check);
    if (!node) {
      node = parseWhereExpression(check);
      checkCache.set(check, node);
    }
    if (!rowMatchesWhereBasic(row, node)) {
      throw new Error("CHECK constraint failed.");
    }
  }
}

function compareForSort(a: JsonValue, b: JsonValue): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  return stableStringify(a).localeCompare(stableStringify(b));
}

function compareForSortWithNulls(a: JsonValue, b: JsonValue, nulls?: "FIRST" | "LAST"): number {
  if (nulls) {
    const aNull = a === null || a === undefined;
    const bNull = b === null || b === undefined;
    if (aNull && bNull) return 0;
    if (aNull) return nulls === "FIRST" ? -1 : 1;
    if (bNull) return nulls === "FIRST" ? 1 : -1;
  }
  return compareForSort(a, b);
}

function distinctRows(rows: Row[]): Row[] {
  const seen = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    const key = stableStringify(row as JsonValue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function nullRowFromRows(rows: Row[]): Row {
  const out: Row = {};
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!(key in out)) out[key] = null;
    }
  }
  return out;
}

function firstRowValue(row: Row): JsonValue {
  const keys = Object.keys(row);
  if (keys.length === 0) return null;
  return row[keys[0]!] as JsonValue;
}

function rowMatchesUniqueConstraint(
  row: Row,
  other: Row,
  columns: string[]
): boolean {
  for (const col of columns) {
    const a = row[col];
    const b = other[col];
    if (a === null || a === undefined) return false;
    if (b === null || b === undefined) return false;
    if (!Object.is(a, b)) return false;
  }
  return true;
}

function rowKey(row: Row): string {
  return stableStringify(row as JsonValue);
}

function sqlLiteral(value: JsonValue): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    return `'${value.replace(/'/g, "''")}'`;
  }
  return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
}

function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]!;
    if (quote) {
      current += ch;
      if (ch === quote) {
        const next = sql[i + 1];
        if (next === quote) {
          current += next;
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      continue;
    }
    current += ch;
  }
  const trimmed = current.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

function inferColumnDefsFromInsert(columns: string[]): ColumnDef[] {
  return columns.map((name) => ({ name, type: "JSON" }));
}

export interface WorldSqlDatabaseOptions {
  /** Dynamic property prefix (include your namespace). Example: "myaddon:db:main" */
  prefix: string;
  chunkSize?: number;
  maxChunks?: number;
  /** If true, load immediately in constructor. */
  autoload?: boolean;
  /** If false, explicit save() is required to persist changes. */
  autoSave?: boolean;
}

export class WorldSqlDatabase {
  private readonly store: WorldDynamicPropertyJsonStore;
  private readonly autoSave: boolean;
  private snapshot: DatabaseSnapshotV1 = emptySnapshot();
  private dirty = false;
  private lastInsertId: number | null = null;
  private lastChanges = 0;
  private totalChangesValue = 0;

  constructor(options: WorldSqlDatabaseOptions) {
    this.store = new WorldDynamicPropertyJsonStore({
      prefix: options.prefix,
      chunkSize: options.chunkSize,
      maxChunks: options.maxChunks,
    });
    this.autoSave = options.autoSave ?? true;
    if (options.autoload) this.load();
  }

  load(): void {
    const raw = this.store.load();
    if (!raw) {
      this.snapshot = emptySnapshot();
      this.dirty = false;
      return;
    }

    try {
      const parsed = JSON.parse(raw) as DatabaseSnapshotV1;
      if (parsed.v !== 1) throw new Error(`Unsupported DB snapshot version: ${String((parsed as { v?: unknown }).v)}`);
      this.snapshot = parsed;
      if (!this.snapshot.triggers) this.snapshot.triggers = [];
    } catch {
      this.snapshot = emptySnapshot();
    }
    this.dirty = false;
  }

  save(): void {
    if (!this.dirty) return;
    this.store.save(JSON.stringify(this.snapshot));
    this.dirty = false;
  }

  export(): string {
    return JSON.stringify(this.snapshot);
  }

  import(data: string | DatabaseSnapshotV1): void {
    try {
      const snapshot = typeof data === "string" ? (JSON.parse(data) as DatabaseSnapshotV1) : data;
      if (snapshot.v !== 1) throw new Error(`Unsupported DB snapshot version: ${String((snapshot as { v?: unknown }).v)}`);
      if (!snapshot.triggers) snapshot.triggers = [];
      this.snapshot = snapshot;
      this.dirty = true;
      if (this.autoSave) this.save();
    } catch {
      throw new Error("Failed to import database snapshot.");
    }
  }

  clear(): void {
    this.store.clear();
    this.snapshot = emptySnapshot();
    this.dirty = false;
    this.lastInsertId = null;
    this.lastChanges = 0;
    this.totalChangesValue = 0;
  }

  exec(sql: string, params: JsonValue[] = []): { changes: number } {
    const q = parseSql(sql, params);
    const res = this.execute(q);
    return { changes: res.changes };
  }

  query<T extends Row = Row>(sql: string, params: JsonValue[] = []): T[] {
    const q = parseSql(sql, params);
    const res = this.execute(q);
    if (res.rows) return res.rows as T[];
    return [] as T[];
  }

  getTables(): string[] {
    return Object.keys(this.snapshot.tables).sort();
  }

  getSchema(table: string): TableDef | undefined {
    const t = this.snapshot.tables[table];
    if (!t) return undefined;
    return {
      name: t.def.name,
      columns: t.def.columns.map((c) => ({ ...c })),
      primaryKey: t.def.primaryKey,
      autoIncrement: t.def.autoIncrement,
      uniqueConstraints: t.def.uniqueConstraints ? t.def.uniqueConstraints.map((c) => [...c]) : undefined,
      checks: t.def.checks ? [...t.def.checks] : undefined,
    };
  }

  getLastInsertId(): number | null {
    return this.lastInsertId;
  }

  changes(): number {
    return this.lastChanges;
  }

  totalChanges(): number {
    return this.totalChangesValue;
  }

  tableExists(name: string): boolean {
    return Boolean(this.snapshot.tables[name]);
  }

  columnExists(table: string, column: string): boolean {
    const t = this.snapshot.tables[table];
    if (!t) return false;
    return t.def.columns.some((c) => c.name === column);
  }

  rowCount(table: string): number {
    const t = this.snapshot.tables[table];
    if (!t) return 0;
    return t.rows.length;
  }

  transaction<T>(fn: () => T): T {
    const before = JSON.stringify(this.snapshot);
    const dirtyBefore = this.dirty;
    try {
      const out = fn();
      if (this.autoSave) this.save();
      return out;
    } catch (e) {
      try {
        this.snapshot = JSON.parse(before) as DatabaseSnapshotV1;
      } catch {
        this.snapshot = emptySnapshot();
      }
      this.dirty = dirtyBefore;
      throw e;
    }
  }

  private getTable(name: string): TableData | undefined {
    return this.snapshot.tables[name];
  }

  private getTableFromContext(name: string, ctes?: Record<string, TableData>): TableData | undefined {
    if (ctes && ctes[name]) return ctes[name];
    return this.getTable(name);
  }

  private validateValueType(col: ColumnDef, value: JsonValue): void {
    if (value === null || value === undefined) return;
    switch (col.type) {
      case "TEXT":
        if (typeof value !== "string") throw new Error(`Column ${col.name} expects TEXT.`);
        return;
      case "INTEGER":
        if (typeof value !== "number" || !Number.isInteger(value)) {
          throw new Error(`Column ${col.name} expects INTEGER.`);
        }
        return;
      case "REAL":
        if (typeof value !== "number") throw new Error(`Column ${col.name} expects REAL.`);
        return;
      case "BOOLEAN":
        if (typeof value !== "boolean") throw new Error(`Column ${col.name} expects BOOLEAN.`);
        return;
      case "JSON":
        return;
    }
  }

  private primaryKeyColumn(def: TableDef): ColumnDef | undefined {
    if (!def.primaryKey) return undefined;
    return def.columns.find((c) => c.name === def.primaryKey);
  }

  private ensureTable(name: string, columns?: ColumnDef[]): TableData {
    const existing = this.getTable(name);
    if (existing) return existing;
    const def: TableDef = {
      name,
      columns: columns ?? [],
      primaryKey: columns?.find((c) => c.primaryKey)?.name,
      autoIncrement: false,
      uniqueConstraints: [],
      checks: [],
    };
    const pkCol = def.primaryKey ? def.columns.find((c) => c.name === def.primaryKey) : undefined;
    if (pkCol && (pkCol.type === "INTEGER" || pkCol.type === "REAL")) def.autoIncrement = true;
    const table: TableData = { def, rows: [], autoInc: 1 };
    this.snapshot.tables[name] = table;
    this.dirty = true;
    return table;
  }

  private createTable(
    table: string,
    columns: ColumnDef[],
    primaryKey?: string,
    ifNotExists?: boolean,
    uniqueConstraints: string[][] = [],
    checks: string[] = []
  ): void {
    if (this.snapshot.tables[table]) {
      if (ifNotExists) return;
      throw new Error(`Table already exists: ${table}`);
    }
    if (columns.length === 0) throw new Error("CREATE TABLE requires at least one column.");

    const pk = primaryKey ?? columns.find((c) => c.primaryKey)?.name;
    if (pk && !columns.some((c) => c.name === pk)) throw new Error(`PRIMARY KEY column not found: ${pk}`);
    for (const cols of uniqueConstraints) {
      for (const col of cols) {
        if (!columns.some((c) => c.name === col)) {
          throw new Error(`UNIQUE column not found: ${col}`);
        }
      }
    }

    const pkCol = pk ? columns.find((c) => c.name === pk) : undefined;
    const autoIncrement = pkCol ? pkCol.type === "INTEGER" || pkCol.type === "REAL" : false;
    const def: TableDef = { name: table, columns, primaryKey: pk, autoIncrement, uniqueConstraints, checks };
    this.snapshot.tables[table] = { def, rows: [], autoInc: 1 };
    this.dirty = true;
  }

  private dropTable(table: string, ifExists?: boolean): void {
    if (!this.snapshot.tables[table]) {
      if (ifExists) return;
      throw new Error(`Table not found: ${table}`);
    }
    delete this.snapshot.tables[table];
    this.dirty = true;
  }

  private createTableAsSelect(
    table: string,
    select: SelectQuery | SetQuery,
    ifNotExists?: boolean,
    ctes?: Record<string, TableData>
  ): void {
    if (this.snapshot.tables[table]) {
      if (ifNotExists) return;
      throw new Error(`Table already exists: ${table}`);
    }
    const rows = this.runSelectLike(select, undefined, ctes);
    let columns: ColumnDef[] = [];
    if (rows.length > 0) {
      columns = Object.keys(rows[0]!).map((name) => ({ name, type: "JSON" }));
    } else {
      const baseColumns = this.selectColumnsForEmpty(select);
      if (!baseColumns) {
        throw new Error("CREATE TABLE AS SELECT requires explicit columns when result is empty.");
      }
      columns = baseColumns.map((c) => ({
        name: exprKey(c.expr, c.alias),
        type: "JSON",
      }));
    }
    const def: TableDef = {
      name: table,
      columns,
      primaryKey: undefined,
      autoIncrement: false,
      uniqueConstraints: [],
      checks: [],
    };
    this.snapshot.tables[table] = { def, rows: rows.map((r) => ({ ...r })), autoInc: 1 };
    this.dirty = true;
  }

  private selectColumnsForEmpty(query: SelectQuery | SetQuery): SelectColumn[] | null {
    if (query.type === "select") {
      if (query.columns === "*") return null;
      return query.columns as SelectColumn[];
    }
    return this.selectColumnsForEmpty(query.left);
  }

  private runSelectLike(
    query: SelectQuery | SetQuery,
    outerRow?: Row,
    ctes?: Record<string, TableData>
  ): Row[] {
    if (query.type === "set") return this.executeSetQuery(query, outerRow, ctes);
    return this.select(query, outerRow, ctes);
  }

  private executeSetQuery(query: SetQuery, outerRow?: Row, ctes?: Record<string, TableData>): Row[] {
    const leftRows = this.runSelectLike(query.left, outerRow, ctes);
    const rightRows = this.runSelectLike(query.right, outerRow, ctes);

    if (query.op === "UNION") {
      if (query.all) return [...leftRows, ...rightRows];
      return distinctRows([...leftRows, ...rightRows]);
    }

    if (query.op === "INTERSECT") {
      const rightCounts = new Map<string, number>();
      for (const row of rightRows) {
        const key = rowKey(row);
        rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
      }
      const out: Row[] = [];
      const seen = new Set<string>();
      for (const row of leftRows) {
        const key = rowKey(row);
        const count = rightCounts.get(key) ?? 0;
        if (count <= 0) continue;
        if (query.all) {
          out.push(row);
          rightCounts.set(key, count - 1);
        } else if (!seen.has(key)) {
          out.push(row);
          seen.add(key);
        }
      }
      return out;
    }

    const rightCounts = new Map<string, number>();
    for (const row of rightRows) {
      const key = rowKey(row);
      rightCounts.set(key, (rightCounts.get(key) ?? 0) + 1);
    }
    const out: Row[] = [];
    const seen = new Set<string>();
    for (const row of leftRows) {
      const key = rowKey(row);
      const count = rightCounts.get(key) ?? 0;
      if (query.all) {
        if (count > 0) {
          rightCounts.set(key, count - 1);
          continue;
        }
        out.push(row);
      } else {
        if (count > 0) continue;
        if (!seen.has(key)) {
          out.push(row);
          seen.add(key);
        }
      }
    }
    return out;
  }

  private createCteTableData(cte: CteDef, rows: Row[]): TableData {
    let columns: ColumnDef[] = [];
    if (rows.length > 0) {
      columns = Object.keys(rows[0]!).map((name) => ({ name, type: "JSON" }));
    } else {
      const baseColumns = this.selectColumnsForEmpty(cte.query);
      if (baseColumns) {
        columns = baseColumns.map((c) => ({
          name: exprKey(c.expr, c.alias),
          type: "JSON",
        }));
      }
    }
    return {
      def: {
        name: cte.name,
        columns,
        primaryKey: undefined,
        autoIncrement: false,
        uniqueConstraints: [],
        checks: [],
      },
      rows: rows.map((r) => ({ ...r })),
      autoInc: 1,
    };
  }

  private createSingleRowTable(name: string, row: Row): TableData {
    const columns = Object.keys(row).map((col) => ({ name: col, type: "JSON" as const }));
    return {
      def: {
        name,
        columns,
        primaryKey: undefined,
        autoIncrement: false,
        uniqueConstraints: [],
        checks: [],
      },
      rows: [{ ...row }],
      autoInc: 1,
    };
  }

  private replaceTriggerRefs(statement: string, newRow?: Row, oldRow?: Row): string {
    let out = "";
    let i = 0;
    let quote: "'" | "\"" | null = null;
    while (i < statement.length) {
      const ch = statement[i]!;
      if (quote) {
        out += ch;
        if (ch === quote) {
          const next = statement[i + 1];
          if (next === quote) {
            out += next;
            i += 2;
            continue;
          }
          quote = null;
        }
        i++;
        continue;
      }
      if (ch === "'" || ch === "\"") {
        quote = ch;
        out += ch;
        i++;
        continue;
      }
      const slice = statement.slice(i, i + 4).toUpperCase();
      if (slice === "NEW." || slice === "OLD.") {
        const isNew = slice === "NEW.";
        const start = i + 4;
        let j = start;
        while (j < statement.length && /[A-Za-z0-9_]/.test(statement[j]!)) j++;
        const col = statement.slice(start, j);
        const source = isNew ? newRow : oldRow;
        const value = source ? (source[col] as JsonValue) : null;
        out += sqlLiteral(value);
        i = j;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  private fireTriggers(
    timing: TriggerTiming,
    event: TriggerEvent,
    table: string,
    newRow?: Row,
    oldRow?: Row
  ): void {
    const triggers = this.snapshot.triggers ?? [];
    for (const trigger of triggers) {
      if (trigger.table !== table) continue;
      if (trigger.timing !== timing) continue;
      if (trigger.event !== event) continue;
      const sql = this.replaceTriggerRefs(trigger.statement, newRow, oldRow);
      const statements = splitStatements(sql);
      const ctes: Record<string, TableData> = {};
      if (newRow) ctes.NEW = this.createSingleRowTable("NEW", newRow);
      if (oldRow) ctes.OLD = this.createSingleRowTable("OLD", oldRow);
      for (const stmt of statements) {
        const q = parseSql(stmt);
        this.executeWithCtes(q, ctes);
      }
    }
  }

  private alterTableAddColumn(tableName: string, column: ColumnDef): void {
    const table = this.getTable(tableName);
    if (!table) throw new Error(`Table not found: ${tableName}`);
    if (table.def.columns.some((c) => c.name === column.name)) {
      throw new Error(`Column already exists: ${column.name}`);
    }
    if (column.primaryKey && table.def.primaryKey) {
      throw new Error("PRIMARY KEY already exists.");
    }
    if (column.notNull && column.default === undefined && table.rows.length > 0) {
      throw new Error("NOT NULL column requires DEFAULT when table has rows.");
    }
    if (column.unique && column.default !== undefined && column.default !== null && table.rows.length > 0) {
      throw new Error("UNIQUE column requires unique DEFAULT when table has rows.");
    }
    if (column.default !== undefined) {
      this.validateValueType(column, column.default as JsonValue);
    }
    table.def.columns.push(column);
    if (column.primaryKey) {
      table.def.primaryKey = column.name;
      table.def.autoIncrement = column.type === "INTEGER" || column.type === "REAL";
    }
    for (const row of table.rows) {
      if (column.default !== undefined) row[column.name] = column.default;
      else row[column.name] = null;
    }
    this.dirty = true;
  }

  private alterTableRenameColumn(tableName: string, from: string, to: string): void {
    const table = this.getTable(tableName);
    if (!table) throw new Error(`Table not found: ${tableName}`);
    if (table.def.columns.some((c) => c.name === to)) {
      throw new Error(`Column already exists: ${to}`);
    }
    const col = table.def.columns.find((c) => c.name === from);
    if (!col) throw new Error(`Column not found: ${from}`);
    col.name = to;
    if (table.def.primaryKey === from) table.def.primaryKey = to;
    table.def.uniqueConstraints = (table.def.uniqueConstraints ?? []).map((cols) =>
      cols.map((c) => (c === from ? to : c))
    );
    for (const row of table.rows) {
      if (Object.prototype.hasOwnProperty.call(row, from)) {
        row[to] = row[from];
        delete row[from];
      }
    }
    this.dirty = true;
  }

  private alterTableDropColumn(tableName: string, columnName: string): void {
    const table = this.getTable(tableName);
    if (!table) throw new Error(`Table not found: ${tableName}`);
    const idx = table.def.columns.findIndex((c) => c.name === columnName);
    if (idx < 0) throw new Error(`Column not found: ${columnName}`);
    table.def.columns.splice(idx, 1);
    if (table.def.primaryKey === columnName) {
      table.def.primaryKey = undefined;
      table.def.autoIncrement = false;
    }
    table.def.uniqueConstraints = (table.def.uniqueConstraints ?? []).filter((cols) => !cols.includes(columnName));
    for (const row of table.rows) {
      delete row[columnName];
    }
    this.dirty = true;
  }

  private resolveInsertColumns(table: TableData, columns?: string[]): string[] {
    return columns ?? table.def.columns.map((c) => c.name);
  }

  private findConflictingRows(table: TableData, row: Row): Row[] {
    const pk = table.def.primaryKey;
    const conflicts: Row[] = [];
    for (const existing of table.rows) {
      let conflict = false;
      if (pk && Object.prototype.hasOwnProperty.call(row, pk)) {
        if (Object.is(existing[pk], row[pk])) conflict = true;
      }
      if (!conflict) {
        for (const col of table.def.columns) {
          if (!col.unique) continue;
          if (!Object.prototype.hasOwnProperty.call(row, col.name)) continue;
          if (Object.is(existing[col.name], row[col.name])) {
            conflict = true;
            break;
          }
        }
      }
      if (!conflict) {
        for (const cols of table.def.uniqueConstraints ?? []) {
          if (!cols.every((c) => Object.prototype.hasOwnProperty.call(row, c))) continue;
          if (rowMatchesUniqueConstraint(row, existing, cols)) {
            conflict = true;
            break;
          }
        }
      }
      if (conflict) conflicts.push(existing);
    }
    return conflicts;
  }

  private insertRow(
    tableName: string,
    columns: string[],
    values: JsonValue[],
    orAction?: "REPLACE" | "IGNORE"
  ): Row | null {
    const table = this.getTable(tableName) ?? this.ensureTable(tableName, inferColumnDefsFromInsert(columns));
    const row: Row = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]!] = values[i]!;

    for (const col of table.def.columns) {
      const current = row[col.name];
      if (current === undefined && col.default !== undefined) row[col.name] = col.default;
      if ((current === undefined || current === null) && col.notNull) {
        throw new Error(`Column ${col.name} is NOT NULL.`);
      }
      if (row[col.name] !== undefined) this.validateValueType(col, row[col.name] as JsonValue);
    }
    validateChecks(table, row);

    const pk = table.def.primaryKey;
    if (pk && row[pk] === undefined) {
      const pkCol = this.primaryKeyColumn(table.def);
      if (!pkCol || !(pkCol.type === "INTEGER" || pkCol.type === "REAL")) {
        throw new Error(`PRIMARY KEY ${pk} must be provided for non-numeric type.`);
      }
      row[pk] = table.autoInc++;
      this.lastInsertId = row[pk] as number;
    }

    if (pk) {
      const pkCol = this.primaryKeyColumn(table.def);
      if (pkCol && (pkCol.type === "INTEGER" || pkCol.type === "REAL")) {
        if (typeof row[pk] !== "number") throw new Error(`PRIMARY KEY ${pk} must be a number.`);
        if (typeof row[pk] === "number" && row[pk] >= table.autoInc) {
          table.autoInc = Math.floor(row[pk] as number) + 1;
        }
        this.lastInsertId = row[pk] as number;
      }
    }

    const conflicts = this.findConflictingRows(table, row);
    if (conflicts.length > 0) {
      if (orAction === "IGNORE") return null;
      if (orAction === "REPLACE") {
        table.rows = table.rows.filter((r) => !conflicts.includes(r));
      } else {
        if (pk && Object.prototype.hasOwnProperty.call(row, pk)) {
          throw new Error(`Duplicate primary key for table ${tableName}: ${String(row[pk])}`);
        }
        for (const col of table.def.columns) {
          if (!col.unique) continue;
          if (Object.prototype.hasOwnProperty.call(row, col.name)) {
            const dup = table.rows.some((r) => Object.is(r[col.name], row[col.name]));
            if (dup) throw new Error(`Duplicate UNIQUE value for ${col.name}: ${String(row[col.name])}`);
          }
        }
        for (const cols of table.def.uniqueConstraints ?? []) {
          if (!cols.every((c) => Object.prototype.hasOwnProperty.call(row, c))) continue;
          const dup = table.rows.some((r) => rowMatchesUniqueConstraint(row, r, cols));
          if (dup) throw new Error(`Duplicate UNIQUE constraint for (${cols.join(", ")}).`);
        }
      }
    }

    this.fireTriggers("BEFORE", "INSERT", tableName, row);
    table.rows.push(row);
    this.fireTriggers("AFTER", "INSERT", tableName, row);
    this.dirty = true;
    return row;
  }

  private rowWithPrefixes(tableRef: TableRef, source: Row, fillUndefined = false): Row {
    const out: Row = {};
    const aliases = [tableRef.alias, tableRef.name].filter(Boolean) as string[];

    // 元の列名と、"alias.column" の両方で参照できるように複製する。
    const keys = Object.keys(source);
    for (const key of keys) {
      const value = source[key]!;
      for (const t of aliases) out[`${t}.${key}`] = value;
      if (!(key in out)) out[key] = value;
    }

    if (fillUndefined) {
      // ensure prefixed columns exist even when unmatched (LEFT JOIN)
      for (const col of this.getTable(tableRef.name)?.def.columns ?? []) {
        for (const t of aliases) {
          const pref = `${t}.${col.name}`;
          if (!(pref in out)) out[pref] = null;
        }
        if (!(col.name in out)) out[col.name] = null;
      }
    }

    return out;
  }

  // JOIN時は左側の値を優先し、右側のキーが未定義のときだけ埋める。
  private mergeRows(left: Row, right: Row): Row {
    const out: Row = { ...left };
    for (const [k, v] of Object.entries(right)) {
      if (!(k in out)) out[k] = v;
    }
    return out;
  }

  // JOINは中間結果を段階的に構築し、ON条件に一致した行だけを連結する。
  private select(query: SelectQuery, outerRow?: Row, ctes?: Record<string, TableData>): Row[] {
    const baseTable = this.getTableFromContext(query.from.name, ctes);
    if (!baseTable) return [];

    let current: Row[] = baseTable.rows.map((r) => this.rowWithPrefixes(query.from, r));

    for (const join of query.joins ?? []) {
      const rightTable = this.getTableFromContext(join.table.name, ctes);
      const rightRows = rightTable ? rightTable.rows.map((r) => this.rowWithPrefixes(join.table, r)) : [];
      if (join.joinType === "CROSS") {
        const next: Row[] = [];
        for (const leftRow of current) {
          for (const rightRow of rightRows) {
            next.push(this.mergeRows(leftRow, rightRow));
          }
        }
        current = next;
        continue;
      }

      const usingColumns = join.using;
      const usingOn = usingColumns
        ? (() => {
            const rightAlias = join.table.alias ?? join.table.name;
            let node: JoinOnNode | undefined;
            for (const col of usingColumns) {
              const clause: JoinOnNode = {
                type: "clause",
                clause: { left: { column: col }, right: { table: rightAlias, column: col } },
              };
              node = node ? { type: "and", left: node, right: clause } : clause;
            }
            return node;
          })()
        : undefined;

      const on = join.on ?? usingOn;
      const isRightJoin = join.joinType === "RIGHT";
      const isFullJoin = join.joinType === "FULL";
      const primaryRows = isRightJoin ? rightRows : current;
      const secondaryRows = isRightJoin ? current : rightRows;
      const emptyLeft = nullRowFromRows(current);
      const emptyRight = this.rowWithPrefixes(join.table, {}, true);
      const matchedSecondary = new Set<number>();

      const next: Row[] = [];
      // ここで中間結果（current）に対してJOINをかけていく。
      for (const primaryRow of primaryRows) {
        let matched = false;
        for (let i = 0; i < secondaryRows.length; i++) {
          const secondaryRow = secondaryRows[i]!;
          const merged = isRightJoin
            ? this.mergeRows(secondaryRow, primaryRow)
            : this.mergeRows(primaryRow, secondaryRow);
          if (joinMatches(merged, on)) {
            next.push(merged);
            matched = true;
            matchedSecondary.add(i);
          }
        }

        if (!matched) {
          if (!isRightJoin && (join.joinType === "LEFT" || isFullJoin)) {
            next.push(this.mergeRows(primaryRow, emptyRight));
          }
          if (isRightJoin && (join.joinType === "RIGHT" || isFullJoin)) {
            next.push(this.mergeRows(emptyLeft, primaryRow));
          }
        }
      }

      if (isFullJoin) {
        for (let i = 0; i < secondaryRows.length; i++) {
          if (matchedSecondary.has(i)) continue;
          const secondaryRow = secondaryRows[i]!;
          const merged = isRightJoin
            ? this.mergeRows(secondaryRow, emptyRight)
            : this.mergeRows(emptyLeft, secondaryRow);
          next.push(merged);
        }
      }

      current = next;
    }

    let filtered: Row[] = [];
    for (const row of current) {
      if (!this.rowMatchesWhere(row, query.where, outerRow, ctes)) continue;
      filtered.push(row);
    }

    const hasAggregates =
      query.columns !== "*" && query.columns.some((c) => c.expr.type === "aggregate");
    const hasGrouping = Boolean(query.groupBy && query.groupBy.length > 0);
    const hasSubquery = query.columns !== "*" && query.columns.some((c) => c.expr.type === "subquery");

    let out: Row[] = [];

    if (query.columns === "*") {
      out = filtered.map((r) => ({ ...r }));
    } else if (!hasAggregates && !hasGrouping) {
      const selectColumns = query.columns as SelectColumn[];
      out = filtered.map((r) => this.projectSelectRow(r, selectColumns, outerRow, ctes));
    } else {
      if (hasSubquery) throw new Error("Scalar subqueries are not supported with GROUP BY/aggregates.");
      const selectColumns = query.columns as SelectColumn[];
      const groupBy = query.groupBy ?? [];
      const groupKeys = groupBy.map(columnKey);

      for (const c of selectColumns) {
        if (c.expr.type === "column") {
          const key = columnKey(c.expr.ref);
          if (hasAggregates && groupKeys.length === 0) {
            throw new Error(`Column ${key} must be aggregated when using aggregate functions.`);
          }
          if (groupKeys.length > 0 && !groupKeys.includes(key)) {
            throw new Error(`Column ${key} must appear in GROUP BY or be aggregated.`);
          }
        }
      }

      const groups = new Map<string, Row[]>();
      if (filtered.length === 0 && hasAggregates && groupBy.length === 0) {
        groups.set("[]", []);
      } else {
        for (const row of filtered) {
          const key = stableStringify(groupBy.map((g) => resolveColumnValue(row, g)) as JsonValue);
          const list = groups.get(key);
          if (list) list.push(row);
          else groups.set(key, [row]);
        }
      }

      const aggregateValue = (rows: Row[], expr: SelectExpr): JsonValue => {
        if (expr.type !== "aggregate") return null;
        const values = expr.ref ? rows.map((r) => resolveColumnValue(r, expr.ref!)) : [];
        switch (expr.func) {
          case "COUNT":
            if (!expr.ref) return rows.length;
            if (expr.distinct) {
              const seen = new Set<string>();
              for (const v of values) {
                if (v === null || v === undefined) continue;
                seen.add(stableStringify(v as JsonValue));
              }
              return seen.size;
            }
            return values.filter((v) => v !== null && v !== undefined).length;
          case "SUM": {
            let sum = 0;
            let any = false;
            for (const v of values) {
              if (typeof v === "number") {
                sum += v;
                any = true;
              }
            }
            return any ? sum : null;
          }
          case "AVG": {
            let sum = 0;
            let count = 0;
            for (const v of values) {
              if (typeof v === "number") {
                sum += v;
                count++;
              }
            }
            return count > 0 ? sum / count : null;
          }
          case "MIN": {
            let min: JsonValue = null;
            for (const v of values) {
              if (min === null || compareForSort(v, min) < 0) min = v;
            }
            return min;
          }
          case "MAX": {
            let max: JsonValue = null;
            for (const v of values) {
              if (max === null || compareForSort(v, max) > 0) max = v;
            }
            return max;
          }
          default:
            return null;
        }
      };

      for (const [_, rows] of groups) {
        const aggregated: Row = {};
        for (const g of groupBy) {
          const key = columnKey(g);
          aggregated[key] = rows.length > 0 ? resolveColumnValue(rows[0]!, g) : null;
        }
        for (const c of selectColumns) {
          if (c.expr.type === "column") {
            const key = exprKey(c.expr, c.alias);
            aggregated[key] = rows.length > 0 ? resolveColumnValue(rows[0]!, c.expr.ref) : null;
          } else {
            const value = aggregateValue(rows, c.expr);
            const key = exprKey(c.expr, c.alias);
            aggregated[key] = value;
          }
        }

        if (!this.rowMatchesWhere(aggregated, query.having, outerRow, ctes)) continue;
        out.push(this.projectSelectRow(aggregated, selectColumns, outerRow, ctes));
      }
    }

    if (query.distinct) {
      out = distinctRows(out);
    }

    if (query.orderBy && query.orderBy.length > 0) {
      const specs = query.orderBy.map((spec) => {
        if (isOrderByPosition(spec.ref)) {
          if (query.columns === "*") {
            throw new Error("ORDER BY position requires an explicit select list.");
          }
          const columns = query.columns as SelectColumn[];
          const index = spec.ref.index - 1;
          if (index < 0 || index >= columns.length) {
            throw new Error(`ORDER BY position out of range: ${index + 1}`);
          }
          const key = exprKey(columns[index]!.expr, columns[index]!.alias);
          return { ...spec, ref: { column: key } as ColumnRef };
        }
        return spec;
      });
      out = [...out].sort((ra, rb) => {
        for (const spec of specs) {
          const av = resolveColumnValue(ra, spec.ref as ColumnRef);
          const bv = resolveColumnValue(rb, spec.ref as ColumnRef);
          const cmp = compareForSortWithNulls(av, bv, spec.nulls);
          if (cmp !== 0) return spec.direction === "DESC" ? -cmp : cmp;
        }
        return 0;
      });
    }

    if (query.offset !== undefined) {
      out = out.slice(query.offset);
    }
    if (query.limit !== undefined) {
      out = out.slice(0, query.limit);
    }
    return out;
  }

  private projectSelectRow(row: Row, columns: SelectColumn[], outerRow?: Row, ctes?: Record<string, TableData>): Row {
    const projected: Row = {};
    for (const c of columns) {
      if (c.expr.type === "column") {
        const value = resolveColumnValue(row, c.expr.ref, outerRow);
        const key = exprKey(c.expr, c.alias);
        projected[key] = value;
        continue;
      }
      if (c.expr.type === "subquery") {
        const key = exprKey(c.expr, c.alias);
        projected[key] = this.evalScalarSubquery(c.expr.query, outerRow ?? row, ctes);
        continue;
      }
      if (c.expr.type === "expr") {
        const key = exprKey(c.expr, c.alias);
        projected[key] = this.evalExpr(c.expr.expr, row, outerRow, ctes);
        continue;
      }
      const key = exprKey(c.expr, c.alias);
      projected[key] = row[key];
    }
    return projected;
  }

  private evalScalarSubquery(query: SelectQuery | SetQuery, outerRow?: Row, ctes?: Record<string, TableData>): JsonValue {
    const rows = this.runSelectLike(query, outerRow, ctes);
    if (rows.length === 0) return null;
    if (rows.length > 1) throw new Error("Scalar subquery returned more than one row.");
    const row = rows[0]!;
    const keys = Object.keys(row);
    if (keys.length !== 1) throw new Error("Scalar subquery must return exactly one column.");
    return firstRowValue(row);
  }

  private evalExpr(expr: Expr, row: Row, outerRow?: Row, ctes?: Record<string, TableData>): JsonValue {
    if (expr.type === "literal") return expr.value;
    if (expr.type === "column") return resolveColumnValue(row, expr.ref, outerRow);
    if (expr.type === "subquery") return this.evalScalarSubquery(expr.query, outerRow ?? row, ctes);
    const args = expr.args.map((arg) => this.evalExpr(arg, row, outerRow, ctes));
    return this.evalFunction(expr.name, args);
  }

  private evalFunction(name: string, args: JsonValue[]): JsonValue {
    const func = name.toUpperCase();
    const requireArgs = (min: number, max?: number): void => {
      if (args.length < min || (max !== undefined && args.length > max)) {
        throw new Error(`Function ${func} expects ${min}${max !== undefined ? `-${max}` : ""} arguments.`);
      }
    };
    const toNumber = (value: JsonValue): number => {
      if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Function ${func} expects numeric arguments.`);
      return value;
    };
    const toString = (value: JsonValue): string => {
      if (typeof value !== "string") throw new Error(`Function ${func} expects string arguments.`);
      return value;
    };

    switch (func) {
      case "LENGTH":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).length;
      case "LOWER":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).toLowerCase();
      case "UPPER":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).toUpperCase();
      case "TRIM":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).trim();
      case "LTRIM":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).trimStart();
      case "RTRIM":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return toString(args[0]).trimEnd();
      case "SUBSTR": {
        requireArgs(2, 3);
        if (args[0] === null || args[0] === undefined) return null;
        if (args[1] === null || args[1] === undefined) return null;
        const s = toString(args[0]);
        let start = Math.trunc(toNumber(args[1]));
        let index = 0;
        if (start > 0) index = start - 1;
        else if (start < 0) index = s.length + start;
        const len = args.length === 3 ? args[2] : undefined;
        if (len === undefined || len === null) return s.slice(index);
        const count = Math.trunc(toNumber(len));
        return s.slice(index, index + count);
      }
      case "REPLACE":
        requireArgs(3, 3);
        if (args.some((a) => a === null || a === undefined)) return null;
        return toString(args[0]).split(toString(args[1])).join(toString(args[2]));
      case "CONCAT":
        if (args.some((a) => a === null || a === undefined)) return null;
        return args.map((a) => String(a)).join("");
      case "ABS":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return Math.abs(toNumber(args[0]));
      case "ROUND": {
        requireArgs(1, 2);
        if (args[0] === null || args[0] === undefined) return null;
        const value = toNumber(args[0]);
        if (args.length === 1 || args[1] === null || args[1] === undefined) return Math.round(value);
        const digits = Math.trunc(toNumber(args[1]));
        const factor = 10 ** digits;
        return Math.round(value * factor) / factor;
      }
      case "FLOOR":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return Math.floor(toNumber(args[0]));
      case "CEIL":
      case "CEILING":
        requireArgs(1, 1);
        if (args[0] === null || args[0] === undefined) return null;
        return Math.ceil(toNumber(args[0]));
      case "COALESCE":
        for (const arg of args) {
          if (arg !== null && arg !== undefined) return arg;
        }
        return null;
      case "IFNULL":
        requireArgs(2, 2);
        return args[0] !== null && args[0] !== undefined ? args[0] : args[1];
      case "NOW":
        requireArgs(0, 0);
        return Date.now();
      default:
        throw new Error(`Unsupported function: ${func}`);
    }
  }

  private rowMatchesWhere(
    row: Row,
    where?: WhereNode,
    outerRow?: Row,
    ctes?: Record<string, TableData>
  ): boolean {
    if (!where) return true;
    if (where.type === "clause") {
      const value = resolveColumnValue(row, where.clause.column, outerRow);
      return compare(where.clause, value);
    }
    if (where.type === "not") return !this.rowMatchesWhere(row, where.node, outerRow, ctes);
    if (where.type === "and") {
      return this.rowMatchesWhere(row, where.left, outerRow, ctes) && this.rowMatchesWhere(row, where.right, outerRow, ctes);
    }
    if (where.type === "or") return this.rowMatchesWhere(row, where.left, outerRow, ctes) || this.rowMatchesWhere(row, where.right, outerRow, ctes);
    if (where.type === "exists") {
      return this.runSelectLike(where.query, outerRow ?? row, ctes).length > 0;
    }
    if (where.type === "inSubquery") {
      const value = resolveColumnValue(row, where.column, outerRow);
      const rows = this.runSelectLike(where.query, outerRow ?? row, ctes);
      const values: JsonValue[] = [];
      for (const r of rows) {
        if (Object.keys(r).length !== 1) {
          throw new Error("IN subquery must return exactly one column.");
        }
        values.push(firstRowValue(r));
      }
      return values.some((v) => jsonEqual(value, v));
    }
    return false;
  }

  private update(
    tableName: string,
    set: Record<string, JsonValue>,
    where?: WhereNode,
    limit?: number,
    ctes?: Record<string, TableData>
  ): { changes: number; rows: Row[] } {
    const table = this.getTable(tableName);
    if (!table) return { changes: 0, rows: [] };

    const pk = table.def.primaryKey;
    let changed = 0;
    const updatedRows: Row[] = [];
    const max = limit === undefined ? Number.POSITIVE_INFINITY : limit;

    for (const row of table.rows) {
      if (changed >= max) break;
      if (!this.rowMatchesWhere(row, where, undefined, ctes)) continue;

      const nextRow: Row = { ...row, ...set };
      for (const col of table.def.columns) {
        const value = nextRow[col.name];
        if ((value === undefined || value === null) && col.notNull) {
          throw new Error(`Column ${col.name} is NOT NULL.`);
        }
        if (Object.prototype.hasOwnProperty.call(set, col.name)) {
          this.validateValueType(col, value as JsonValue);
        }
      }
      validateChecks(table, nextRow);

      if (pk && Object.prototype.hasOwnProperty.call(set, pk)) {
        const nextPk = set[pk];
        const pkCol = this.primaryKeyColumn(table.def);
        if (pkCol && (pkCol.type === "INTEGER" || pkCol.type === "REAL") && typeof nextPk !== "number") {
          throw new Error(`PRIMARY KEY ${pk} must be a number.`);
        }
        const dup = table.rows.some((r) => r !== row && Object.is(r[pk], nextPk));
        if (dup) throw new Error(`Duplicate primary key for table ${tableName}: ${String(nextPk)}`);
      }

      for (const col of table.def.columns) {
        if (!col.unique) continue;
        if (!Object.prototype.hasOwnProperty.call(set, col.name)) continue;
        const nextValue = nextRow[col.name];
        const dup = table.rows.some((r) => r !== row && Object.is(r[col.name], nextValue));
        if (dup) throw new Error(`Duplicate UNIQUE value for ${col.name}: ${String(nextValue)}`);
      }
      for (const cols of table.def.uniqueConstraints ?? []) {
        const affects = cols.some((c) => Object.prototype.hasOwnProperty.call(set, c));
        if (!affects) continue;
        if (!cols.every((c) => Object.prototype.hasOwnProperty.call(nextRow, c))) continue;
        const dup = table.rows.some((r) => r !== row && rowMatchesUniqueConstraint(nextRow, r, cols));
        if (dup) throw new Error(`Duplicate UNIQUE constraint for (${cols.join(", ")}).`);
      }

      const oldRow = { ...row };
      this.fireTriggers("BEFORE", "UPDATE", tableName, nextRow, oldRow);
      Object.assign(row, set);
      this.fireTriggers("AFTER", "UPDATE", tableName, row, oldRow);
      updatedRows.push({ ...row });
      changed++;
    }

    if (changed > 0) this.dirty = true;
    return { changes: changed, rows: updatedRows };
  }

  private delete(
    tableName: string,
    where?: WhereNode,
    limit?: number,
    ctes?: Record<string, TableData>
  ): { changes: number; rows: Row[] } {
    const table = this.getTable(tableName);
    if (!table) return { changes: 0, rows: [] };

    const kept: Row[] = [];
    const deleted: Row[] = [];
    let remaining = limit === undefined ? Number.POSITIVE_INFINITY : limit;

    for (const row of table.rows) {
      if (remaining > 0 && this.rowMatchesWhere(row, where, undefined, ctes)) {
        this.fireTriggers("BEFORE", "DELETE", tableName, undefined, row);
        deleted.push({ ...row });
        this.fireTriggers("AFTER", "DELETE", tableName, undefined, row);
        remaining--;
        continue;
      }
      kept.push(row);
    }

    table.rows = kept;
    const changed = deleted.length;
    if (changed > 0) this.dirty = true;
    return { changes: changed, rows: deleted };
  }

  private execute(query: ParsedQuery): { rows?: Row[]; changes: number } {
    return this.executeWithCtes(query);
  }

  private executeWithCtes(query: ParsedQuery, ctes?: Record<string, TableData>): { rows?: Row[]; changes: number } {
    switch (query.type) {
      case "createTable":
        if (query.asSelect) {
          this.createTableAsSelect(query.table, query.asSelect, query.ifNotExists, ctes);
        } else {
          this.createTable(
            query.table,
            query.columns,
            query.primaryKey,
            query.ifNotExists,
            query.uniqueConstraints ?? [],
            query.checks ?? []
          );
        }
        this.lastChanges = 0;
        if (this.autoSave) this.save();
        return { changes: 0 };
      case "createTrigger": {
        const existing = this.snapshot.triggers ?? [];
        if (existing.some((t) => t.name === query.trigger.name)) {
          throw new Error(`Trigger already exists: ${query.trigger.name}`);
        }
        existing.push({ ...query.trigger });
        this.snapshot.triggers = existing;
        this.lastChanges = 0;
        this.dirty = true;
        if (this.autoSave) this.save();
        return { changes: 0 };
      }
      case "dropTrigger": {
        const triggers = this.snapshot.triggers ?? [];
        const before = triggers.length;
        const next = triggers.filter((t) => t.name !== query.name);
        if (before === next.length && !query.ifExists) {
          throw new Error(`Trigger not found: ${query.name}`);
        }
        this.snapshot.triggers = next;
        this.lastChanges = 0;
        if (before !== next.length) this.dirty = true;
        if (this.autoSave) this.save();
        return { changes: 0 };
      }
      case "with": {
        const merged: Record<string, TableData> = { ...(ctes ?? {}) };
        for (const cte of query.ctes) {
          const rows = this.runSelectLike(cte.query, undefined, merged);
          merged[cte.name] = this.createCteTableData(cte, rows);
        }
        this.lastChanges = 0;
        return { rows: this.runSelectLike(query.query, undefined, merged), changes: 0 };
      }
      case "dropTable":
        this.dropTable(query.table, query.ifExists);
        this.lastChanges = 0;
        if (this.autoSave) this.save();
        return { changes: 0 };
      case "alterTable": {
        if (query.action.type === "add") {
          this.alterTableAddColumn(query.table, query.action.column);
        } else if (query.action.type === "rename") {
          this.alterTableRenameColumn(query.table, query.action.from, query.action.to);
        } else {
          this.alterTableDropColumn(query.table, query.action.column);
        }
        this.lastChanges = 0;
        if (this.autoSave) this.save();
        return { changes: 0 };
      }
      case "showTables":
        this.lastChanges = 0;
        return { rows: this.getTables().map((name) => ({ name })), changes: 0 };
      case "describeTable": {
        this.lastChanges = 0;
        const table = this.getTable(query.table);
        if (!table) return { rows: [], changes: 0 };
        const rows = table.def.columns.map((col) => ({
          name: col.name,
          type: col.type,
          notNull: Boolean(col.notNull),
          primaryKey: Boolean(col.primaryKey || table.def.primaryKey === col.name),
          unique: Boolean(col.unique),
          default: col.default ?? null,
          check: col.check ?? null,
        }));
        return { rows, changes: 0 };
      }
      case "insert": {
        this.lastInsertId = null;
        let changes = 0;
        const insertedRows: Row[] = [];
        let table = this.getTable(query.table);
        if (!table) {
          if (!query.columns || query.columns.length === 0) {
            throw new Error("INSERT requires column list for new table.");
          }
          table = this.ensureTable(query.table, inferColumnDefsFromInsert(query.columns));
        }

        if (query.defaultValues) {
          if (query.columns && query.columns.length > 0) {
            throw new Error("DEFAULT VALUES cannot specify columns.");
          }
          const row = this.insertRow(query.table, [], [], query.or);
          if (row) {
            insertedRows.push({ ...row });
            changes++;
          }
        } else if (query.values) {
          const insertColumns = this.resolveInsertColumns(table, query.columns);
          for (const values of query.values) {
            if (insertColumns.length !== values.length) {
              throw new Error("INSERT column/value length mismatch.");
            }
            const row = this.insertRow(query.table, insertColumns, values, query.or);
            if (row) {
              insertedRows.push({ ...row });
              changes++;
            }
          }
        } else if (query.select) {
          const rows = this.runSelectLike(query.select, undefined, ctes);
          let selectKeys: string[] = [];
          if (rows.length > 0) {
            selectKeys = Object.keys(rows[0]!);
          } else {
            const baseColumns = this.selectColumnsForEmpty(query.select);
            if (!baseColumns) {
              throw new Error("INSERT ... SELECT requires explicit column list.");
            }
            selectKeys = baseColumns.map((c) => exprKey(c.expr, c.alias));
          }
          const insertColumns = this.resolveInsertColumns(table, query.columns);
          if (selectKeys.length !== insertColumns.length) {
            throw new Error("INSERT ... SELECT column count mismatch.");
          }
          for (const selected of rows) {
            const values = selectKeys.map((k) => selected[k]);
            const row = this.insertRow(query.table, insertColumns, values, query.or);
            if (row) {
              insertedRows.push({ ...row });
              changes++;
            }
          }
        } else {
          throw new Error("INSERT requires VALUES, DEFAULT VALUES, or SELECT.");
        }

        this.lastChanges = changes;
        this.totalChangesValue += changes;
        if (this.autoSave) this.save();
        if (query.returning) {
          return { changes, rows: projectReturningRows(insertedRows, query.returning) };
        }
        return { changes };
      }
      case "select":
        this.lastChanges = 0;
        return { rows: this.select(query, undefined, ctes), changes: 0 };
      case "set":
        this.lastChanges = 0;
        return { rows: this.runSelectLike(query, undefined, ctes), changes: 0 };
      case "update": {
        const res = this.update(query.table, query.set, query.where, query.limit, ctes);
        this.lastChanges = res.changes;
        this.totalChangesValue += res.changes;
        if (this.autoSave) this.save();
        if (query.returning) {
          return { changes: res.changes, rows: projectReturningRows(res.rows, query.returning) };
        }
        return { changes: res.changes };
      }
      case "delete": {
        const res = this.delete(query.table, query.where, query.limit, ctes);
        this.lastChanges = res.changes;
        this.totalChangesValue += res.changes;
        if (this.autoSave) this.save();
        if (query.returning) {
          return { changes: res.changes, rows: projectReturningRows(res.rows, query.returning) };
        }
        return { changes: res.changes };
      }
    }
  }
}
