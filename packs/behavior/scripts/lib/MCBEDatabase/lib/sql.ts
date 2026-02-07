import type {
  ColumnDef,
  ColumnRef,
  ColumnType,
  JoinClause,
  JoinOnNode,
  JoinType,
  ParsedQuery,
  JsonValue,
  SqlPrimitive,
  TableRef,
  WhereClause,
  WhereNode,
  WhereOp,
  SelectColumn,
  OrderBySpec,
  SelectExpr,
  AggregateFunc,
  ReturnSpec,
  SelectQuery,
  OrderByRef,
  AlterTableAction,
  CreateTableQuery,
  CteDef,
  WithQuery,
  SetOp,
  SetQuery,
  Expr,
  TriggerDef,
  CreateTriggerQuery,
  DropTriggerQuery,
} from "./types.js";

type TokenType = "ident" | "number" | "string" | "symbol" | "op" | "placeholder" | "eof";
interface Token {
  type: TokenType;
  value: string;
  index: number;
  line: number;
  col: number;
}

function isIdentStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch);
}
function isIdentChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch);
}

function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;

  const push = (type: TokenType, value: string, startIndex: number, startLine: number, startCol: number) =>
    tokens.push({ type, value, index: startIndex, line: startLine, col: startCol });

  const s = sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");

  while (i < s.length) {
    const ch = s[i]!;
    if (/\s/.test(ch)) {
      if (ch === "\n") {
        line++;
        col = 1;
      } else {
        col++;
      }
      i++;
      continue;
    }

    const startIndex = i;
    const startLine = line;
    const startCol = col;

    const readEscaped = (delim: string): string => {
      let out = "";
      i++;
      col++;
      while (i < s.length) {
        const c = s[i]!;
        if (c === delim) {
          if (s[i + 1] === delim) {
            out += delim;
            i += 2;
            col += 2;
            continue;
          }
          i++;
          col++;
          break;
        }
        if (c === "\\") {
          const next = s[i + 1] ?? "";
          if (next === "n") out += "\n";
          else if (next === "t") out += "\t";
          else if (next === "r") out += "\r";
          else if (next === "0") out += "\0";
          else if (next === "\\" || next === "'" || next === "\"") out += next;
          else out += next;
          i += 2;
          col += 2;
          continue;
        }
        out += c;
        i++;
        col++;
      }
      return out;
    };

    if (ch === "'" || ch === "\"") {
      const out = readEscaped(ch);
      push("string", out, startIndex, startLine, startCol);
      continue;
    }

    if (ch === "`") {
      i++;
      col++;
      let out = "";
      while (i < s.length) {
        const c = s[i]!;
        if (c === "`") {
          i++;
          col++;
          break;
        }
        out += c;
        i++;
        col++;
      }
      push("ident", out, startIndex, startLine, startCol);
      continue;
    }

    if (ch === "?") {
      i++;
      col++;
      push("placeholder", "?", startIndex, startLine, startCol);
      continue;
    }

    const two = s.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "!=" || two === "<>") {
      i += 2;
      col += 2;
      push("op", two, startIndex, startLine, startCol);
      continue;
    }
    if (ch === "=" || ch === "<" || ch === ">") {
      i++;
      col++;
      push("op", ch, startIndex, startLine, startCol);
      continue;
    }

    if (ch === "(" || ch === ")" || ch === "," || ch === "*" || ch === ";" || ch === ".") {
      i++;
      col++;
      push("symbol", ch, startIndex, startLine, startCol);
      continue;
    }

    const numberStart = (ch === "-" && /[0-9]/.test(s[i + 1] ?? "")) || /[0-9]/.test(ch);
    if (numberStart) {
      let j = i;
      if (s[j] === "-") j++;
      if (s[j] === "0" && (s[j + 1] === "x" || s[j + 1] === "X")) {
        j += 2;
        let hexCount = 0;
        while (j < s.length && /[0-9a-fA-F]/.test(s[j]!)) {
          j++;
          hexCount++;
        }
        if (hexCount === 0) throw new Error("Invalid hex number literal.");
        const text = s.slice(i, j);
        push("number", text, startIndex, startLine, startCol);
        col += j - i;
        i = j;
        continue;
      }

      let digitCount = 0;
      let dotSeen = false;
      let expSeen = false;
      while (j < s.length) {
        const c = s[j]!;
        if (/[0-9]/.test(c)) {
          digitCount++;
          j++;
          continue;
        }
        if (c === ".") {
          if (dotSeen || expSeen) throw new Error("Invalid number literal: unexpected dot.");
          dotSeen = true;
          j++;
          continue;
        }
        if (c === "e" || c === "E") {
          if (expSeen) throw new Error("Invalid number literal: duplicate exponent.");
          expSeen = true;
          j++;
          if (s[j] === "+" || s[j] === "-") j++;
          let expDigits = 0;
          while (j < s.length && /[0-9]/.test(s[j]!)) {
            expDigits++;
            j++;
          }
          if (expDigits === 0) throw new Error("Invalid number literal: missing exponent digits.");
          break;
        }
        break;
      }
      if (digitCount === 0) throw new Error("Invalid number literal: missing digits.");
      if (s[j - 1] === ".") throw new Error("Invalid number literal: trailing dot.");
      push("number", s.slice(i, j), startIndex, startLine, startCol);
      col += j - i;
      i = j;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < s.length && isIdentChar(s[j]!)) j++;
      push("ident", s.slice(i, j), startIndex, startLine, startCol);
      col += j - i;
      i = j;
      continue;
    }

    throw new Error(`Unexpected SQL character: ${ch} at ${startLine}:${startCol}`);
  }

  push("eof", "", i, line, col);
  return tokens;
}

class Cursor {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly params: JsonValue[]) {}

  peek(): Token {
    return this.tokens[this.index]!;
  }

  next(): Token {
    const t = this.tokens[this.index]!;
    this.index++;
    return t;
  }

  peekNext(): Token {
    return this.tokens[this.index + 1] ?? this.tokens[this.index]!;
  }

  expect(type: TokenType, value?: string): Token {
    const t = this.next();
    if (t.type !== type) throw new Error(`Expected ${type} but got ${t.type} (${t.value}) at ${t.line}:${t.col}`);
    if (value !== undefined && t.value.toUpperCase() !== value.toUpperCase()) {
      throw new Error(`Expected ${value} but got ${t.value} at ${t.line}:${t.col}`);
    }
    return t;
  }

  matchIdent(value: string): boolean {
    const t = this.peek();
    return t.type === "ident" && t.value.toUpperCase() === value.toUpperCase();
  }

  matchSymbol(value: string): boolean {
    const t = this.peek();
    return t.type === "symbol" && t.value === value;
  }

  matchOp(value: string): boolean {
    const t = this.peek();
    return t.type === "op" && t.value === value;
  }

  parseIdent(): string {
    return this.expect("ident").value;
  }

  parseColumnRef(): ColumnRef {
    const first = this.parseIdent();
    if (this.matchSymbol(".")) {
      this.next();
      const second = this.parseIdent();
      return { table: first, column: second };
    }
    return { column: first };
  }

  parseValue(): JsonValue {
    const t = this.next();
    if (t.type === "placeholder") {
      if (this.params.length === 0) throw new Error("Missing SQL params for placeholder.");
      return this.params.shift() as JsonValue;
    }
    if (t.type === "string") return t.value;
    if (t.type === "number") {
      const n = Number(t.value);
      if (!Number.isFinite(n)) throw new Error(`Invalid number literal: ${t.value}`);
      return n;
    }
    if (t.type === "ident") {
      const upper = t.value.toUpperCase();
      if (upper === "TRUE") return true;
      if (upper === "FALSE") return false;
      if (upper === "NULL") return null;
    }
    throw new Error(`Expected value but got ${t.type} (${t.value})`);
  }
}

function assertEof(cursor: Cursor): void {
  if (cursor.matchSymbol(";")) cursor.next();
  if (cursor.peek().type !== "eof") throw new Error("Unexpected token after SQL statement.");
}

function parseColumnType(typeIdent: string): ColumnType {
  const upper = typeIdent.toUpperCase();
  if (upper === "TEXT" || upper === "INTEGER" || upper === "REAL" || upper === "BOOLEAN" || upper === "JSON") {
    return upper;
  }
  throw new Error(`Unsupported column type: ${typeIdent}`);
}

function parseCheckExpression(cursor: Cursor, sql: string): string {
  cursor.expect("symbol", "(");
  const start = cursor.peek().index;
  let depth = 1;
  let end = start;
  while (depth > 0) {
    const t = cursor.next();
    if (t.type === "symbol" && t.value === "(") depth++;
    if (t.type === "symbol" && t.value === ")") depth--;
    if (t.type === "eof") throw new Error("Unterminated CHECK expression.");
    end = t.index;
  }
  return sql.slice(start, end).trim();
}

function parseColumnDef(cursor: Cursor, sql: string): ColumnDef {
  const name = cursor.parseIdent();
  const type = parseColumnType(cursor.parseIdent());
  const col: ColumnDef = { name, type };
  while (true) {
    if (cursor.matchIdent("PRIMARY")) {
      cursor.next();
      cursor.expect("ident", "KEY");
      col.primaryKey = true;
      continue;
    }
    if (cursor.matchIdent("NOT")) {
      cursor.next();
      cursor.expect("ident", "NULL");
      col.notNull = true;
      continue;
    }
    if (cursor.matchIdent("UNIQUE")) {
      cursor.next();
      col.unique = true;
      continue;
    }
    if (cursor.matchIdent("DEFAULT")) {
      cursor.next();
      col.default = cursor.parseValue();
      continue;
    }
    if (cursor.matchIdent("CHECK")) {
      cursor.next();
      col.check = parseCheckExpression(cursor, sql);
      continue;
    }
    break;
  }
  return col;
}

function isSqlPrimitive(value: JsonValue): value is SqlPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseCondition(cursor: Cursor): WhereNode {
  const parseClauseNode = (): WhereNode => {
    if (cursor.matchIdent("EXISTS")) {
      cursor.next();
      cursor.expect("symbol", "(");
      cursor.expect("ident", "SELECT");
      const query = parseSelectOrSetAfterSelect(cursor);
      cursor.expect("symbol", ")");
      return { type: "exists", query };
    }

    const column = cursor.parseColumnRef();
    let opToken = cursor.peek();
    let op: WhereOp;

    if (opToken.type === "op") {
      opToken = cursor.next();
      op = (opToken.value === "<>" ? "!=" : opToken.value) as WhereOp;
      if (!["=", "!=", "<", "<=", ">", ">="].includes(op)) throw new Error(`Unsupported operator: ${op}`);
      const value = cursor.parseValue();
      if (!isSqlPrimitive(value) && op !== "=" && op !== "!=") {
        throw new Error("WHERE value must be a primitive for this operator.");
      }
      return { type: "clause", clause: { column, op, value } };
    }

    if (opToken.type === "ident") {
      const kw = opToken.value.toUpperCase();
      if (kw === "NOT") {
        cursor.next();
        const next = cursor.expect("ident").value.toUpperCase();
        if (next !== "IN" && next !== "LIKE" && next !== "BETWEEN") throw new Error(`Unsupported WHERE operator: NOT ${next}`);
        op = next as WhereOp;
      } else if (kw === "IS") {
        cursor.next();
        let isNot = false;
        if (cursor.matchIdent("NOT")) {
          cursor.next();
          isNot = true;
        }
        const nullKw = cursor.expect("ident").value.toUpperCase();
        if (nullKw !== "NULL") throw new Error("IS expects NULL.");
        return { type: "clause", clause: { column, op: isNot ? "IS_NOT_NULL" : "IS_NULL", value: null } };
      } else {
        cursor.next();
        op = kw as WhereOp;
      }

      if (op === "LIKE") {
        const value = cursor.parseValue();
        if (typeof value !== "string") throw new Error("LIKE expects a string.");
        let escape: string | undefined;
        if (cursor.matchIdent("ESCAPE")) {
          cursor.next();
          const esc = cursor.parseValue();
          if (typeof esc !== "string" || esc.length !== 1) throw new Error("ESCAPE expects a single character.");
          escape = esc;
        }
        const clause: WhereClause = { column, op, value, escape };
        if (kw === "NOT") return { type: "not", node: { type: "clause", clause } };
        return { type: "clause", clause };
      }

      if (op === "IN") {
        cursor.expect("symbol", "(");
        if (cursor.matchIdent("SELECT")) {
          cursor.next();
          const query = parseSelectOrSetAfterSelect(cursor);
          cursor.expect("symbol", ")");
          const node: WhereNode = { type: "inSubquery", column, query };
          if (kw === "NOT") return { type: "not", node };
          return node;
        }
        const list: SqlPrimitive[] = [];
        if (!cursor.matchSymbol(")")) {
          while (true) {
            const value = cursor.parseValue();
            if (!isSqlPrimitive(value)) throw new Error("IN values must be primitive.");
            list.push(value);
            if (cursor.matchSymbol(",")) {
              cursor.next();
              continue;
            }
            break;
          }
        }
        cursor.expect("symbol", ")");
        const clause: WhereClause = { column, op, value: list };
        if (kw === "NOT") return { type: "not", node: { type: "clause", clause } };
        return { type: "clause", clause };
      }

      if (op === "BETWEEN") {
        const first = cursor.parseValue();
        if (!isSqlPrimitive(first)) throw new Error("BETWEEN expects primitive values.");
        cursor.expect("ident", "AND");
        const second = cursor.parseValue();
        if (!isSqlPrimitive(second)) throw new Error("BETWEEN expects primitive values.");
        const clause: WhereClause = { column, op, value: [first, second] };
        if (kw === "NOT") return { type: "not", node: { type: "clause", clause } };
        return { type: "clause", clause };
      }

      throw new Error(`Unsupported WHERE operator: ${opToken.value}`);
    }

    throw new Error("Invalid WHERE clause.");
  };

  const parsePrimary = (): WhereNode => {
    if (cursor.matchIdent("NOT")) {
      cursor.next();
      return { type: "not", node: parsePrimary() };
    }
    if (cursor.matchSymbol("(")) {
      cursor.next();
      const expr = parseOr();
      cursor.expect("symbol", ")");
      return expr;
    }
    return parseClauseNode();
  };

  const parseAnd = (): WhereNode => {
    let left = parsePrimary();
    while (cursor.matchIdent("AND")) {
      cursor.next();
      const right = parsePrimary();
      left = { type: "and", left, right };
    }
    return left;
  };

  const parseOr = (): WhereNode => {
    let left = parseAnd();
    while (cursor.matchIdent("OR")) {
      cursor.next();
      const right = parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  };

  return parseOr();
}

function parseWhere(cursor: Cursor): WhereNode | undefined {
  if (!cursor.matchIdent("WHERE")) return undefined;
  cursor.next();
  return parseCondition(cursor);
}

export function parseWhereExpression(expression: string): WhereNode {
  const cursor = new Cursor(tokenize(`WHERE ${expression}`), []);
  const where = parseWhere(cursor);
  if (!where) throw new Error("Failed to parse WHERE expression.");
  assertEof(cursor);
  return where;
}

function parseTableRef(cursor: Cursor): TableRef {
  const name = cursor.parseIdent();
  let alias: string | undefined;

  if (cursor.matchIdent("AS")) {
    cursor.next();
    alias = cursor.parseIdent();
  } else if (cursor.peek().type === "ident") {
    const nextUpper = cursor.peek().value.toUpperCase();
    if (
      nextUpper !== "WHERE" &&
      nextUpper !== "GROUP" &&
      nextUpper !== "HAVING" &&
      nextUpper !== "INNER" &&
      nextUpper !== "LEFT" &&
      nextUpper !== "RIGHT" &&
      nextUpper !== "JOIN" &&
      nextUpper !== "LIMIT" &&
      nextUpper !== "OFFSET" &&
      nextUpper !== "ORDER" &&
      nextUpper !== "ON"
    ) {
      alias = cursor.parseIdent();
    }
  }

  return { name, alias };
}

function parseExpr(cursor: Cursor): Expr {
  if (cursor.matchSymbol("(") && cursor.peekNext().type === "ident" && cursor.peekNext().value.toUpperCase() === "SELECT") {
    cursor.next();
    cursor.next();
    const query = parseSelectOrSetAfterSelect(cursor);
    cursor.expect("symbol", ")");
    return { type: "subquery", query };
  }

  const t = cursor.peek();
  if (t.type === "string" || t.type === "number" || t.type === "placeholder") {
    const value = cursor.parseValue();
    return { type: "literal", value };
  }

  if (t.type === "ident") {
    const upper = t.value.toUpperCase();
    if (upper === "TRUE" || upper === "FALSE" || upper === "NULL") {
      const value = cursor.parseValue();
      return { type: "literal", value };
    }
    if (cursor.peekNext().value === "(") {
      const name = cursor.parseIdent();
      cursor.expect("symbol", "(");
      const args: Expr[] = [];
      if (!cursor.matchSymbol(")")) {
        while (true) {
          args.push(parseExpr(cursor));
          if (cursor.matchSymbol(",")) {
            cursor.next();
            continue;
          }
          break;
        }
      }
      cursor.expect("symbol", ")");
      return { type: "func", name, args };
    }
    const ref = cursor.parseColumnRef();
    return { type: "column", ref };
  }

  throw new Error("Invalid expression.");
}

function parseJoinCondition(cursor: Cursor): JoinOnNode {
  const parseClauseNode = (): JoinOnNode => {
    const left = cursor.parseColumnRef();
    if (!cursor.matchOp("=")) throw new Error("JOIN ON supports only '=' comparisons.");
    cursor.next();
    const right = cursor.parseColumnRef();
    return { type: "clause", clause: { left, right } };
  };

  const parsePrimary = (): JoinOnNode => {
    if (cursor.matchIdent("NOT")) {
      cursor.next();
      return { type: "not", node: parsePrimary() };
    }
    if (cursor.matchSymbol("(")) {
      cursor.next();
      const expr = parseOr();
      cursor.expect("symbol", ")");
      return expr;
    }
    return parseClauseNode();
  };

  const parseAnd = (): JoinOnNode => {
    let left = parsePrimary();
    while (cursor.matchIdent("AND")) {
      cursor.next();
      const right = parsePrimary();
      left = { type: "and", left, right };
    }
    return left;
  };

  const parseOr = (): JoinOnNode => {
    let left = parseAnd();
    while (cursor.matchIdent("OR")) {
      cursor.next();
      const right = parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  };

  return parseOr();
}

function parseNonNegativeInt(token: Token): number {
  const n = Number(token.value);
  if (!Number.isInteger(n) || n < 0) throw new Error("Value must be a non-negative integer.");
  return n;
}

function parseLimitOffset(cursor: Cursor): { limit?: number; offset?: number } {
  if (!cursor.matchIdent("LIMIT")) return {};
  cursor.next();
  const first = parseNonNegativeInt(cursor.expect("number"));
  if (cursor.matchSymbol(",")) {
    cursor.next();
    const second = parseNonNegativeInt(cursor.expect("number"));
    return { offset: first, limit: second };
  }
  let offset: number | undefined;
  if (cursor.matchIdent("OFFSET")) {
    cursor.next();
    offset = parseNonNegativeInt(cursor.expect("number"));
  }
  return { limit: first, offset };
}

function parseFetchLimit(cursor: Cursor): number | undefined {
  if (!cursor.matchIdent("FETCH")) return undefined;
  cursor.next();
  if (cursor.matchIdent("FIRST") || cursor.matchIdent("NEXT")) {
    cursor.next();
  } else {
    throw new Error("FETCH expects FIRST or NEXT.");
  }
  const count = parseNonNegativeInt(cursor.expect("number"));
  cursor.expect("ident", "ROWS");
  cursor.expect("ident", "ONLY");
  return count;
}

function parseOrderBySpec(cursor: Cursor): OrderBySpec {
  let ref: OrderByRef;
  if (cursor.peek().type === "number") {
    const pos = parseNonNegativeInt(cursor.next());
    if (pos === 0) throw new Error("ORDER BY position must be >= 1.");
    ref = { type: "position", index: pos };
  } else {
    ref = cursor.parseColumnRef();
  }
  let direction: "ASC" | "DESC" = "ASC";
  if (cursor.matchIdent("ASC")) {
    cursor.next();
    direction = "ASC";
  } else if (cursor.matchIdent("DESC")) {
    cursor.next();
    direction = "DESC";
  }
  let nulls: "FIRST" | "LAST" | undefined;
  if (cursor.matchIdent("NULLS")) {
    cursor.next();
    if (cursor.matchIdent("FIRST")) {
      cursor.next();
      nulls = "FIRST";
    } else if (cursor.matchIdent("LAST")) {
      cursor.next();
      nulls = "LAST";
    } else {
      throw new Error("NULLS expects FIRST or LAST.");
    }
  }
  return { ref, direction, nulls };
}

function parseSelectAfterSelect(cursor: Cursor): SelectQuery {
    let distinct = false;
    let topLimit: number | undefined;
    while (true) {
      if (!distinct && cursor.matchIdent("DISTINCT")) {
        cursor.next();
        distinct = true;
        continue;
      }
      if (topLimit === undefined && cursor.matchIdent("TOP")) {
        cursor.next();
        topLimit = parseNonNegativeInt(cursor.expect("number"));
        continue;
      }
      break;
    }
    let columns: SelectColumn[] | "*" = "*";
    if (cursor.matchSymbol("*")) {
      cursor.next();
    } else {
      columns = [];
      while (true) {
        const expr: SelectExpr = (() => {
          if (cursor.peek().type === "ident") {
            const ident = cursor.peek().value.toUpperCase();
            if (["COUNT", "SUM", "AVG", "MIN", "MAX"].includes(ident) && cursor.peekNext().value === "(") {
              const func = cursor.parseIdent().toUpperCase() as AggregateFunc;
              cursor.expect("symbol", "(");
              let distinctAgg = false;
              if (cursor.matchIdent("DISTINCT")) {
                cursor.next();
                distinctAgg = true;
              }
              if (cursor.matchSymbol("*")) {
                if (distinctAgg) throw new Error("COUNT(DISTINCT *) is not supported.");
                cursor.next();
                cursor.expect("symbol", ")");
                return { type: "aggregate", func };
              }
              const ref = cursor.parseColumnRef();
              cursor.expect("symbol", ")");
              if (distinctAgg && func !== "COUNT") {
                throw new Error("DISTINCT is only supported for COUNT.");
              }
              return { type: "aggregate", func, ref, distinct: distinctAgg || undefined };
            }
          }
          const parsed = parseExpr(cursor);
          if (parsed.type === "column") return { type: "column", ref: parsed.ref };
          if (parsed.type === "subquery") return { type: "subquery", query: parsed.query };
          return { type: "expr", expr: parsed };
        })();
        let alias: string | undefined;
        if (cursor.matchIdent("AS")) {
          cursor.next();
          alias = cursor.parseIdent();
        } else if (cursor.peek().type === "ident") {
          const nextUpper = cursor.peek().value.toUpperCase();
          if (
            nextUpper !== "FROM" &&
            nextUpper !== "WHERE" &&
            nextUpper !== "GROUP" &&
            nextUpper !== "HAVING" &&
            nextUpper !== "ORDER" &&
            nextUpper !== "LIMIT" &&
            nextUpper !== "OFFSET"
          ) {
            alias = cursor.parseIdent();
          }
        }
        if (expr.type === "subquery" && !alias) {
          throw new Error("Scalar subquery in SELECT requires an alias.");
        }
        (columns as SelectColumn[]).push({ expr, alias });
        if (cursor.matchSymbol(",")) {
          cursor.next();
          continue;
        }
        break;
      }
    }
    cursor.expect("ident", "FROM");
    const from = parseTableRef(cursor);

    const joins: JoinClause[] = [];
    while (true) {
      let joinType: JoinType | undefined;
      if (cursor.matchIdent("INNER")) {
        cursor.next();
        joinType = "INNER";
      } else if (cursor.matchIdent("LEFT")) {
        cursor.next();
        joinType = "LEFT";
        if (cursor.matchIdent("OUTER")) cursor.next();
      } else if (cursor.matchIdent("RIGHT")) {
        cursor.next();
        joinType = "RIGHT";
        if (cursor.matchIdent("OUTER")) cursor.next();
      } else if (cursor.matchIdent("FULL")) {
        cursor.next();
        joinType = "FULL";
        if (cursor.matchIdent("OUTER")) cursor.next();
      } else if (cursor.matchIdent("CROSS")) {
        cursor.next();
        joinType = "CROSS";
      }

      if (cursor.matchIdent("JOIN")) {
        cursor.next();
        const table = parseTableRef(cursor);
        if (joinType === "CROSS") {
          joins.push({ joinType, table });
          continue;
        }
        if (cursor.matchIdent("USING")) {
          cursor.next();
          cursor.expect("symbol", "(");
          const columns: string[] = [];
          while (true) {
            columns.push(cursor.parseIdent());
            if (cursor.matchSymbol(",")) {
              cursor.next();
              continue;
            }
            break;
          }
          cursor.expect("symbol", ")");
          joins.push({ joinType: joinType ?? "INNER", table, using: columns });
          continue;
        }
        cursor.expect("ident", "ON");
        const on = parseJoinCondition(cursor);
        joins.push({ joinType: joinType ?? "INNER", table, on });
        continue;
      }

      break;
    }

    const where = parseWhere(cursor);
    let groupBy: ColumnRef[] | undefined;
    if (cursor.matchIdent("GROUP")) {
      cursor.next();
      cursor.expect("ident", "BY");
      groupBy = [];
      while (true) {
        groupBy.push(cursor.parseColumnRef());
        if (cursor.matchSymbol(",")) {
          cursor.next();
          continue;
        }
        break;
      }
    }

    let having: WhereNode | undefined;
    if (cursor.matchIdent("HAVING")) {
      cursor.next();
      having = parseCondition(cursor);
    }
    let orderBy: OrderBySpec[] | undefined;
    if (cursor.matchIdent("ORDER")) {
      cursor.next();
      cursor.expect("ident", "BY");
      orderBy = [];
      while (true) {
        orderBy.push(parseOrderBySpec(cursor));
        if (cursor.matchSymbol(",")) {
          cursor.next();
          continue;
        }
        break;
      }
    }

    const { limit: limitFromLimit, offset: offsetFromLimit } = parseLimitOffset(cursor);
    let offset: number | undefined;
    if (offsetFromLimit !== undefined) {
      offset = offsetFromLimit;
    } else if (cursor.matchIdent("OFFSET")) {
      cursor.next();
      offset = parseNonNegativeInt(cursor.expect("number"));
    }
    let limit = limitFromLimit;
    const fetchLimit = parseFetchLimit(cursor);
    if (fetchLimit !== undefined) {
      if (limit !== undefined) throw new Error("FETCH cannot be combined with LIMIT.");
      limit = fetchLimit;
    }
    if (topLimit !== undefined) {
      if (limit !== undefined) throw new Error("TOP cannot be combined with LIMIT/FETCH.");
      limit = topLimit;
    }

    const q = {
      type: "select",
      from,
      joins: joins.length ? joins : undefined,
      columns,
      where,
      distinct,
      groupBy,
      having,
      orderBy,
      offset,
      limit,
    } as const;
    return q;
  }

function parseReturning(cursor: Cursor): ReturnSpec | undefined {
  if (!cursor.matchIdent("RETURNING")) return undefined;
  cursor.next();
  if (cursor.matchSymbol("*")) {
    cursor.next();
    return { columns: "*" };
  }
  const columns: SelectColumn[] = [];
  while (true) {
    const ref = cursor.parseColumnRef();
    let alias: string | undefined;
    if (cursor.matchIdent("AS")) {
      cursor.next();
      alias = cursor.parseIdent();
    } else if (cursor.peek().type === "ident") {
      const nextUpper = cursor.peek().value.toUpperCase();
      if (
        nextUpper !== "FROM" &&
        nextUpper !== "WHERE" &&
        nextUpper !== "GROUP" &&
        nextUpper !== "HAVING" &&
        nextUpper !== "ORDER" &&
        nextUpper !== "LIMIT" &&
        nextUpper !== "OFFSET" &&
        nextUpper !== "RETURNING"
      ) {
        alias = cursor.parseIdent();
      }
    }
    columns.push({ expr: { type: "column", ref }, alias });
    if (cursor.matchSymbol(",")) {
      cursor.next();
      continue;
    }
    break;
  }
  return { columns };
}

function parseSelectOrSetAfterSelect(cursor: Cursor): SelectQuery | SetQuery {
  let left: SelectQuery | SetQuery = parseSelectAfterSelect(cursor);
  while (true) {
    let op: SetOp | undefined;
    if (cursor.matchIdent("UNION")) op = "UNION";
    else if (cursor.matchIdent("INTERSECT")) op = "INTERSECT";
    else if (cursor.matchIdent("EXCEPT")) op = "EXCEPT";
    if (!op) break;
    cursor.next();
    let all = false;
    if (cursor.matchIdent("ALL")) {
      cursor.next();
      all = true;
    }
    cursor.expect("ident", "SELECT");
    const right = parseSelectAfterSelect(cursor);
    left = { type: "set", left, op, right, all };
  }
  return left;
}

function parseWithClause(cursor: Cursor): CteDef[] {
  cursor.expect("ident", "WITH");
  const ctes: CteDef[] = [];
  while (true) {
    const name = cursor.parseIdent();
    cursor.expect("ident", "AS");
    cursor.expect("symbol", "(");
    cursor.expect("ident", "SELECT");
    const query = parseSelectOrSetAfterSelect(cursor);
    cursor.expect("symbol", ")");
    ctes.push({ name, query });
    if (cursor.matchSymbol(",")) {
      cursor.next();
      continue;
    }
    break;
  }
  return ctes;
}

export function parseSql(sql: string, params: JsonValue[] = []): ParsedQuery {
  const cursor = new Cursor(tokenize(sql), [...params]);

  if (cursor.matchIdent("WITH")) {
    const ctes = parseWithClause(cursor);
    cursor.expect("ident", "SELECT");
    const query = parseSelectOrSetAfterSelect(cursor);
    const q: WithQuery = { type: "with", ctes, query };
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("CREATE")) {
    cursor.next();
    if (cursor.matchIdent("TRIGGER")) {
      cursor.next();
      const name = cursor.parseIdent();
      const timing = cursor.parseIdent().toUpperCase();
      if (timing !== "BEFORE" && timing !== "AFTER") throw new Error("TRIGGER timing must be BEFORE or AFTER.");
      const event = cursor.parseIdent().toUpperCase();
      if (event !== "INSERT" && event !== "UPDATE" && event !== "DELETE") {
        throw new Error("TRIGGER event must be INSERT, UPDATE, or DELETE.");
      }
      cursor.expect("ident", "ON");
      const table = cursor.parseIdent();
      cursor.expect("ident", "BEGIN");
      const start = cursor.peek().index;
      let end = start;
      while (true) {
        const t = cursor.next();
        if (t.type === "ident" && t.value.toUpperCase() === "END") {
          end = t.index;
          break;
        }
        if (t.type === "eof") throw new Error("Unterminated trigger body.");
      }
      let statement = sql.slice(start, end).trim();
      if (statement.endsWith(";")) statement = statement.slice(0, -1).trim();
      const trigger: TriggerDef = {
        name,
        table,
        timing: timing as TriggerDef["timing"],
        event: event as TriggerDef["event"],
        statement,
      };
      const q: CreateTriggerQuery = { type: "createTrigger", trigger };
      assertEof(cursor);
      return q;
    }
    cursor.expect("ident", "TABLE");
    let ifNotExists = false;
    if (cursor.matchIdent("IF")) {
      cursor.next();
      cursor.expect("ident", "NOT");
      cursor.expect("ident", "EXISTS");
      ifNotExists = true;
    }
    const table = cursor.parseIdent();
    if (cursor.matchIdent("AS")) {
      cursor.next();
      cursor.expect("ident", "SELECT");
      const asSelect = parseSelectOrSetAfterSelect(cursor);
      const q: CreateTableQuery = { type: "createTable", table, columns: [], ifNotExists, asSelect };
      assertEof(cursor);
      return q;
    }

    cursor.expect("symbol", "(");

    const columns: ColumnDef[] = [];
    let primaryKey: string | undefined;
    const uniqueConstraints: string[][] = [];
    const checks: string[] = [];

    while (true) {
      let hadConstraintName = false;
      if (cursor.matchIdent("CONSTRAINT")) {
        cursor.next();
        cursor.parseIdent();
        hadConstraintName = true;
      }

      if (cursor.matchIdent("PRIMARY")) {
        cursor.next();
        cursor.expect("ident", "KEY");
        cursor.expect("symbol", "(");
        primaryKey = cursor.parseIdent();
        cursor.expect("symbol", ")");
      } else if (cursor.matchIdent("UNIQUE")) {
        cursor.next();
        cursor.expect("symbol", "(");
        const cols: string[] = [];
        while (true) {
          cols.push(cursor.parseIdent());
          if (cursor.matchSymbol(",")) {
            cursor.next();
            continue;
          }
          break;
        }
        cursor.expect("symbol", ")");
        uniqueConstraints.push(cols);
      } else if (cursor.matchIdent("CHECK")) {
        cursor.next();
        checks.push(parseCheckExpression(cursor, sql));
      } else {
        if (hadConstraintName) throw new Error("CONSTRAINT must be followed by PRIMARY/UNIQUE/CHECK.");
        columns.push(parseColumnDef(cursor, sql));
        if (columns[columns.length - 1]!.primaryKey) {
          primaryKey = columns[columns.length - 1]!.name;
        }
      }

      if (cursor.matchSymbol(",")) {
        cursor.next();
        continue;
      }
      break;
    }

    cursor.expect("symbol", ")");
    const q = {
      type: "createTable",
      table,
      columns,
      primaryKey,
      ifNotExists,
      uniqueConstraints: uniqueConstraints.length ? uniqueConstraints : undefined,
      checks: checks.length ? checks : undefined,
    } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("DROP")) {
    cursor.next();
    if (cursor.matchIdent("TRIGGER")) {
      cursor.next();
      let ifExists = false;
      if (cursor.matchIdent("IF")) {
        cursor.next();
        cursor.expect("ident", "EXISTS");
        ifExists = true;
      }
      const name = cursor.parseIdent();
      const q: DropTriggerQuery = { type: "dropTrigger", name, ifExists };
      assertEof(cursor);
      return q;
    }
    cursor.expect("ident", "TABLE");
    let ifExists = false;
    if (cursor.matchIdent("IF")) {
      cursor.next();
      cursor.expect("ident", "EXISTS");
      ifExists = true;
    }
    const table = cursor.parseIdent();
    const q = { type: "dropTable", table, ifExists } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("ALTER")) {
    cursor.next();
    cursor.expect("ident", "TABLE");
    const table = cursor.parseIdent();
    let action: AlterTableAction;
    if (cursor.matchIdent("ADD")) {
      cursor.next();
      if (cursor.matchIdent("COLUMN")) cursor.next();
      const column = parseColumnDef(cursor, sql);
      action = { type: "add", column };
    } else if (cursor.matchIdent("RENAME")) {
      cursor.next();
      if (cursor.matchIdent("COLUMN")) cursor.next();
      const from = cursor.parseIdent();
      cursor.expect("ident", "TO");
      const to = cursor.parseIdent();
      action = { type: "rename", from, to };
    } else if (cursor.matchIdent("DROP")) {
      cursor.next();
      if (cursor.matchIdent("COLUMN")) cursor.next();
      const column = cursor.parseIdent();
      action = { type: "drop", column };
    } else {
      throw new Error("Unsupported ALTER TABLE action.");
    }
    const q = { type: "alterTable", table, action } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("SHOW")) {
    cursor.next();
    cursor.expect("ident", "TABLES");
    const q = { type: "showTables" } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("DESCRIBE") || cursor.matchIdent("DESC")) {
    cursor.next();
    const table = cursor.parseIdent();
    const q = { type: "describeTable", table } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("INSERT")) {
    cursor.next();
    let orAction: "REPLACE" | "IGNORE" | undefined;
    if (cursor.matchIdent("OR")) {
      cursor.next();
      const action = cursor.parseIdent().toUpperCase();
      if (action !== "REPLACE" && action !== "IGNORE") {
        throw new Error(`Unsupported INSERT OR action: ${action}`);
      }
      orAction = action as "REPLACE" | "IGNORE";
    }
    cursor.expect("ident", "INTO");
    const table = cursor.parseIdent();
    let columns: string[] | undefined;
    if (cursor.matchSymbol("(")) {
      cursor.next();
      columns = [];
      while (true) {
        columns.push(cursor.parseIdent());
        if (cursor.matchSymbol(",")) {
          cursor.next();
          continue;
        }
        break;
      }
      cursor.expect("symbol", ")");
    }

    let values: JsonValue[][] | undefined;
    let select: SelectQuery | SetQuery | undefined;
    let defaultValues = false;

    if (cursor.matchIdent("DEFAULT")) {
      cursor.next();
      cursor.expect("ident", "VALUES");
      defaultValues = true;
    } else if (cursor.matchIdent("VALUES")) {
      cursor.next();
      const rows: JsonValue[][] = [];
      while (true) {
        cursor.expect("symbol", "(");
        const rowValues: JsonValue[] = [];
        if (!cursor.matchSymbol(")")) {
          while (true) {
            rowValues.push(cursor.parseValue());
            if (cursor.matchSymbol(",")) {
              cursor.next();
              continue;
            }
            break;
          }
        }
        cursor.expect("symbol", ")");
        if (columns && columns.length !== rowValues.length) {
          throw new Error("INSERT column/value length mismatch.");
        }
        rows.push(rowValues);
        if (cursor.matchSymbol(",")) {
          cursor.next();
          continue;
        }
        break;
      }
      values = rows;
    } else if (cursor.matchIdent("SELECT")) {
      cursor.next();
      select = parseSelectOrSetAfterSelect(cursor);
    } else {
      throw new Error("INSERT expects VALUES, DEFAULT VALUES, or SELECT.");
    }

    const returning = parseReturning(cursor);
    const q = { type: "insert", table, columns, values, select, defaultValues, or: orAction, returning } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("SELECT")) {
    cursor.next();
    const q = parseSelectOrSetAfterSelect(cursor);
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("UPDATE")) {
    cursor.next();
    const table = cursor.parseIdent();
    cursor.expect("ident", "SET");
    const set: Record<string, JsonValue> = {};
    while (true) {
      const col = cursor.parseIdent();
      cursor.expect("op", "=");
      set[col] = cursor.parseValue();
      if (cursor.matchSymbol(",")) {
        cursor.next();
        continue;
      }
      break;
    }
    const where = parseWhere(cursor);
    const { limit } = parseLimitOffset(cursor);
    const returning = parseReturning(cursor);
    const q = { type: "update", table, set, where, limit, returning } as const;
    assertEof(cursor);
    return q;
  }

  if (cursor.matchIdent("DELETE")) {
    cursor.next();
    cursor.expect("ident", "FROM");
    const table = cursor.parseIdent();
    const where = parseWhere(cursor);
    const { limit } = parseLimitOffset(cursor);
    const returning = parseReturning(cursor);
    const q = { type: "delete", table, where, limit, returning } as const;
    assertEof(cursor);
    return q;
  }

  throw new Error("Unsupported SQL statement.");
}
