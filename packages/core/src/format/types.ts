/** The three fixed top-level containers of every project's binder. */
export const ROOT_IDS = ["manuscript", "research", "trash"] as const;
export type RootId = (typeof ROOT_IDS)[number];

export function isRootId(value: string): value is RootId {
  return (ROOT_IDS as readonly string[]).includes(value);
}

/** Binder item kinds. Research items (PDF, images, web clips) arrive in Phase 6. */
export type DocKind = "text" | "folder";

/** Everything Sheaf itself reads from a document's frontmatter. */
export interface DocMeta {
  id: string;
  title: string;
  kind: DocKind;
  /** A document id, or a root id. */
  parent: string;
  /** Fractional index key among siblings ("" if missing or unreadable). */
  order: string;
  /** ISO 8601 timestamps ("" if unknown). */
  created: string;
  modified: string;
  synopsis: string;
  /** Where a trashed item came from, so Restore can put it back. */
  trashedFrom: string | null;
  /** This document's goal, in the project's counting unit (words or characters). */
  target: number | null;
  /**
   * The language this document is written in, as a BCP 47 tag, when the
   * writer has said so. `null` means "work it out per paragraph" (brief §7).
   */
  language: string | null;
}

/** Problems found while reading a document file. The words are always kept. */
export type DocProblem = "no-frontmatter" | "invalid-frontmatter" | "missing-fields";
