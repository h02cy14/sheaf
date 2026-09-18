# Privacy: what Sheaf sends, and where

This page is written for users, in plain language. It must be updated in the
same change as any feature that touches the network.

## Right now (version 0.0.x)

**Sheaf sends nothing, anywhere.**

- No account. No sign-in.
- No ads, and no advertising code of any kind.
- No analytics, usage statistics, crash reports, or "phoning home".
- Your writing stays in files on your device.

This is enforced by the app's content security policy, which blocks the app's
own pages from making network requests, and by automated checks that fail our
build if an advertising or analytics library is ever added. See
[`licences.md`](licences.md).

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
