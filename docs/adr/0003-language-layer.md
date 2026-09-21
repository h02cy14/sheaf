# ADR 0003: The language layer

- **Status:** Accepted
- **Date:** 2026-09-21
- **Deciders:** project owner, lead engineer

## Context

The brief (§7) is unusually specific about languages, and for good reason:
this is where writing tools quietly fail their non-English users. It asks for
per-paragraph language detection, correct IME behaviour, bidi text,
language-aware counting, spelling, offline English grammar, optional
LanguageTool, and — stated twice — **no checking of Chinese at all**, shown
as a calm indicator rather than an absence.

Four decisions were open.

## Decision 1: detection is ours, in TypeScript, in `@sheaf/core`

The brief suggested `lingua-rs` or `whatlang`. Both are good, both are Rust,
and both would have put the decision behind the shell — invisible to the
browser preview and untestable in Node.

What Sheaf actually needs from detection is narrow: *which checker, if any,
should see this paragraph*. That is answered by the script for CJK, Arabic,
Hebrew, Cyrillic, Greek, Thai and Devanagari, and by a stopword vote for the
handful of Latin-script languages where the answer changes what happens.
About 150 lines, no dependency, and it runs everywhere the format code runs.

Detection also reports **how sure it is**, because the brief says never to
trust it silently on a short paragraph: a low-confidence answer defers to the
language the writer declared for the document, then the project.

**Giving up:** accuracy on unusual Latin-script languages. A paragraph of
Finnish will read as "some Latin language we have no engine for", which leads
to exactly the same outcome as a correct guess — nothing is checked, and the
indicator says so. If that stops being true (a Finnish engine appears), swap
the vote for `lingua-rs` behind the same function.

### Overrides, and where a paragraph's language is kept

The brief asks for a manual override "at document level and at paragraph
level". A document is a file, so its language is a frontmatter field. A
paragraph is not anything — Markdown gives it no id and no attribute we could
add without spoiling the file for every other tool.

So a paragraph override is anchored to the paragraph's **opening words**
(first 48 characters, whitespace normalised) and kept in the document's
frontmatter under `paragraphLanguages`. Moving the paragraph keeps the
override; rewriting its opening drops it, which is the honest behaviour —
the choice was made about that sentence, not about that position. Overrides
whose paragraph has gone are pruned the next time one is set.

## Decision 2: Harper runs in Rust, not as WASM in the page

Harper (Apache-2.0) is the engine the brief names for offline English, and
`harper-core` is a crate. Two ways in: `harper.js` (WASM, in the page) or the
crate, in our shell.

The crate wins on the brief's own terms: checking runs on a real background
thread (`spawn_blocking`), not on the UI thread's event loop; the JavaScript
bundle does not grow by a megabyte on phones; and the page keeps its content
security policy, which is what makes "your text cannot leave the device" a
property of the build rather than a promise.

**The cost, measured:** the Windows binary went from 8.7 MB to 16.9 MB, and
a clean release build from ~1m45 to ~2m45. Harper's part-of-speech tagger
pulls in `burn`, a small machine-learning stack, and with it one MPL-2.0
crate (`colored`) — flagged to the owner in `docs/licences.md` as the policy
requires.

**Consequence:** the browser preview has no checker. That is not an error
state — it takes the same path as any language with no engine, and says so.

## Decision 3: LanguageTool over plain HTTP only

LanguageTool is LGPL, so it stays a separate process; Sheaf speaks to its
HTTP API and links none of it. The brief requires that it is never contacted
unless the writer configured an endpoint, with "local only or nothing" as the
default.

Sheaf goes one step further: **`https://` endpoints are refused.** The only
address that works is `http://…`, which in practice means a server on the
writer's own machine or network. A manuscript therefore cannot be sent to a
cloud grammar service by a mistyped setting, a shared project file, or a
well-meant suggestion in a forum post.

This is enforced in three places so that no single mistake reopens it: the
settings parser in `@sheaf/core`, the dialog, and the shell that makes the
call. The HTTP client (`ureq`) is built without TLS at all, so there is no
code path to an `https` server even if the checks were bypassed.

**Giving up:** the hosted LanguageTool service, and any LAN server that only
speaks TLS. Re-enabling it is one Cargo feature (`ureq/rustls`) plus removing
three checks — an owner decision, not a bug.

## Decision 4: suppression is a rule, not a setting

Chinese (and Cantonese and the other Han-script tags) is never checked, even
when checking is on, even when a LanguageTool endpoint exists, and even
though LanguageTool has no Chinese support to offer anyway. The same
treatment covers every language with no engine.

The writer is told once, in the status bar, in the same quiet voice used for
"checked": `中文 · 未启用语法检查`. There is no prompt to enable anything,
because there is nothing to enable.

## Alternatives considered

- **Hunspell/Nuspell for spelling in other languages.** Not in Phase 3.
  Harper covers English spelling; adding Hunspell means shipping or
  downloading dictionaries whose licences vary by language (some GPL), which
  needs its own design and its own owner decision. Recorded in
  `docs/licences.md` and left for a later phase.
- **The platform's own spellchecker** (`spellcheck="true"`). Still used where
  Sheaf has no engine of its own (the browser preview); switched off in the
  app, so two checkers never disagree about the same word.
- **Checking on every keystroke.** Rejected by the brief and by taste: checks
  run after a 700 ms pause, batched per language, and each paragraph's result
  is cached so untouched paragraphs are never re-sent.
