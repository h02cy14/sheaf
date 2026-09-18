# Architecture decision records

**Why this exists:** decisions that are expensive to reverse (stack, file
format, sync model) get written down with the options we rejected and what we
gave up, so that later changes are deliberate rather than accidental.

| # | Decision | Status |
|---|---|---|
| [0001](0001-stack.md) | Application stack: Tauri 2 on all targets, React, ProseMirror | Accepted |
| 0002 | Project file format (Phase 1) | Planned |

New ADRs copy [`template.md`](template.md), take the next number, and are
never deleted. A reversed decision gets a new ADR marked "Supersedes NNNN".
