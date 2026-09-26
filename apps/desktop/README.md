# OpenADE desktop

The current runtime is Go 1.26 / Wails 2.10.2 / React 19. A durable, authenticated loopback engine owns SQLite WAL state, agent processes, worktrees, transcripts and project terminals. Wails is a replaceable client. Native chat uses structured pipes; Direct TUI and shells use PTYs.

See the [root README](../../README.md) for build/run/profile configuration and the [verification guide](../../docs/zeron-rebuild.md) for end-to-end coverage and parity limits. Do not bake test connection variables into a native build. The old Tauri and Rust sources are historical references.
