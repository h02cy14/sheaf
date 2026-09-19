/**
 * Sibling order uses fractional index keys ("a0", "a0V", "a1"…). Moving an
 * item between two siblings gives it a key that sorts between theirs, so a
 * reorder rewrites only the moved document's file (ADR 0002).
 */
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** True if `key` is a well-formed fractional index key. */
export function isValidOrderKey(key: string): boolean {
  try {
    generateKeyBetween(key, null);
    return true;
  } catch {
    return false;
  }
}

/**
 * A key strictly between `before` and `after` (either may be null for "start"
 * or "end"). Invalid or out-of-order bounds degrade to the nearest valid
 * placement instead of throwing: hand-edited files must not break reordering.
 */
export function keyBetween(before: string | null, after: string | null): string {
  return keysBetween(before, after, 1)[0] as string;
}

export function keysBetween(before: string | null, after: string | null, count: number): string[] {
  const lo = before !== null && isValidOrderKey(before) ? before : null;
  let hi = after !== null && isValidOrderKey(after) ? after : null;
  if (lo !== null && hi !== null && lo >= hi) hi = null;
  return generateNKeysBetween(lo, hi, count);
}

/**
 * Sibling comparison: by order key (plain code-unit comparison, as the keys
 * require; never locale-aware), then by id so equal keys from two devices
 * still sort the same everywhere. Invalid keys sort last.
 */
export function compareOrder(
  a: { order: string; id: string },
  b: { order: string; id: string },
): number {
  const av = isValidOrderKey(a.order);
  const bv = isValidOrderKey(b.order);
  if (av !== bv) return av ? -1 : 1;
  if (av && a.order !== b.order) return a.order < b.order ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
