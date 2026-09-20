#!/usr/bin/env node
// Phase 2 acceptance test, against the real native app (Windows):
// "I can recover a paragraph I deleted." The core test proves the same thing
// across a day boundary with a fake clock; this one proves the whole path —
// UI, Rust file I/O, real disk — with the app the owner actually installs.
//
//   node scripts/e2e-native-history.mjs <path-to-sheaf.exe> [workdir]
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const exe = process.argv[2];
if (!exe) {
  console.error("usage: e2e-native-history.mjs <sheaf.exe> [workdir]");
  process.exit(2);
}
const workdir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "sheaf-history-"));
const port = 9800 + Math.floor(Math.random() * 180);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const KEPT = "The lighthouse keeper counted the waves until morning came.";
const REPLACEMENT = "Someone painted over that paragraph.";

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

/** The snapshot files on disk, newest first, with their text. */
function snapshotsOnDisk(project) {
  const root = join(workdir, project, "snapshots");
  const out = [];
  for (const docId of readdirSync(root)) {
    for (const name of readdirSync(join(root, docId))) {
      out.push({ docId, name, text: readFileSync(join(root, docId, name), "utf8") });
    }
  }
  return out.sort((a, b) => b.name.localeCompare(a.name));
}

function documentBodies(project) {
  const dir = join(workdir, project, "docs");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => readFileSync(join(dir, f), "utf8"));
}

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
const { ws, evaluate } = await connect();

// Start from a fresh project.
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

// Write a paragraph and let it save.
await evaluate(`document.querySelector('.ProseMirror').focus()`);
await evaluate(`document.execCommand('insertText', false, ${JSON.stringify(KEPT)})`);
await until(
  evaluate,
  `document.querySelector('[role="status"]')?.innerText.includes('Saved')`,
  "save",
);

// Keep a snapshot of it.
await evaluate(`${button("History")}.click()`);
await until(evaluate, `!!${button("Keep a snapshot")}`, "history dialog");
await evaluate(`${button("Keep a snapshot")}.click()`);
await until(
  evaluate,
  `document.querySelectorAll('[role="dialog"] button[aria-pressed]').length === 1`,
  "the snapshot to be listed",
);
await evaluate(`${button("Close")}.click()`);

// Destroy the paragraph, and let that save too.
await evaluate(`document.querySelector('.ProseMirror').focus(); document.execCommand('selectAll')`);
await evaluate(`document.execCommand('insertText', false, ${JSON.stringify(REPLACEMENT)})`);
await sleep(1200);
await until(
  evaluate,
  `document.querySelector('[role="status"]')?.innerText.includes('Saved')`,
  "save",
);

const project = readdirSync(workdir).find((n) => n.endsWith(".sheaf"));
if (!project) fail("no project folder was created");
const afterDelete = snapshotsOnDisk(project);
if (afterDelete.length !== 1) fail(`expected 1 snapshot on disk, found ${afterDelete.length}`);
if (!afterDelete[0].text.includes(KEPT)) fail("the snapshot does not hold the lost paragraph");
if (documentBodies(project).some((b) => b.includes(KEPT)))
  fail("the paragraph is still in the document; the test proves nothing");
console.log(`on disk: 1 snapshot (${afterDelete[0].name}) holds the deleted paragraph`);

// Put it back.
await evaluate(`${button("History")}.click()`);
await until(
  evaluate,
  `document.querySelectorAll('[role="dialog"] button[aria-pressed]').length >= 1`,
  "the snapshot list",
);
await evaluate(`document.querySelector('[role="dialog"] button[aria-pressed]').click()`);
await until(evaluate, `!${button("Restore")}.disabled`, "a selected snapshot");
await evaluate(`${button("Restore")}.click()`);
await until(
  evaluate,
  `document.querySelector('.ProseMirror').innerText.includes(${JSON.stringify(KEPT)})`,
  "the restored paragraph in the editor",
);
await evaluate(`${button("Close")}.click()`);
await sleep(1200);

const afterRestore = snapshotsOnDisk(project);
if (!documentBodies(project).some((b) => b.includes(KEPT)))
  fail("the document on disk does not hold the restored paragraph");
if (afterRestore.length !== 2)
  fail(`expected 2 snapshots after the restore, found ${afterRestore.length}`);
if (!afterRestore.some((s) => s.name.includes("before-restore") && s.text.includes(REPLACEMENT)))
  fail("the restore did not keep the text it replaced");
console.log("after restore: the paragraph is back in the document, and the restore is undoable");

ws.close();
execFileSync("taskkill", ["/F", "/PID", String(app.pid)]);
console.log("PASS: a deleted paragraph came back");
