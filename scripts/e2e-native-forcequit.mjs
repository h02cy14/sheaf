#!/usr/bin/env node
// Phase 1 acceptance test, against the real native app (Windows):
// "write 5,000 words across 20 documents, force-quit the app, and lose nothing."
//
//   node scripts/e2e-native-forcequit.mjs <path-to-sheaf.exe> [workdir]
//
// Drives the app's WebView over the Chrome DevTools Protocol (WebView2's
// remote debugging port), types into the real editor, kills the process with
// no warning (TerminateProcess, like a crash or Task Manager "End task"),
// then checks the files on disk and that the relaunched app shows them.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: e2e-native-forcequit.mjs <sheaf.exe> [workdir]");
  process.exit(2);
}
const workdir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "sheaf-e2e-"));
const port = 9400 + Math.floor(Math.random() * 400);
const DOCS = 20;
const WORDS_PER_DOC = 250;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      throw new Error(`the app exited early with code ${app.exitCode}. Output:\n${appOutput.slice(-2000)}`);
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
        const evaluate = (expression) =>
          new Promise((resolve, reject) => {
            const n = ++id;
            pending.set(n, (msg) => {
              if (msg.result?.exceptionDetails)
                reject(new Error(JSON.stringify(msg.result.exceptionDetails)));
              else resolve(msg.result?.result?.value);
            });
            ws.send(
              JSON.stringify({
                id: n,
                method: "Runtime.evaluate",
                params: { expression, awaitPromise: true, returnByValue: true },
              }),
            );
          });
        return { ws, evaluate };
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`could not connect to the app's WebView on port ${port}. App output:\n${appOutput.slice(-2000)}`);
}

async function until(evaluate, expression, what, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
}

const words = (doc) => Array.from({ length: WORDS_PER_DOC }, (_, i) => `d${doc}w${i}`).join(" ");
const button = (label) =>
  `[...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(label)} || b.innerText.trim() === ${JSON.stringify(label)})`;

console.log(`workdir: ${workdir}`);
let app = launch();
let { ws, evaluate } = await connect();
// The app resumes the last project it had open; start from the home screen.
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

for (let d = 0; d < DOCS; d++) {
  if (d > 0) {
    await evaluate(`${button("New document")}.click()`);
    await until(
      evaluate,
      `document.activeElement?.getAttribute('aria-label') === 'Document title' && document.activeElement.value === 'Untitled'`,
      `title field ${d}`,
    );
    await evaluate(
      `document.execCommand('insertText', false, 'Scene ${d}'); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`,
    );
    await until(
      evaluate,
      `document.activeElement?.classList.contains('ProseMirror')`,
      `body focus ${d}`,
    );
  } else {
    await evaluate(`document.querySelector('.ProseMirror').focus()`);
  }
  // Type in bursts, like a person: 25 words at a time.
  const all = words(d).split(" ");
  for (let i = 0; i < all.length; i += 25) {
    const chunk = all.slice(i, i + 25).join(" ") + (i + 25 < all.length ? " " : "");
    await evaluate(`document.execCommand('insertText', false, ${JSON.stringify(chunk)})`);
    await sleep(40);
  }
}

// Let the last autosave debounce (500 ms) land, then pull the plug.
await sleep(1200);
ws.close();
execFileSync("taskkill", ["/F", "/PID", String(app.pid)]);
console.log("force-killed the app");
await sleep(1000);

// ---- verify on disk
const project = readdirSync(workdir).find((n) => n.endsWith(".sheaf"));
const docsDir = join(workdir, project, "docs");
const files = readdirSync(docsDir);
const temp = files.filter((f) => f.endsWith(".tmp"));
const bodies = files
  .filter((f) => f.endsWith(".md"))
  .map((f) => readFileSync(join(docsDir, f), "utf8").split(/\n---\n/)[1] ?? "");
let found = 0;
const missing = [];
for (let d = 0; d < DOCS; d++) {
  const expected = words(d);
  if (bodies.some((b) => b.includes(expected))) found++;
  else missing.push(d);
}
const totalWords = bodies.reduce((n, b) => n + (b.trim() ? b.trim().split(/\s+/).length : 0), 0);
console.log(
  `on disk: ${found}/${DOCS} documents complete, ${totalWords} words, ${temp.length} temp files`,
);

// ---- relaunch: the app resumes the project and shows every document
app = launch();
({ ws, evaluate } = await connect());
await until(
  evaluate,
  `document.querySelectorAll('[role=row]').length >= ${DOCS + 3}`,
  "binder after relaunch",
);
const rows = await evaluate(
  `[...document.querySelectorAll('[role=row]')].map(r => r.innerText.trim())`,
);
const scenes = rows.filter((r) => /^Scene \d+$/.test(r)).length;
console.log(
  `after relaunch: binder shows ${scenes + 1} of ${DOCS} documents (Chapter 1 + ${scenes} scenes)`,
);
ws.close();
execFileSync("taskkill", ["/F", "/PID", String(app.pid)]);

const ok = found === DOCS && totalWords >= DOCS * WORDS_PER_DOC && scenes === DOCS - 1;
console.log(ok ? "PASS: nothing lost" : `FAIL: missing documents ${missing.join(", ")}`);
process.exit(ok ? 0 : 1);
