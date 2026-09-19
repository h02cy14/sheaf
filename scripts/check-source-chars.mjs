#!/usr/bin/env node
// Fails if source files contain raw invisible or control characters (NUL,
// zero-width spaces, non-breaking spaces, combining marks, BOMs...). They are
// indistinguishable from ordinary characters in review and one of them (NUL)
// makes git treat a file as binary. Write them as escape sequences instead.
//
//   node scripts/check-source-chars.mjs --check <dirs...>   report and fail
//   node scripts/check-source-chars.mjs <dirs...>           rewrite as escapes
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BS = String.fromCharCode(92);
const ranges = [
  [0x0000, 0x0008],
  [0x000b, 0x000c],
  [0x000e, 0x001f],
  [0x00a0, 0x00a0],
  [0x0300, 0x036f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x2060, 0x2060],
  [0x3000, 0x3000],
  [0xfeff, 0xfeff],
];
const isInvisible = (cp) => ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
const exts = /\.(ts|tsx|mjs|js|css)$/;

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "dist", "target", "gen"].includes(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (exts.test(name)) out.push(p);
  }
  return out;
}

const check = process.argv.includes("--check");
let found = 0;
for (const root of process.argv.slice(2).filter((a) => !a.startsWith("--"))) {
  for (const file of walk(root, [])) {
    const text = readFileSync(file, "utf8");
    let fixed = "";
    const hits = [];
    for (const ch of text) {
      const cp = ch.codePointAt(0);
      if (isInvisible(cp)) {
        const hex = cp.toString(16).toUpperCase().padStart(4, "0");
        hits.push(`U+${hex}`);
        fixed += `${BS}u${hex}`;
      } else fixed += ch;
    }
    if (hits.length === 0) continue;
    found += hits.length;
    if (!check) writeFileSync(file, fixed, "utf8");
    console.log(`${check ? "found" : "fixed"} ${file}: ${hits.join(" ")}`);
  }
}
if (check && found > 0) process.exit(1);
