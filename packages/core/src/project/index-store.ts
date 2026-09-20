/**
 * The project index: a rebuildable cache of every document file's metadata
 * and fingerprint (ADR 0002). Losing or corrupting it costs one rescan.
 *
 * `SqliteIndexStore` is the real one (SQLite via the Rust shell in the app,
 * `node:sqlite` in tests); `MemoryIndexStore` is the fallback when no
 * database can be opened, and the browser preview's store.
 */
import type { DocMeta, DocProblem } from "../format/types";
import type { TextCounts } from "../text/count";

/** Bump when the table layout changes: old caches are dropped and rebuilt. */
export const INDEX_SCHEMA_VERSION = 2;

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
  counts: TextCounts;
  /** Plain text, for search. Written on upsert; not returned by `load`. */
  text?: string;
}

export interface SearchHit {
  path: string;
  field: "title" | "synopsis" | "body";
  /** A short piece of the text around the match. */
  snippet: string;
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
  /** Substring search over titles, synopses and text. Works in any script. */
  search(query: string, limit?: number): Promise<SearchHit[]>;
  close(): Promise<void>;
}

const SNIPPET_RADIUS = 60;

/** A short piece of `text` around the first match of `query`. */
export function snippetAround(text: string, query: string, radius = SNIPPET_RADIUS): string {
  const at = text.toLowerCase().indexOf(query.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
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

  search(query: string, limit = 100): Promise<SearchHit[]> {
    const needle = query.trim().toLowerCase();
    if (needle === "") return Promise.resolve([]);
    const hits: SearchHit[] = [];
    for (const file of this.files.values()) {
      const fields: [SearchHit["field"], string][] = [
        ["title", file.meta.title],
        ["synopsis", file.meta.synopsis],
        ["body", file.text ?? ""],
      ];
      for (const [field, text] of fields) {
        if (text.toLowerCase().includes(needle)) {
          hits.push({ path: file.path, field, snippet: snippetAround(text, needle) });
          break;
        }
      }
      if (hits.length >= limit) break;
    }
    return Promise.resolve(hits);
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
     problems TEXT NOT NULL,
     words INTEGER NOT NULL DEFAULT 0,
     cjk INTEGER NOT NULL DEFAULT 0,
     characters INTEGER NOT NULL DEFAULT 0
   )`,
  "CREATE INDEX IF NOT EXISTS files_by_parent ON files (parent, ord, id)",
  // The trigram tokenizer matches substrings in any script: SQLite's default
  // tokenizer can't split Chinese or Japanese into words (brief §7).
  `CREATE VIRTUAL TABLE IF NOT EXISTS search
     USING fts5(path UNINDEXED, title, synopsis, body, tokenize = 'trigram')`,
];

/** Escapes a LIKE pattern so user text is matched literally. */
function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

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
      "SELECT path, size, mtime_ms, meta_json, extra_json, problems, words, cjk, characters FROM files",
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
          counts: {
            words: Number(row["words"]),
            cjk: Number(row["cjk"]),
            characters: Number(row["characters"]),
          },
        });
      } catch {
        // A damaged row is just a cache miss: that file gets re-read.
      }
    }
    return { meta, files };
  }

  async apply(changes: IndexChanges): Promise<void> {
    const touched = [...(changes.remove ?? []), ...(changes.upsert ?? []).map((f) => f.path)];
    if (changes.remove && changes.remove.length > 0) {
      await this.db.executeMany(
        "DELETE FROM files WHERE path = ?",
        changes.remove.map((p) => [p]),
      );
    }
    if (touched.length > 0) {
      await this.db.executeMany(
        "DELETE FROM search WHERE path = ?",
        touched.map((p) => [p]),
      );
    }
    if (changes.upsert && changes.upsert.length > 0) {
      await this.db.executeMany(
        `INSERT INTO files (path, id, parent, ord, title, size, mtime_ms, meta_json, extra_json, problems, words, cjk, characters)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (path) DO UPDATE SET
           id = excluded.id, parent = excluded.parent, ord = excluded.ord, title = excluded.title,
           size = excluded.size, mtime_ms = excluded.mtime_ms, meta_json = excluded.meta_json,
           extra_json = excluded.extra_json, problems = excluded.problems,
           words = excluded.words, cjk = excluded.cjk, characters = excluded.characters`,
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
          f.counts.words,
          f.counts.cjk,
          f.counts.characters,
        ]),
      );
      await this.db.executeMany(
        "INSERT INTO search (path, title, synopsis, body) VALUES (?, ?, ?, ?)",
        changes.upsert.map((f) => [f.path, f.meta.title, f.meta.synopsis, f.text ?? ""]),
      );
    }
  }

  async search(query: string, limit = 100): Promise<SearchHit[]> {
    const needle = query.trim();
    if (needle === "") return [];
    const pattern = likePattern(needle);
    const rows = await this.db.query(
      `SELECT path, title, synopsis, body FROM search
       WHERE title LIKE ? ESCAPE '\\' OR synopsis LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
       LIMIT ?`,
      [pattern, pattern, pattern, limit],
    );
    const hits: SearchHit[] = [];
    for (const row of rows) {
      const path = String(row["path"]);
      const fields: [SearchHit["field"], string][] = [
        ["title", String(row["title"] ?? "")],
        ["synopsis", String(row["synopsis"] ?? "")],
        ["body", String(row["body"] ?? "")],
      ];
      for (const [field, text] of fields) {
        if (text.toLowerCase().includes(needle.toLowerCase())) {
          hits.push({ path, field, snippet: snippetAround(text, needle) });
          break;
        }
      }
    }
    return hits;
  }

  async reset(meta: IndexMeta): Promise<void> {
    await this.db.execute("DELETE FROM files");
    await this.db.execute("DELETE FROM search");
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
