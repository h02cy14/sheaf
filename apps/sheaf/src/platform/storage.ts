/**
 * Where projects live and how the app reaches their files. The native
 * implementation goes through the Rust shell (atomic writes, SQLite cache);
 * the browser one keeps projects in localStorage so `pnpm dev` works without
 * a shell. Nothing outside `platform/` knows which one is in use.
 */
import type { IndexStore, ProjectFs } from "@sheaf/core";

export interface ProjectLocation {
  /** Absolute folder path (native) or a browser key. */
  root: string;
  /** Folder name as shown to the user. */
  name: string;
  modifiedMs: number;
}

export interface AttachedProject {
  fs: ProjectFs;
  /** Identifies this folder to the index cache. */
  rootKey: string;
  openIndex(projectId: string): Promise<IndexStore>;
  detach(): Promise<void>;
}

export interface Storage {
  readonly kind: "native" | "browser";
  /** Whether "Open another folder…" is available (desktop only for now). */
  readonly canPickFolders: boolean;
  listProjects(): Promise<ProjectLocation[]>;
  /** Creates an empty, uniquely named folder for a new project. */
  createProjectFolder(title: string): Promise<string>;
  /** Asks the user for a project folder; null if cancelled. */
  pickProjectFolder(dialogTitle: string): Promise<string | null>;
  attach(root: string): Promise<AttachedProject>;
}

/** An error from the storage layer, with a machine-readable code. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/** Folder name without its conventional `.sheaf` extension. */
export function displayName(root: string): string {
  const name = root.split(/[\\/]/).filter(Boolean).pop() ?? root;
  return name.replace(/\.sheaf$/i, "");
}
