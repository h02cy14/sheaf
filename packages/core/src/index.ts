/**
 * @sheaf/core: platform-independent domain logic. See README.md.
 */
export { newId, isValidId } from "./ids";
export { keyBetween, keysBetween, compareOrder, isValidOrderKey } from "./order";

export { schema } from "./editor/schema";
export { parseMarkdown, serializeMarkdown } from "./editor/markdown";

export * from "./format/types";
export * from "./format/layout";
export { parseDocFile, serializeDocFile, type DocFile, type ParsedDocFile } from "./format/docfile";
export {
  CURRENT_FORMAT_VERSION,
  FORMAT_ID,
  newProjectFile,
  parseProjectFile,
  serializeProjectFile,
  type ProjectFile,
} from "./format/project-file";

export { MemoryFs, utf8Length, type DirEntry, type FileStat, type ProjectFs } from "./project/fs";
export {
  INDEX_SCHEMA_VERSION,
  MemoryIndexStore,
  SqliteIndexStore,
  openIndex,
  type IndexDatabaseFactory,
  type IndexStore,
  type SqlDatabase,
  type SqlRow,
  type SqlValue,
} from "./project/index-store";
export { MIGRATIONS, MigrationError, migrateProject, type Migration } from "./project/migrations";
export {
  ProjectOpenError,
  openProject,
  readProjectFile,
  type LoadedDoc,
  type OpenOptions,
  type OpenedProject,
} from "./project/open";
export {
  ProjectSession,
  SessionError,
  type DropPosition,
  type SaveResult,
  type SessionLabels,
  type SessionOptions,
  type SessionSnapshot,
} from "./project/session";
export {
  buildTree,
  childrenOf,
  flatten,
  isWithin,
  rootOf,
  type ProjectTree,
  type TreeNode,
  type TreeProblem,
} from "./project/tree";
