# Privacy: what Sheaf sends, and where

This page is written for users, in plain language. It must be updated in the
same change as any feature that touches the network.

## Right now (version 0.0.x)

**Sheaf sends nothing, anywhere** — unless you deliberately set up a
LanguageTool server of your own and enter its address (see below). Out of
the box, and by default, there is nowhere for your words to go.

- No account. No sign-in.
- No ads, and no advertising code of any kind.
- No analytics, usage statistics, crash reports, or "phoning home".
- Your writing stays in files on your device.

Two things Sheaf keeps beside your writing, also on your device only:

- **Past versions.** Before replacing text it hasn't kept recently, Sheaf
  writes the old version into a `snapshots` folder inside your project, so a
  paragraph you delete can come back. They are ordinary text files; delete
  the folder and you only lose the history.
- **A search index.** Titles, synopses and the text of your documents are
  copied into a database outside your project folder so search is fast. It is
  a cache: delete it and Sheaf rebuilds it from your files. Nothing in it
  leaves the device, and searching never contacts anything.

This is enforced by the app's content security policy, which blocks the app's
own pages from making network requests, and by automated checks that fail our
build if an advertising or analytics library is ever added. See
[`licences.md`](licences.md).

## Spelling and grammar checking

Checking your English happens **on this device**, in the app itself. Nothing
is uploaded, and there is no account, key or quota involved.

Chinese is never checked at all. That is a decision, not a missing feature:
no engine is good enough to be worth the false positives, so Sheaf says
"中文 · 未启用语法检查" in the status bar and leaves your words alone.

One setting can send text off the device, and only if you fill it in
yourself: **LanguageTool server**. If you run a LanguageTool server and enter
its address, paragraphs in languages Sheaf cannot check offline are sent to
that address so it can check them. Sheaf only accepts a plain `http://`
address — one on your own machine or network — so your manuscript cannot be
sent to a company's cloud service by a typo. Leave the field empty, which is
how it starts, and nothing is ever sent.

## Features that may send text later, and the rules for them

Some planned features can only work over a network: an optional grammar
server you run yourself, and optional sync. None of them is on by default. Each
one will:

1. be **off** until you switch it on, **per feature**;
2. show a consent screen first, saying exactly what is sent, to which address,
   and why;
3. only ever contact an address that **you** configured and confirmed;
4. be listed on this page.

Chinese text is never sent to a grammar service; Sheaf deliberately doesn't
grammar-check Chinese.

## Telemetry

None. If we ever want usage data, it will be opt-in, off by default,
self-hosted by the Sheaf project (no third-party analytics companies), and
described here in plain language before it ships.
