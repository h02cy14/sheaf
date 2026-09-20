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
  DEFAULT_SETTINGS,
  FORMAT_ID,
  newProjectFile,
  parseProjectFile,
  serializeProjectFile,
  type ProjectFile,
  type ProjectSettings,
} from "./format/project-file";

export { ZERO_COUNTS, addCounts, countText, wordTotal, type TextCounts } from "./text/count";
export { countMarkdown, paragraphsOf, plainTextOf } from "./text/paragraphs";
export {
  diffParagraphs,
  diffWords,
  type DiffOpKind,
  type DiffPart,
  type ParagraphDiff,
} from "./text/diff";

export { MemoryFs, utf8Length, type DirEntry, type FileStat, type ProjectFs } from "./project/fs";
export {
  countFor,
  countsWithin,
  planForDeadline,
  progress,
  type DeadlinePlan,
} from "./project/targets";
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
  type SearchResult,
  type SessionLabels,
  type SessionOptions,
  type SessionSnapshot,
  type SnapshotInfo,
  type SnapshotKind,
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
