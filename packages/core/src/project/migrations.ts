/**
 * Format migrations (ADR 0002). Each step upgrades a project by exactly one
 * `formatVersion`. Before a step modifies a file it backs it up under
 * `.sheaf-backup/<timestamp>-v<from>/`, and `project.json` is written last,
 * so an interrupted migration simply runs again from a consistent state.
 *
 * Format 1 is the first format, so the production list is empty. The
 * harness is tested with fake steps so it works before it's first needed.
 */
import { BACKUP_DIR, PROJECT_FILE } from "../format/layout";
import {
  CURRENT_FORMAT_VERSION,
  serializeProjectFile,
  type ProjectFile,
} from "../format/project-file";
import type { ProjectFs } from "./fs";

export interface MigrationContext {
  fs: ProjectFs;
  /** Copies a file into this migration's backup folder. Call before modifying it. */
  backup(path: string): Promise<void>;
}

export interface Migration {
  from: number;
  to: number;
  describe: string;
  run(ctx: MigrationContext, project: ProjectFile): Promise<ProjectFile>;
}

export const MIGRATIONS: readonly Migration[] = [];

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly code: "newer-format" | "no-path",
  ) {
    super(message);
    this.name = "MigrationError";
  }
}

/**
 * Brings `project` up to `targetVersion`, returning the upgraded project.
 * A no-op when it's already there.
 */
export async function migrateProject(
  fs: ProjectFs,
  project: ProjectFile,
  options: { now: Date; migrations?: readonly Migration[]; targetVersion?: number },
): Promise<ProjectFile> {
  const target = options.targetVersion ?? CURRENT_FORMAT_VERSION;
  const migrations = options.migrations ?? MIGRATIONS;

  if (project.formatVersion > target) {
    throw new MigrationError(
      `This project uses format ${project.formatVersion}; this version of Sheaf understands up to ${target}.`,
      "newer-format",
    );
  }
  if (project.formatVersion === target) return project;

  const stamp = options.now.toISOString().replace(/[:.]/g, "-");
  const backupRoot = `${BACKUP_DIR}/${stamp}-v${project.formatVersion}`;
  const backedUp = new Set<string>();
  const backup = async (path: string): Promise<void> => {
    if (backedUp.has(path)) return;
    const text = await fs.readText(path);
    if (text === null) return;
    const dest = `${backupRoot}/${path}`;
    await fs.mkdir(dest.slice(0, dest.lastIndexOf("/")));
    await fs.writeTextAtomic(dest, text);
    backedUp.add(path);
  };

  await backup(PROJECT_FILE);
  let current = project;
  while (current.formatVersion < target) {
    const step = migrations.find((m) => m.from === current.formatVersion);
    if (!step || step.to !== current.formatVersion + 1) {
      throw new MigrationError(`No migration from format ${current.formatVersion}.`, "no-path");
    }
    const next = await step.run({ fs, backup }, current);
    current = { ...next, formatVersion: step.to };
  }
  // Last: only now does the project claim the new version.
  await fs.writeTextAtomic(PROJECT_FILE, serializeProjectFile(current));
  return current;
}
