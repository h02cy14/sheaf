#!/usr/bin/env node
// Phase 3 acceptance test, against the real native app (Windows):
// "CJK typing is flawless, and a mixed English/Chinese document checks the
// English and leaves the Chinese alone."
//
//   node scripts/e2e-native-ime.mjs <path-to-sheaf.exe> [workdir]
//
// IME composition is the single most common way web editors break for
// Chinese, Japanese and Korean writers (brief §7), so this drives the real
// WebView's IME path — Input.imeSetComposition, the same code path a
// keyboard uses — rather than faking key events.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: e2e-native-ime.mjs <sheaf.exe> [workdir]");
  process.exit(2);
}
const workdir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "sheaf-ime-"));
const port = 9500 + Math.floor(Math.random() * 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a pinyin IME shows while composing 你好, then what it commits. */
const COMPOSITION_STEPS = ["n", "ni", "nih", "niha", "nihao"];
const COMMITTED = "你好";
const SENTENCE = "，世界。";
const ENGLISH = "The keeper counted the the waves.";
const ARABIC = "حارس الفنار ينتظر الفجر";

let appOutput = "";

function launch() {
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      SHEAF_PROJECTS_DIR: workdir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (appOutput += d));
  child.stderr.on("data", (d) => (appOutput += d));
  return child;
}

async function connect() {
  for (let i = 0; i < 120; i++) {
    if (app.exitCode !== null) {
      throw new Error(
        `the app exited early with code ${app.exitCode}. Output:\n${appOutput.slice(-2000)}`,
      );
    }
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      const page = targets.find((t) => t.type === "page");
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => {
          ws.addEventListener("open", r, { once: true });
          ws.addEventListener("error", j, { once: true });
        });
        let id = 0;
        const pending = new Map();
        ws.addEventListener("message", (ev) => {
          const msg = JSON.parse(ev.data);
          pending.get(msg.id)?.(msg);
          pending.delete(msg.id);
        });
        const send = (method, params = {}) =>
          new Promise((resolve, reject) => {
            const n = ++id;
            pending.set(n, (msg) => {
              if (msg.error) reject(new Error(JSON.stringify(msg.error)));
              else resolve(msg.result);
            });
            ws.send(JSON.stringify({ id: n, method, params }));
          });
        const evaluate = async (expression) => {
          const result = await send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          });
          if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
          return result?.result?.value;
        };
        return { ws, send, evaluate };
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`could not connect to the app's WebView on port ${port}`);
}

async function until(evaluate, expression, what, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const button = (label) =>
  `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.innerText.trim() === ${JSON.stringify(label)})`;

function fail(message) {
  console.error(`FAIL: ${message}`);
  try {
    execFileSync("taskkill", ["/F", "/PID", String(app.pid)]);
  } catch {
    // already gone
  }
  process.exit(1);
}

console.log(`workdir: ${workdir}`);
let app = launch();
const { ws, send, evaluate } = await connect();

await until(evaluate, `!!(${button("New project")} || ${button("Close project")})`, "first screen");
if (await evaluate(`!!${button("Close project")}`))
  await evaluate(`${button("Close project")}.click()`);
await until(evaluate, `!!${button("New project")}`, "home screen");
await evaluate(`${button("New project")}.click()`);
await until(
  evaluate,
  `document.querySelector('.ProseMirror')?.getAttribute('contenteditable') === 'true'`,
  "editor",
);
await evaluate(`document.querySelector('.ProseMirror').focus()`);

// ---- 1. Composing 你好 the way a pinyin IME does.
for (const step of COMPOSITION_STEPS) {
  await send("Input.imeSetComposition", {
    text: step,
    selectionStart: step.length,
    selectionEnd: step.length,
  });
  await sleep(30);
}
const composing = await evaluate(`document.querySelector('.ProseMirror').innerText`);
if (!composing.includes("nihao"))
  fail(`the composition is not visible while typing: ${JSON.stringify(composing)}`);

// Choosing the candidate commits the characters.
await send("Input.insertText", { text: COMMITTED });
await sleep(120);
let text = await evaluate(`document.querySelector('.ProseMirror').innerText`);
if (text.trim() !== COMMITTED)
  fail(`after committing, expected ${COMMITTED}, got ${JSON.stringify(text)}`);
console.log("composition: 你好 committed, nothing left over from the pinyin");

// ---- 2. Backspace part-way through a composition leaves the text alone.
for (const step of ["s", "sh", "shi"]) {
  await send("Input.imeSetComposition", {
    text: step,
    selectionStart: step.length,
    selectionEnd: step.length,
  });
  await sleep(30);
}
await send("Input.imeSetComposition", { text: "sh", selectionStart: 2, selectionEnd: 2 });
await sleep(60);
// Cancelling the composition entirely, as pressing Escape on an IME does.
await send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
await sleep(120);
text = await evaluate(`document.querySelector('.ProseMirror').innerText`);
if (text.trim() !== COMMITTED) {
  fail(`cancelling a composition should leave "${COMMITTED}"; got ${JSON.stringify(text)}`);
}
console.log("composition: backspace and cancel mid-composition leave the committed text alone");

// ---- 3. The rest of the sentence, then a second paragraph in English.
await send("Input.insertText", { text: SENTENCE });
await evaluate(
  `document.querySelector('.ProseMirror').focus(); document.execCommand('insertParagraph')`,
);
await send("Input.insertText", { text: ENGLISH });
await sleep(200);

// ---- 4. The counts treat Chinese as characters and English as words:
// 你好世界 is 4 characters, the English sentence is 6 words, so 10 in all.
await until(
  evaluate,
  `/\\b10\\b/.test(document.querySelector('[aria-label="Word counts"]')?.innerText ?? '')`,
  "the counts to catch up with what was typed",
);
const counts = await evaluate(
  `document.querySelector('[aria-label="Word counts"]').innerText.replace(/\\n/g, ' | ')`,
);
console.log(`counts: ${counts}`);

// ---- 5. The checker: English is checked, Chinese is left alone.
await until(
  evaluate,
  `document.querySelectorAll('.ProseMirror [data-grammar-kind]').length > 0`,
  "the English mistake to be underlined",
  20000,
);
const underlined = await evaluate(
  `JSON.stringify([...document.querySelectorAll('.ProseMirror [data-grammar-kind]')].map(e => e.textContent))`,
);
if (!underlined.includes("the the"))
  fail(`expected the repeated word to be underlined, got ${underlined}`);

const chineseUnderlined = await evaluate(
  `[...document.querySelectorAll('.ProseMirror [data-grammar-kind]')].some(e => /[\\u4e00-\\u9fff]/.test(e.textContent))`,
);
if (chineseUnderlined) fail("Chinese text was marked by the checker; it must never be");
console.log("checker: the English mistake is underlined, the Chinese is untouched");

// ---- 6. The indicator says what is happening, calmly.
await evaluate(`document.querySelector('.ProseMirror').focus()`);
const indicator = await evaluate(
  `document.querySelector('footer [class*="indicator"]')?.innerText.replace(/\\n/g, ' ')`,
);
console.log(`indicator (cursor in the English paragraph): ${indicator}`);

// ---- 6b. The same indicator, with the cursor in the Chinese paragraph,
// says that not checking it is a decision rather than a failure.
await evaluate(`{
  const p = document.querySelector('.ProseMirror p');
  const range = document.createRange();
  range.setStart(p.firstChild, 1);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.querySelector('.ProseMirror').focus();
}`);
await sleep(300);
const chineseIndicator = await evaluate(
  `document.querySelector('footer button[class*="indicator"]')?.innerText.replace(/\\n/g, ' ')`,
);
if (!/Chinese/.test(chineseIndicator ?? "")) {
  fail(`the indicator should name the Chinese paragraph; got ${JSON.stringify(chineseIndicator)}`);
}
console.log(`indicator (cursor in the Chinese paragraph): ${chineseIndicator}`);

// ---- 6c. Clicking an underline offers the fix, and one tap applies it.
await evaluate(`{
  const mark = document.querySelector('.ProseMirror [data-grammar-kind]');
  const rect = mark.getBoundingClientRect();
  for (const type of ['mousedown', 'mouseup', 'click']) {
    mark.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  }
}`);
await until(
  evaluate,
  `!!document.querySelector('[role="dialog"][aria-label]')`,
  "the suggestion card",
);
await evaluate(`{
  const card = document.querySelector('[role="dialog"][aria-label]');
  const fix = [...card.querySelectorAll('button')].find((b) => b.innerText.trim() === 'the');
  fix.click();
}`);
await sleep(400);
const fixed = await evaluate(`document.querySelector('.ProseMirror').innerText`);
if (fixed.includes("the the")) fail(`the suggestion did not apply: ${JSON.stringify(fixed)}`);
console.log("suggestion card: one tap replaced “the the” with “the”");

// ---- 7. Right-to-left text lays itself out right to left, per paragraph.
// Start from the end of the document, wherever the cursor happens to be.
await evaluate(`{
  const paragraphs = [...document.querySelectorAll('.ProseMirror p')];
  const last = paragraphs[paragraphs.length - 1];
  const range = document.createRange();
  range.selectNodeContents(last);
  range.collapse(false);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.querySelector('.ProseMirror').focus();
}`);
await evaluate(`document.execCommand('insertParagraph')`);
await send("Input.insertText", { text: ARABIC });
await sleep(150);
const directions = await evaluate(
  `JSON.stringify([...document.querySelectorAll('.ProseMirror p')].map(p => getComputedStyle(p).direction))`,
);
const parsed = JSON.parse(directions);
if (!parsed.includes("rtl"))
  fail(`the Arabic paragraph should be right to left; got ${directions}`);
if (!parsed.includes("ltr"))
  fail(`the English paragraph should stay left to right; got ${directions}`);
console.log(`direction per paragraph: ${directions}`);

// ---- 8. What reached the disk is exactly what was typed.
await sleep(1500);
const project = readdirSync(workdir).find((n) => n.endsWith(".sheaf"));
if (!project) fail("no project folder was created");
const docs = join(workdir, project, "docs");
const bodies = readdirSync(docs)
  .filter((f) => f.endsWith(".md"))
  .map((f) => readFileSync(join(docs, f), "utf8"));
const saved = bodies.find((b) => b.includes(COMMITTED));
if (!saved) fail("the Chinese text never reached the disk");
if (!saved.includes(`${COMMITTED}${SENTENCE}`))
  fail(`the saved text is not what was typed:\n${saved}`);
if (/nihao|shi\b/.test(saved)) fail(`pinyin leaked into the saved file:\n${saved}`);
console.log("on disk: 你好，世界。saved exactly, with no pinyin left behind");

ws.close();
execFileSync("taskkill", ["/F", "/PID", String(app.pid)]);
console.log("PASS: CJK input, mixed-language checking and bidi all behave");
