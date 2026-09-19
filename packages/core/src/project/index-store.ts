/**
 * The project index: a rebuildable cache of every document file's metadata
 * and fingerprint (ADR 0002). Losing or corrupting it costs one rescan.
 *
 * `SqliteIndexStore` is the real one (SQLite via the Rust shell in the app,
 * `node:sqlite` in tests); `MemoryIndexStore` is the fallback when no
 * database can be opened, and the browser preview's store.
 */
import type { DocMeta, DocProblem } from "../format/types";

/** Bump when the table layout changes: old caches are dropped and rebuilt. */
export const INDEX_SCHEMA_VERSION = 1;

export interface IndexMeta {
  schemaVersion: number;
  projectId: string;
  /** Identifies the folder the cache was built from (a path or handle key). */
  rootKey: string;
}

export interface IndexedFile {
  /** Path relative to the project, e.g. "docs/01J….md". */
  path: string;
  size: number;
  mtimeMs: number;
  meta: DocMeta;
  extra: Record<string, unknown>;
  problems: DocProblem[];
}

export interface IndexSnapshot {
  meta: IndexMeta | null;
  files: IndexedFile[];
}

export interface IndexChanges {
  upsert?: readonly IndexedFile[];
  remove?: readonly string[];
}

export interface IndexStore {
  load(): Promise<IndexSnapshot>;
  apply(changes: IndexChanges): Promise<void>;
  /** Empties the cache and stamps it for a (re)build. */
  reset(meta: IndexMeta): Promise<void>;
  close(): Promise<void>;
}

// ------------------------------------------------------------------ memory

export class MemoryIndexStore implements IndexStore {
  private meta: IndexMeta | null = null;
  private readonly files = new Map<string, IndexedFile>();

  load(): Promise<IndexSnapshot> {
    return Promise.resolve({ meta: this.meta, files: [...this.files.values()].map(clone) });
  }

  apply(changes: IndexChanges): Promise<void> {
    for (const path of changes.remove ?? []) this.files.delete(path);
    for (const file of changes.upsert ?? []) this.files.set(file.path, clone(file));
    return Promise.resolve();
  }

  reset(meta: IndexMeta): Promise<void> {
    this.meta = { ...meta };
    this.files.clear();
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

function clone(file: IndexedFile): IndexedFile {
  return JSON.parse(JSON.stringify(file)) as IndexedFile;
}

// ------------------------------------------------------------------ sqlite

export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;

/** Minimal SQL access, implemented over the Rust shell and over node:sqlite. */
export interface SqlDatabase {
  execute(sql: string, params?: readonly SqlValue[]): Promise<void>;
  /** Runs one statement for each parameter row, inside a single transaction. */
  executeMany(sql: string, rows: readonly (readonly SqlValue[])[]): Promise<void>;
  query(sql: string, params?: readonly SqlValue[]): Promise<SqlRow[]>;
  close(): Promise<void>;
}

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS index_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS files (
     path TEXT PRIMARY KEY,
     id TEXT NOT NULL,
     parent TEXT NOT NULL,
     ord TEXT NOT NULL,
     title TEXT NOT NULL,
     size INTEGER NOT NULL,
     mtime_ms REAL NOT NULL,
     meta_json TEXT NOT NULL,
     extra_json TEXT NOT NULL,
     problems TEXT NOT NULL
   )`,
  "CREATE INDEX IF NOT EXISTS files_by_parent ON files (parent, ord, id)",
];

export class SqliteIndexStore implements IndexStore {
  private constructor(private readonly db: SqlDatabase) {}

  /** Creates the tables if needed. Throws if the database is unusable. */
  static async open(db: SqlDatabase): Promise<SqliteIndexStore> {
    for (const statement of SCHEMA) await db.execute(statement);
    return new SqliteIndexStore(db);
  }

  async load(): Promise<IndexSnapshot> {
    const metaRows = await this.db.query("SELECT key, value FROM index_meta");
    const kv = new Map(metaRows.map((r) => [String(r["key"]), String(r["value"])]));
    const schemaVersion = Number(kv.get("schemaVersion"));
    const meta: IndexMeta | null =
      kv.has("projectId") && kv.has("rootKey") && Number.isFinite(schemaVersion)
        ? { schemaVersion, projectId: kv.get("projectId") ?? "", rootKey: kv.get("rootKey") ?? "" }
        : null;

    const rows = await this.db.query(
      "SELECT path, size, mtime_ms, meta_json, extra_json, problems FROM files",
    );
    const files: IndexedFile[] = [];
    for (const row of rows) {
      try {
        files.push({
          path: String(row["path"]),
          size: Number(row["size"]),
          mtimeMs: Number(row["mtime_ms"]),
          meta: JSON.parse(String(row["meta_json"])) as DocMeta,
          extra: JSON.parse(String(row["extra_json"])) as Record<string, unknown>,
          problems: JSON.parse(String(row["problems"])) as DocProblem[],
        });
      } catch {
        // A damaged row is just a cache miss: that file gets re-read.
      }
    }
    return { meta, files };
  }

  async apply(changes: IndexChanges): Promise<void> {
    if (changes.remove && changes.remove.length > 0) {
      await this.db.executeMany(
        "DELETE FROM files WHERE path = ?",
        changes.remove.map((p) => [p]),
      );
    }
    if (changes.upsert && changes.upsert.length > 0) {
      await this.db.executeMany(
        `INSERT INTO files (path, id, parent, ord, title, size, mtime_ms, meta_json, extra_json, problems)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET
           id = excluded.id, parent = excluded.parent, ord = excluded.ord, title = excluded.title,
           size = excluded.size, mtime_ms = excluded.mtime_ms, meta_json = excluded.meta_json,
           extra_json = excluded.extra_json, problems = excluded.problems`,
        changes.upsert.map((f) => [
          f.path,
          f.meta.id,
          f.meta.parent,
          f.meta.order,
          f.meta.title,
          f.size,
          f.mtimeMs,
          JSON.stringify(f.meta),
          JSON.stringify(f.extra),
          JSON.stringify(f.problems),
        ]),
      );
    }
  }

  async reset(meta: IndexMeta): Promise<void> {
    await this.db.execute("DELETE FROM files");
    await this.db.execute("DELETE FROM index_meta");
    await this.db.executeMany("INSERT INTO index_meta (key, value) VALUES (?, ?)", [
      ["schemaVersion", String(meta.schemaVersion)],
      ["projectId", meta.projectId],
      ["rootKey", meta.rootKey],
    ]);
  }

  close(): Promise<void> {
    return this.db.close();
  }
}

/** How the app gets at a project's cache database. */
export interface IndexDatabaseFactory {
  open(): Promise<SqlDatabase>;
  /** Deletes the cache database files (it is only a cache). */
  destroy(): Promise<void>;
}

/**
 * Opens the cache, recreating it if it's corrupt, and falling back to an
 * in-memory index if even that fails. Opening a project never fails because
 * of its cache.
 */
export async function openIndex(
  factory: IndexDatabaseFactory,
): Promise<{ store: IndexStore; recovered: boolean }> {
  let db: SqlDatabase | null = null;
  try {
    db = await factory.open();
    const store = await SqliteIndexStore.open(db);
    await store.load();
    return { store, recovered: false };
  } catch {
    // Corrupt, truncated, or not a database at all: throw it away. The
    // connection must be closed first, or Windows won't delete the file.
    await db?.close().catch(() => undefined);
  }
  try {
    await factory.destroy();
    const store = await SqliteIndexStore.open(await factory.open());
    return { store, recovered: true };
  } catch {
    return { store: new MemoryIndexStore(), recovered: true };
  }
}
