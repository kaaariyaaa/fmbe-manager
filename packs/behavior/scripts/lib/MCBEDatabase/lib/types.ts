export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type SqlPrimitive = JsonPrimitive;
export type SqlValue = SqlPrimitive;
export type RowValue = JsonValue;
export type Row = Record<string, RowValue>;

export type ColumnType = "TEXT" | "INTEGER" | "REAL" | "BOOLEAN" | "JSON";

export interface ColumnDef {
  name: string;
  type: ColumnType;
  notNull?: boolean;
  primaryKey?: boolean;
  unique?: boolean;
  default?: JsonValue;
  check?: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  primaryKey?: string;
  autoIncrement?: boolean;
  uniqueConstraints?: string[][];
  checks?: string[];
}

export interface TableData {
  def: TableDef;
  rows: Row[];
  autoInc: number;
}

export interface DatabaseSnapshotV1 {
  v: 1;
  tables: Record<string, TableData>;
  triggers?: TriggerDef[];
}

export type WhereOp =
  | "="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "LIKE"
  | "IN"
  | "BETWEEN"
  | "IS_NULL"
  | "IS_NOT_NULL";

export interface WhereClause {
  column: ColumnRef;
  op: WhereOp;
  value: JsonValue | JsonValue[];
  escape?: string;
}

export type WhereNode =
  | { type: "clause"; clause: WhereClause }
  | { type: "and"; left: WhereNode; right: WhereNode }
  | { type: "or"; left: WhereNode; right: WhereNode }
  | { type: "not"; node: WhereNode }
  | { type: "inSubquery"; column: ColumnRef; query: SelectQuery | SetQuery }
  | { type: "exists"; query: SelectQuery | SetQuery };

export interface ColumnRef {
  table?: string; // table name or alias
  column: string;
}

export interface TableRef {
  name: string;
  alias?: string;
}

export interface JoinOnClause {
  left: ColumnRef;
  right: ColumnRef;
}

export type JoinOnNode =
  | { type: "clause"; clause: JoinOnClause }
  | { type: "and"; left: JoinOnNode; right: JoinOnNode }
  | { type: "or"; left: JoinOnNode; right: JoinOnNode }
  | { type: "not"; node: JoinOnNode };

export type JoinType = "INNER" | "LEFT" | "RIGHT" | "FULL" | "CROSS";

export interface JoinClause {
  joinType: JoinType;
  table: TableRef;
  on?: JoinOnNode;
  using?: string[];
}

export interface SelectQuery {
  type: "select";
  from: TableRef;
  joins?: JoinClause[];
  columns: SelectColumn[] | "*";
  where?: WhereNode;
  distinct?: boolean;
  groupBy?: ColumnRef[];
  having?: WhereNode;
  orderBy?: OrderBySpec[];
  offset?: number;
  limit?: number;
}

export interface CteDef {
  name: string;
  query: SelectQuery | SetQuery;
}

export interface SelectColumn {
  expr: SelectExpr;
  alias?: string;
}

export type Expr =
  | { type: "literal"; value: JsonValue }
  | { type: "column"; ref: ColumnRef }
  | { type: "func"; name: string; args: Expr[] }
  | { type: "subquery"; query: SelectQuery | SetQuery };

export type SelectExpr =
  | { type: "column"; ref: ColumnRef }
  | { type: "aggregate"; func: AggregateFunc; ref?: ColumnRef; distinct?: boolean }
  | { type: "subquery"; query: SelectQuery | SetQuery }
  | { type: "expr"; expr: Expr };

export type AggregateFunc = "COUNT" | "SUM" | "AVG" | "MIN" | "MAX";

export type OrderByRef = ColumnRef | { type: "position"; index: number };

export interface OrderBySpec {
  ref: OrderByRef;
  direction: "ASC" | "DESC";
  nulls?: "FIRST" | "LAST";
}

export interface ReturnSpec {
  columns: "*" | SelectColumn[];
}

export interface CreateTableQuery {
  type: "createTable";
  table: string;
  columns: ColumnDef[];
  primaryKey?: string;
  ifNotExists?: boolean;
  uniqueConstraints?: string[][];
  checks?: string[];
  asSelect?: SelectQuery | SetQuery;
}

export interface DropTableQuery {
  type: "dropTable";
  table: string;
  ifExists?: boolean;
}

export type AlterTableAction =
  | { type: "add"; column: ColumnDef }
  | { type: "rename"; from: string; to: string }
  | { type: "drop"; column: string };

export interface AlterTableQuery {
  type: "alterTable";
  table: string;
  action: AlterTableAction;
}

export interface ShowTablesQuery {
  type: "showTables";
}

export interface DescribeTableQuery {
  type: "describeTable";
  table: string;
}

export interface WithQuery {
  type: "with";
  ctes: CteDef[];
  query: SelectQuery | SetQuery;
}

export type SetOp = "UNION" | "INTERSECT" | "EXCEPT";

export interface SetQuery {
  type: "set";
  left: SelectQuery | SetQuery;
  op: SetOp;
  right: SelectQuery | SetQuery;
  all?: boolean;
}

export type TriggerTiming = "BEFORE" | "AFTER";
export type TriggerEvent = "INSERT" | "UPDATE" | "DELETE";

export interface TriggerDef {
  name: string;
  table: string;
  timing: TriggerTiming;
  event: TriggerEvent;
  statement: string;
}

export interface CreateTriggerQuery {
  type: "createTrigger";
  trigger: TriggerDef;
}

export interface DropTriggerQuery {
  type: "dropTrigger";
  name: string;
  ifExists?: boolean;
}

export interface InsertQuery {
  type: "insert";
  table: string;
  columns?: string[];
  values?: JsonValue[][];
  select?: SelectQuery | SetQuery;
  defaultValues?: boolean;
  or?: "REPLACE" | "IGNORE";
  returning?: ReturnSpec;
}

export interface UpdateQuery {
  type: "update";
  table: string;
  set: Record<string, JsonValue>;
  where?: WhereNode;
  limit?: number;
  returning?: ReturnSpec;
}

export interface DeleteQuery {
  type: "delete";
  table: string;
  where?: WhereNode;
  limit?: number;
  returning?: ReturnSpec;
}

export type ParsedQuery =
  | WithQuery
  | SelectQuery
  | SetQuery
  | CreateTableQuery
  | DropTableQuery
  | AlterTableQuery
  | ShowTablesQuery
  | DescribeTableQuery
  | CreateTriggerQuery
  | DropTriggerQuery
  | InsertQuery
  | UpdateQuery
  | DeleteQuery;
