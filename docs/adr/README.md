# Architecture decision records

**Why this exists:** decisions that are expensive to reverse (stack, file
format, sync model) get written down with the options we rejected and what we
gave up, so that later changes are deliberate rather than accidental.

| # | Decision | Status |
|---|---|---|
| [0001](0001-stack.md) | Application stack: Tauri 2 on all targets, React, ProseMirror | Accepted |
| [0002](0002-project-format.md) | Project file format: a folder of Markdown files, cache outside it | Accepted |
| [0003](0003-language-layer.md) | Language layer: our own detection, Harper in Rust, LanguageTool over plain http only, Chinese never checked | Accepted |

New ADRs copy [`template.md`](template.md), take the next number, and are
never deleted. A reversed decision gets a new ADR marked "Supersedes NNNN".
