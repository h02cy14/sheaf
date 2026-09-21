import { describe, expect, it } from "vitest";
import { baseLanguage, detectLanguage, languageFor, UNKNOWN_LANGUAGE } from "./detect";
import { chooseChecker, wouldLeaveDevice } from "./policy";
import { countScripts, dominantScript, isRtlLanguage, isRtlText } from "./script";

describe("script detection", () => {
  it("names the script of a paragraph", () => {
    expect(dominantScript("The lighthouse keeper waited.")).toBe("latin");
    expect(dominantScript("她在灯塔旁等待了很久。")).toBe("han");
    expect(dominantScript("ひらがなを書く")).toBe("kana");
    expect(dominantScript("등대지기는 기다렸다")).toBe("hangul");
    expect(dominantScript("حارس الفنار ينتظر")).toBe("arabic");
    expect(dominantScript("שומר המגדלור חיכה")).toBe("hebrew");
    expect(dominantScript("123 — ...")).toBeNull();
  });

  it("counts a mixed paragraph without letting punctuation vote", () => {
    const counts = countScripts("Dawn came。 她在灯塔旁等待。");
    expect(counts.latin).toBe(8); // D-a-w-n c-a-m-e
    expect(counts.han).toBe(7);
  });

  it("knows which text and which languages read right to left", () => {
    expect(isRtlText("حارس الفنار ينتظر الفجر")).toBe(true);
    expect(isRtlText("The keeper waited")).toBe(false);
    expect(isRtlLanguage("he")).toBe(true);
    expect(isRtlLanguage("fa-IR")).toBe(true);
    expect(isRtlLanguage("en-GB")).toBe(false);
  });
});

describe("language detection", () => {
  it("names CJK languages on sight", () => {
    expect(detectLanguage("她在灯塔旁等待了很久。")).toEqual({
      language: "zh",
      confidence: "high",
    });
    expect(detectLanguage("彼女は灯台のそばで待っていた")).toEqual({
      language: "ja",
      confidence: "high",
    });
    expect(detectLanguage("등대지기는 아침까지 파도를 세었다")).toEqual({
      language: "ko",
      confidence: "high",
    });
  });

  it("tells common Latin-script languages apart", () => {
    const cases: [string, string][] = [
      ["The keeper counted the waves until the morning came and the light went out", "en"],
      ["El farero contó las olas hasta que llegó la mañana y se apagó la luz", "es"],
      ["Le gardien a compté les vagues jusqu'à ce que le matin arrive et que la lumière", "fr"],
      ["Der Wärter zählte die Wellen bis der Morgen kam und das Licht nicht mehr", "de"],
      ["Il guardiano ha contato le onde per tutta la notte con la luce che non si", "it"],
    ];
    for (const [text, expected] of cases) {
      expect(detectLanguage(text).language, text.slice(0, 20)).toBe(expected);
    }
  });

  it("admits when a paragraph is too short to judge", () => {
    expect(detectLanguage("Yes.").confidence).toBe("low");
    expect(detectLanguage("Le.").confidence).toBe("low");
    expect(detectLanguage("").confidence).toBe("none");
    // …but a short line of Chinese is still obviously Chinese.
    expect(detectLanguage("好的。")).toEqual({ language: "zh", confidence: "high" });
  });

  it("prefers what the writer declared, then the document's language", () => {
    expect(languageFor("Yes.", "fr", "en")).toBe("fr");
    expect(languageFor("Yes.", null, "de")).toBe("de");
    expect(languageFor("她在灯塔旁等待。", null, "en")).toBe("zh");
    expect(languageFor("", null, null)).toBe(UNKNOWN_LANGUAGE);
  });

  it("treats regional tags as one language", () => {
    expect(baseLanguage("en-GB")).toBe("en");
    expect(baseLanguage("zh-Hant-TW")).toBe("zh");
  });
});

describe("checker policy", () => {
  const on = { checkGrammar: true, languageToolEndpoint: null };
  const harper = { harper: true };

  it("never checks Chinese, whatever is configured", () => {
    for (const settings of [
      on,
      { checkGrammar: true, languageToolEndpoint: "http://localhost:8081/v2/check" },
      { checkGrammar: false, languageToolEndpoint: null },
    ]) {
      expect(chooseChecker("zh", settings, harper)).toEqual({
        engine: "none",
        language: "zh",
        reason: "chinese",
      });
    }
    expect(chooseChecker("zh-Hant", on, harper).reason).toBe("chinese");
    expect(chooseChecker("yue", on, harper).reason).toBe("chinese");
    expect(
      wouldLeaveDevice("zh", { checkGrammar: true, languageToolEndpoint: "http://x" }, harper),
    ).toBe(false);
  });

  it("checks English with Harper, offline", () => {
    expect(chooseChecker("en", on, harper)).toEqual({ engine: "harper", language: "en" });
    expect(chooseChecker("en-GB", on, harper).engine).toBe("harper");
  });

  it("stays quiet when there is no engine for a language", () => {
    expect(chooseChecker("fr", on, harper)).toEqual({
      engine: "none",
      language: "fr",
      reason: "no-engine",
    });
    expect(chooseChecker(UNKNOWN_LANGUAGE, on, harper).reason).toBe("unknown-language");
  });

  it("uses LanguageTool only for an endpoint the writer configured", () => {
    const configured = {
      checkGrammar: true,
      languageToolEndpoint: "http://localhost:8081/v2/check",
    };
    expect(chooseChecker("fr", configured, harper).engine).toBe("languagetool");
    // English still prefers the offline engine: nothing leaves the device.
    expect(chooseChecker("en", configured, harper).engine).toBe("harper");
    expect(wouldLeaveDevice("fr", on, harper)).toBe(false);
    expect(wouldLeaveDevice("fr", configured, harper)).toBe(true);
  });

  it("says so when the writer turned checking off", () => {
    expect(
      chooseChecker("en", { checkGrammar: false, languageToolEndpoint: null }, harper),
    ).toEqual({
      engine: "none",
      language: "en",
      reason: "turned-off",
    });
  });

  it("falls back to nothing where Harper isn't bundled (the browser preview)", () => {
    expect(chooseChecker("en", on, { harper: false }).reason).toBe("no-engine");
  });
});
