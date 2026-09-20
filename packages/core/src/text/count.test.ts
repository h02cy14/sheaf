import { describe, expect, it } from "vitest";
import { countText, wordTotal } from "./count";

describe("countText", () => {
  it("counts English words", () => {
    expect(countText("The ferry left her on the jetty.")).toMatchObject({ words: 7, cjk: 0 });
  });

  it("counts contractions and hyphenated words as writers expect", () => {
    expect(countText("It's a well-known fact.").words).toBe(4);
  });

  it("counts Chinese by character, not by whitespace", () => {
    const counts = countText("她推开门，看见了灯塔。");
    expect(counts.cjk).toBe(9);
    expect(counts.words).toBe(0);
    expect(counts.characters).toBe(11); // includes the two punctuation marks
  });

  it("counts Japanese kana and kanji as characters", () => {
    expect(countText("これは日本語です").cjk).toBe(8);
  });

  it("counts Korean by words (it uses spaces)", () => {
    expect(countText("한국어 텍스트 예문")).toMatchObject({ words: 3, cjk: 0 });
  });

  it("segments Thai into words", () => {
    expect(countText("สวัสดีครับ").words).toBeGreaterThanOrEqual(2);
  });

  it("handles mixed English and Chinese in one paragraph", () => {
    const counts = countText("He said 你好 and left 了。");
    expect(counts.words).toBe(4);
    expect(counts.cjk).toBe(3);
    expect(wordTotal(counts)).toBe(7);
  });

  it("counts emoji and combining characters as single characters", () => {
    const family = String.fromCodePoint(0x1f469, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const combining = `cafe${String.fromCharCode(0x301)}`;
    expect(countText(`${family} ${combining}`).characters).toBe(5);
  });

  it("ignores whitespace and punctuation-only input", () => {
    expect(countText("  \n\t— … !  ")).toMatchObject({ words: 0, cjk: 0 });
  });
});
