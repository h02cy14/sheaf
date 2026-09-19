/**
 * The file operations core needs, all relative to one project folder with "/"
 * separators. The app implements this over the Rust shell (durable, atomic
 * writes); tests and the browser preview use `MemoryFs`.
 */
export interface FileStat {
  size: number;
  /** Modification time in milliseconds (may be fractional). */
  mtimeMs: number;
}

export interface DirEntry extends FileStat {
  name: string;
  isDir: boolean;
}

export interface ProjectFs {
  /** File contents, or null if the file doesn't exist. */
  readText(path: string): Promise<string | null>;
  /** Writes via temp file + flush + rename: afterwards the old or new content exists, never a mix. */
  writeTextAtomic(path: string, text: string): Promise<FileStat>;
  stat(path: string): Promise<FileStat | null>;
  /** Entries of a directory; empty if it doesn't exist. */
  list(dir: string): Promise<DirEntry[]>;
  mkdir(dir: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Removes a leftover temporary file. Implementations refuse anything else. */
  removeTemp(path: string): Promise<void>;
}

/** UTF-8 byte length without relying on TextEncoder typings. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}

interface MemoryFile {
  text: string;
  mtimeMs: number;
}

/** In-memory ProjectFs for tests and the browser preview. */
export class MemoryFs implements ProjectFs {
  readonly files = new Map<string, MemoryFile>();
  readonly dirs = new Set<string>([""]);
  private lastMtime = 0;

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Distinct, increasing mtimes even for writes within the same millisecond. */
  private nextMtime(): number {
    this.lastMtime = Math.max(this.now(), this.lastMtime + 1);
    return this.lastMtime;
  }

  private parentOf(path: string): string {
    const i = path.lastIndexOf("/");
    return i < 0 ? "" : path.slice(0, i);
  }

  readText(path: string): Promise<string | null> {
    return Promise.resolve(this.files.get(path)?.text ?? null);
  }

  writeTextAtomic(path: string, text: string): Promise<FileStat> {
    if (!this.dirs.has(this.parentOf(path))) {
      return Promise.reject(new Error(`No such directory: ${this.parentOf(path)}`));
    }
    const file = { text, mtimeMs: this.nextMtime() };
    this.files.set(path, file);
    return Promise.resolve({ size: utf8Length(text), mtimeMs: file.mtimeMs });
  }

  /** Simulates another program or device changing a file. */
  externalWrite(path: string, text: string): void {
    this.files.set(path, { text, mtimeMs: this.nextMtime() });
  }

  stat(path: string): Promise<FileStat | null> {
    const file = this.files.get(path);
    return Promise.resolve(file ? { size: utf8Length(file.text), mtimeMs: file.mtimeMs } : null);
  }

  list(dir: string): Promise<DirEntry[]> {
    const prefix = dir === "" ? "" : `${dir}/`;
    const entries: DirEntry[] = [];
    for (const [path, file] of this.files) {
      if (path.startsWith(prefix) && !path.slice(prefix.length).includes("/")) {
        entries.push({
          name: path.slice(prefix.length),
          isDir: false,
          size: utf8Length(file.text),
          mtimeMs: file.mtimeMs,
        });
      }
    }
    for (const d of this.dirs) {
      if (d !== dir && d.startsWith(prefix) && d !== "" && !d.slice(prefix.length).includes("/")) {
        entries.push({ name: d.slice(prefix.length), isDir: true, size: 0, mtimeMs: 0 });
      }
    }
    return Promise.resolve(entries);
  }

  mkdir(dir: string): Promise<void> {
    const parts = dir.split("/").filter(Boolean);
    for (let i = 1; i <= parts.length; i++) this.dirs.add(parts.slice(0, i).join("/"));
    return Promise.resolve();
  }

  rename(from: string, to: string): Promise<void> {
    const file = this.files.get(from);
    if (!file) return Promise.reject(new Error(`No such file: ${from}`));
    this.files.delete(from);
    this.files.set(to, file);
    return Promise.resolve();
  }

  removeTemp(path: string): Promise<void> {
    const name = path.slice(path.lastIndexOf("/") + 1);
    if (!(name.startsWith(".") && name.endsWith(".tmp"))) {
      return Promise.reject(new Error(`Refusing to remove non-temporary file: ${path}`));
    }
    this.files.delete(path);
    return Promise.resolve();
  }
}
