/**
 * Browser-preview storage: projects are kept in this browser's localStorage so
 * the UI can be developed and tested with `pnpm dev`, without the native
 * shell. Not used in the real app, where files live on disk.
 */
import {
  MemoryFs,
  MemoryIndexStore,
  type DirEntry,
  type FileStat,
  type ProjectFs,
} from "@sheaf/core";
import {
  displayName,
  StorageError,
  type AttachedProject,
  type ProjectLocation,
  type Storage,
} from "./storage";

const KEY = "sheaf.browserProjects.v1";
const PREFIX = "browser:/";

interface PersistedFs {
  files: Record<string, { text: string; mtimeMs: number }>;
  dirs: string[];
}

function load(): Map<string, MemoryFs> {
  const out = new Map<string, MemoryFs>();
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // Storage unavailable (private mode): start empty.
  }
  if (!raw) return out;
  try {
    const data = JSON.parse(raw) as Record<string, PersistedFs>;
    for (const [root, persisted] of Object.entries(data)) {
      const fs = new MemoryFs();
      for (const [path, file] of Object.entries(persisted.files)) fs.files.set(path, { ...file });
      for (const dir of persisted.dirs) fs.dirs.add(dir);
      out.set(root, fs);
    }
  } catch {
    // Corrupt preview data is not worth failing over.
  }
  return out;
}

export class BrowserStorage implements Storage {
  readonly kind = "browser";
  readonly canPickFolders = false;
  private readonly projects = load();

  private persist(): void {
    const data: Record<string, PersistedFs> = {};
    for (const [root, fs] of this.projects) {
      data[root] = { files: Object.fromEntries(fs.files), dirs: [...fs.dirs] };
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      // Quota or private mode: the preview keeps working in memory.
    }
  }

  async listProjects(): Promise<ProjectLocation[]> {
    const out: ProjectLocation[] = [];
    for (const [root, fs] of this.projects) {
      const stat = await fs.stat("project.json");
      if (stat) out.push({ root, name: displayName(root), modifiedMs: stat.mtimeMs });
    }
    return out;
  }

  createProjectFolder(title: string): Promise<string> {
    const base = title.replace(/[\\/:*?"<>|]/g, " ").trim() || "Untitled";
    for (let n = 1; ; n++) {
      const root = `${PREFIX}${n === 1 ? base : `${base} ${n}`}.sheaf`;
      if (!this.projects.has(root)) {
        this.projects.set(root, new MemoryFs());
        this.persist();
        return Promise.resolve(root);
      }
    }
  }

  pickProjectFolder(): Promise<string | null> {
    return Promise.resolve(null);
  }

  attach(root: string): Promise<AttachedProject> {
    const fs = this.projects.get(root);
    if (!fs) return Promise.reject(new StorageError(`No such project: ${root}`, "not-found"));
    return Promise.resolve({
      fs: new PersistingFs(fs, () => this.persist()),
      rootKey: root,
      openIndex: () => Promise.resolve(new MemoryIndexStore()),
      detach: () => Promise.resolve(),
    });
  }
}

/** Saves to localStorage after every mutation, so a reload behaves like a restart. */
class PersistingFs implements ProjectFs {
  constructor(
    private readonly inner: MemoryFs,
    private readonly persist: () => void,
  ) {}

  readText(path: string): Promise<string | null> {
    return this.inner.readText(path);
  }
  async writeTextAtomic(path: string, text: string): Promise<FileStat> {
    const stat = await this.inner.writeTextAtomic(path, text);
    this.persist();
    return stat;
  }
  stat(path: string): Promise<FileStat | null> {
    return this.inner.stat(path);
  }
  list(dir: string): Promise<DirEntry[]> {
    return this.inner.list(dir);
  }
  async mkdir(dir: string): Promise<void> {
    await this.inner.mkdir(dir);
    this.persist();
  }
  async rename(from: string, to: string): Promise<void> {
    await this.inner.rename(from, to);
    this.persist();
  }
  async removeTemp(path: string): Promise<void> {
    await this.inner.removeTemp(path);
    this.persist();
  }
}
