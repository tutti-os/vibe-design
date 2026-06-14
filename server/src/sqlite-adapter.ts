import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import type { BindParams, Database as SqlJsDatabase, Statement as SqlJsStatement, SqlValue } from 'sql.js';

export interface SqliteRunResult {
  changes: number;
}

export interface SqliteStatement {
  all(...params: SqlValue[]): unknown[];
  get(...params: SqlValue[]): unknown | undefined;
  run(...params: SqlValue[]): SqliteRunResult;
}

export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  pragma(sql: string): unknown[];
  transaction<T>(fn: () => T): () => T;
  close(): void;
}

const localRequire = createRequire(import.meta.url);
const SQL = await initSqlJs({ locateFile: () => resolveSqlWasmPath() });

function resolveSqlWasmPath(): string {
  const bundledWasmPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sql-wasm.wasm');
  if (existsSync(bundledWasmPath)) {
    return bundledWasmPath;
  }
  return localRequire.resolve('sql.js/dist/sql-wasm.wasm');
}

export function openSqliteDatabase(filePath: string): SqliteDatabase {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const source = existsSync(filePath) ? readFileSync(filePath) : undefined;
  return new PersistentSqliteDatabase(filePath, source ? new SQL.Database(source) : new SQL.Database());
}

class PersistentSqliteDatabase implements SqliteDatabase {
  private transactionDepth = 0;
  private dirty = false;
  private closed = false;

  constructor(
    private readonly filePath: string,
    private readonly db: SqlJsDatabase,
  ) {}

  exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
    this.markDirty();
  }

  prepare(sql: string): SqliteStatement {
    this.assertOpen();
    return new PersistentSqliteStatement(this, this.db, sql);
  }

  pragma(sql: string): unknown[] {
    this.assertOpen();
    return this.prepare(`PRAGMA ${sql}`).all();
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      this.assertOpen();
      this.transactionDepth += 1;
      const isOuterTransaction = this.transactionDepth === 1;
      if (isOuterTransaction) {
        this.db.exec('BEGIN');
      }
      try {
        const result = fn();
        if (isOuterTransaction) {
          this.db.exec('COMMIT');
          this.flush();
        }
        return result;
      } catch (error) {
        if (isOuterTransaction) {
          this.db.exec('ROLLBACK');
          this.dirty = false;
        }
        throw error;
      } finally {
        this.transactionDepth -= 1;
      }
    };
  }

  close(): void {
    if (this.closed) return;
    this.flush();
    this.db.close();
    this.closed = true;
  }

  markDirty(): void {
    this.dirty = true;
    if (this.transactionDepth === 0) {
      this.flush();
    }
  }

  private flush(): void {
    if (!this.dirty) return;
    writeFileSync(this.filePath, Buffer.from(this.db.export()));
    this.dirty = false;
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('sqlite database is closed');
    }
  }
}

class PersistentSqliteStatement implements SqliteStatement {
  constructor(
    private readonly owner: PersistentSqliteDatabase,
    private readonly db: SqlJsDatabase,
    private readonly sql: string,
  ) {}

  all(...params: SqlValue[]): unknown[] {
    const statement = this.prepare(params);
    try {
      const rows: Record<string, SqlValue>[] = [];
      while (statement.step()) {
        rows.push(statement.getAsObject() as Record<string, SqlValue>);
      }
      return rows;
    } finally {
      statement.free();
    }
  }

  get(...params: SqlValue[]): unknown | undefined {
    const statement = this.prepare(params);
    try {
      if (!statement.step()) return undefined;
      return statement.getAsObject() as Record<string, SqlValue>;
    } finally {
      statement.free();
    }
  }

  run(...params: SqlValue[]): SqliteRunResult {
    const statement = this.prepare(params);
    try {
      statement.step();
      const changes = this.db.getRowsModified();
      this.owner.markDirty();
      return { changes };
    } finally {
      statement.free();
    }
  }

  private prepare(params: SqlValue[]): SqlJsStatement {
    const statement = this.db.prepare(this.sql);
    const bindParams = toBindParams(params);
    if (bindParams) {
      statement.bind(bindParams);
    }
    return statement;
  }
}

function toBindParams(params: SqlValue[]): BindParams | null {
  return params.length === 0 ? null : params;
}
