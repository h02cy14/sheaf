import {
  openIndex,
  type DirEntry,
  type FileStat,
  type IndexDatabaseFactory,
  type ProjectFs,
  type SqlDatabase,
  type SqlRow,
  type SqlValue,
} from "@sheaf/core";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { StorageError, type AttachedProject, type ProjectLocation, type Storage } from "./storage";

/** Commands reject with `{ code, message }` (see src-tauri/src/error.rs). */
async function call<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    if (typeof error === "object" && error !== null && "message" in error) {
      const { code, message } = error as { code?: unknown; message?: unknown };
      throw new StorageError(String(message), String(code ?? "unknown"));
    }
    throw new StorageError(String(error), "unknown");
  }
}

class NativeProjectFs implements ProjectFs {
  constructor(private readonly handle: number) {}

  readText(path: string): Promise<string | null> {
    return call("fs_read_text", { handle: this.handle, path });
  }
  writeTextAtomic(path: string, text: string): Promise<FileStat> {
    return call("fs_write_text", { handle: this.handle, path, text });
  }
  stat(path: string): Promise<FileStat | null> {
    return call("fs_stat", { handle: this.handle, path });
  }
  list(dir: string): Promise<DirEntry[]> {
    return call("fs_list", { handle: this.handle, path: dir });
  }
  mkdir(dir: string): Promise<void> {
    return call("fs_mkdir", { handle: this.handle, path: dir });
  }
  rename(from: string, to: string): Promise<void> {
    return call("fs_rename", { handle: this.handle, from, to });
  }
  removeTemp(path: string): Promise<void> {
    return call("fs_remove_temp", { handle: this.handle, path });
  }
}

class NativeSqlDatabase implements SqlDatabase {
  constructor(private readonly db: number) {}

  execute(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    return call("db_execute", { db: this.db, sql, params });
  }
  executeMany(sql: string, rows: readonly (readonly SqlValue[])[]): Promise<void> {
    return call("db_execute_many", { db: this.db, sql, rows });
  }
  query(sql: string, params: readonly SqlValue[] = []): Promise<SqlRow[]> {
    return call("db_query", { db: this.db, sql, params });
  }
  close(): Promise<void> {
    return call("db_close", { db: this.db });
  }
}

function indexFactory(projectId: string): IndexDatabaseFactory {
  return {
    open: async () => new NativeSqlDatabase(await call<number>("index_open", { projectId })),
    destroy: () => call("index_destroy", { projectId }),
  };
}

export class TauriStorage implements Storage {
  readonly kind = "native";

  constructor(readonly canPickFolders: boolean) {}

  listProjects(): Promise<ProjectLocation[]> {
    return call("projects_list");
  }

  createProjectFolder(title: string): Promise<string> {
    return call("project_create_folder", { title });
  }

  async pickProjectFolder(dialogTitle: string): Promise<string | null> {
    const picked = await open({ directory: true, multiple: false, title: dialogTitle });
    return typeof picked === "string" ? picked : null;
  }

  async attach(root: string): Promise<AttachedProject> {
    const handle = await call<number>("project_attach", { root });
    return {
      fs: new NativeProjectFs(handle),
      rootKey: root,
      openIndex: async (projectId) => (await openIndex(indexFactory(projectId))).store,
      detach: () => call("project_detach", { handle }),
    };
  }
}
