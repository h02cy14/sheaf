/**
 * Plain text of a document body: what the writer sees, without Markdown
 * punctuation. Used for counting, search and snapshot comparison, so all
 * three agree on what the words are.
 */
import { parseMarkdown } from "../editor/markdown";
import { schema } from "../editor/schema";
import { countText, type TextCounts } from "./count";

/** Non-empty paragraphs (and scene breaks) of a body, in order. */
export function paragraphsOf(markdown: string): string[] {
  const out: string[] = [];
  parseMarkdown(markdown).descendants((node) => {
    if (node.type === schema.nodes.horizontal_rule) {
      out.push("* * *");
      return false;
    }
    if (!node.isTextblock) return true;
    // The leaf text keeps hard breaks as line breaks.
    const text = node.textBetween(0, node.content.size, "\n", "\n").trim();
    if (text !== "") out.push(text);
    return false;
  });
  return out;
}

export function plainTextOf(markdown: string): string {
  return paragraphsOf(markdown).join("\n");
}

export function countMarkdown(markdown: string): TextCounts {
  return countText(plainTextOf(markdown));
}
