/// <reference types="node" />
/**
 * Test-only adapters: a real-disk ProjectFs and node:sqlite for the index.
 * They mirror what the Rust shell does (temp file + fsync + rename) so the
 * core logic is exercised against a real filesystem and a real SQLite.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DirEntry, FileStat, ProjectFs } from "./fs";
import type { IndexDatabaseFactory, SqlDatabase, SqlRow, SqlValue } from "./index-store";

const isMissing = (error: unknown): boolean => (error as { code?: string }).code === "ENOENT";

export class NodeFs implements ProjectFs {
  constructor(private readonly root: string) {}

  private abs(path: string): string {
    return join(this.root, ...path.split("/").filter(Boolean));
  }

  async readText(path: string): Promise<string | null> {
    try {
      return await readFile(this.abs(path), "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async writeTextAtomic(path: string, text: string): Promise<FileStat> {
    const target = this.abs(path);
    const temp = join(
      dirname(target),
      `.${basename(target)}.${randomBytes(4).toString("hex")}.tmp`,
    );
    const handle = await open(temp, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temp, target);
    const s = await stat(target);
    return { size: s.size, mtimeMs: s.mtimeMs };
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const s = await stat(this.abs(path));
      return { size: s.size, mtimeMs: s.mtimeMs };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  async list(dir: string): Promise<DirEntry[]> {
    let names: string[];
    try {
      names = await readdir(this.abs(dir));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const entries: DirEntry[] = [];
    for (const name of names) {
      const s = await stat(join(this.abs(dir), name));
      entries.push({ name, isDir: s.isDirectory(), size: s.size, mtimeMs: s.mtimeMs });
    }
    return entries;
  }

  async mkdir(dir: string): Promise<void> {
    await mkdir(this.abs(dir), { recursive: true });
  }

  async rename(from: string, to: string): Promise<void> {
    await rename(this.abs(from), this.abs(to));
  }

  async removeTemp(path: string): Promise<void> {
    const name = basename(path);
    if (!(name.startsWith(".") && name.endsWith(".tmp")))
      throw new Error(`Refusing to remove ${path}`);
    await unlink(this.abs(path));
  }
}

function wrap(db: DatabaseSync): SqlDatabase {
  return {
    execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
      db.prepare(sql).run(...params);
      return Promise.resolve();
    },
    executeMany(sql: string, rows: readonly (readonly SqlValue[])[]): Promise<void> {
      db.exec("BEGIN");
      try {
        const statement = db.prepare(sql);
        for (const row of rows) statement.run(...row);
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return Promise.resolve();
    },
    query(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
      return Promise.resolve(db.prepare(sql).all(...params) as SqlRow[]);
    },
    close(): Promise<void> {
      if (db.isOpen) db.close();
      return Promise.resolve();
    },
  };
}

export function nodeSqliteFactory(file: string): IndexDatabaseFactory {
  return {
    async open() {
      await mkdir(dirname(file), { recursive: true });
      return wrap(new DatabaseSync(file));
    },
    async destroy() {
      for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) {
        await unlink(f).catch(() => undefined);
      }
    },
  };
}
