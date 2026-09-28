# Third-party notices

OpenADE’s desktop UI adapts layout dimensions and motion specifications from
[Zeron](https://github.com/zeronsh/zeron), Copyright (c) 2026 Wing, MIT licensed.
The complete notice is retained in `licenses/Zeron-MIT.txt`. Sidebar diagonal
hover intent and switch geometry/motion follow the pinned MIT-licensed
`crates/ui/src/shell/spaces.rs` and `crates/ui/src/settings/widgets.rs`.
Composer dimensions, measured compact/expanded switching and resize hysteresis,
and user-message width/folding follow `crates/ui/src/composer.rs` and
`crates/ui/src/transcript.rs`.

Bundled Geist and Geist Mono fonts are distributed under the SIL Open Font
License 1.1. The full notice is retained in `licenses/Geist-OFL.txt`.

Icons use the existing Phosphor React package and its MIT license.

The Claude, OpenAI, Cursor, Grok, Devin, Hermes, Pi, and Antigravity provider marks are adapted from Zeron’s MIT-licensed UI assets; the marks identify their respective providers. Gruvbox palette values follow Zeron’s bundled Gruvbox theme mapping.

The Cursor JSONL shim adapts Zeron's MIT-licensed `crates/harness/src/cursor/shim.mjs` for OpenADE. Its notice is retained beside the shim in `internal/daemon/cursor_adapter/LICENSE.zeron`. The pinned `@cursor/sdk` package is installed separately from npm on first use and is not bundled in this repository or app archive.

The macOS Frosted window material adapts GPUI's Apache-2.0 macOS rendering
recipe (Zed Industries, Inc., 2022-2025; zeronsh/zui revision
18a89af04cfe079d55275b111ac349d5640d9cda), translated for Wails and modified
for OpenADE. The license is retained in `licenses/GPUI-macOS-Apache-2.0.txt`.
