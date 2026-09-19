#!/usr/bin/env node
// Dependency guardrails for the JavaScript side (the Rust side uses cargo-deny,
// configured in /deny.toml). Runs in CI; exits non-zero on any violation.
//
// 1. Licence allowlist for everything that ships in the app bundle.
//    Anything else, especially copyleft or commercial, must be discussed with the
//    owner and recorded in docs/licences.md before it's added here.
// 2. Ads/tracking denylist across the whole lockfile, dev dependencies included.
//    The brief forbids ad SDKs and third-party analytics outright.
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ALLOWED_LICENCES = new Set([
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Zlib",
  // PSF licence: permissive, no copyleft. Only `argparse`, used by
  // markdown-it's command-line tool and never bundled (docs/licences.md).
  "Python-2.0",
]);

// Exact names, or prefixes ending in "/" for whole npm scopes.
const DENIED_PACKAGES = [
  // Ad SDKs
  "@capacitor-community/admob",
  "react-native-google-mobile-ads",
  "@admob-plus/",
  "applovin",
  "unity-ads",
  // Analytics, session recording, third-party crash reporting
  "firebase",
  "@firebase/",
  "@react-native-firebase/",
  "@sentry/",
  "@bugsnag/",
  "posthog-js",
  "posthog-node",
  "mixpanel",
  "mixpanel-browser",
  "amplitude-js",
  "@amplitude/",
  "@segment/",
  "analytics-node",
  "react-ga",
  "react-ga4",
  "@datadog/browser-rum",
  "@datadog/browser-logs",
  "logrocket",
  "@fullstory/",
  "@hotjar/",
  "smartlook-client",
  "@microsoft/applicationinsights-web",
  "@newrelic/",
];

/** True when an SPDX expression can be satisfied using only allowed licences. */
function licenceAllowed(expression) {
  const cleaned = expression.replace(/[()]/g, " ").trim();
  return cleaned
    .split(/\s+OR\s+/)
    .some((alternative) =>
      alternative
        .split(/\s+AND\s+/)
        .every((id) => ALLOWED_LICENCES.has(id.trim().replace(/\+$/, ""))),
    );
}

function isDenied(name) {
  return DENIED_PACKAGES.some((d) => (d.endsWith("/") ? name.startsWith(d) : name === d));
}

const problems = [];

// 1. Licences of production dependencies.
// Under `pnpm check:deps`, npm_execpath is pnpm's own JS entry point; running
// it with node avoids spawning a shell (pnpm is a .cmd shim on Windows).
const pnpmEntry = process.env["npm_execpath"];
const pnpmArgs = ["licenses", "list", "--prod", "--json"];
const raw = pnpmEntry
  ? execFileSync(process.execPath, [pnpmEntry, ...pnpmArgs], { cwd: root, encoding: "utf8" })
  : execSync(`pnpm ${pnpmArgs.join(" ")}`, { cwd: root, encoding: "utf8" });
const byLicence = JSON.parse(raw);
let shipped = 0;
for (const [licence, packages] of Object.entries(byLicence)) {
  for (const pkg of packages) {
    shipped++;
    if (!licenceAllowed(licence)) {
      problems.push(
        `licence: ${pkg.name}@${pkg.versions.join(",")} is "${licence}", not on the allowlist`,
      );
    }
  }
}

// 2. Denylisted packages anywhere in the lockfile.
const lock = readFileSync(join(root, "pnpm-lock.yaml"), "utf8");
const packagesSection = lock.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0] ?? "";
const locked = new Set();
for (const match of packagesSection.matchAll(/^ {2}'?((?:@[^/@\s']+\/)?[^@\s']+)@/gm)) {
  locked.add(match[1]);
}
for (const name of locked) {
  if (isDenied(name))
    problems.push(`denylist: "${name}" is an ads/tracking package and is forbidden`);
}

if (problems.length > 0) {
  console.error(`Dependency check failed (${problems.length}):\n  - ${problems.join("\n  - ")}`);
  process.exit(1);
}
console.log(
  `Dependency check passed: ${shipped} production packages on the licence allowlist; ` +
    `${locked.size} locked packages, none on the ads/tracking denylist.`,
);
