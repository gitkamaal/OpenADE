# OpenADE

**A local-first agentic development environment for running multiple coding agents without mixing their work.**

OpenADE gives Claude Code, Codex CLI, GitHub Copilot CLI, and OpenCode a shared desktop control surface. Each task runs in its own Git worktree and branch, while one durable local daemon owns the PTYs, transcripts, queues, and SQLite session index.

The desktop window is only a client. Closing it does not stop active agents or project terminals.

> This branch contains the current Go + Wails desktop implementation. The older Rust/Tauri prototype remains in `crates/` as reference code, but it is not the runtime described below.

![OpenADE home workspace with isolated active sessions](docs/img/openade-home.png)

## Current capabilities

- **Isolated work per task** — every session gets a dedicated Git worktree and branch. Ticket keys are included in branch and pull-request naming when provided.
- **Durable sessions** — a single local daemon owns agent processes, PTYs, scrollback, transcripts, and SQLite state across desktop restarts.
- **Native chat** — Codex and Claude structured output streams into a Markdown conversation with collapsible activity, tool intent, code blocks, and message queueing.
- **Direct TUI** — attach to the real Codex or Claude terminal interface, including dynamic terminal resizing and provider resume behavior.
- **Independent terminals** — open multiple ordinary project shells without mixing shell output into the agent conversation.
- **Surface preferences** — choose Native chat or Direct TUI as the default. Opening an existing Codex or Claude session converts it to the preferred surface when necessary.
- **Project continuity** — scan a workspace root for Git repositories and discover resumable local Codex and Claude conversations.
- **Multi-agent overview** — browse running, waiting, completed, failed, and priority sessions across repositories.
- **Review workspace** — inspect changed files and unified diffs beside the conversation.
- **GitHub delivery** — list pull requests and push a session branch into a draft PR through the locally authenticated `gh` CLI.
- **Jira-linked work** — associate a Jira key and URL with a session and fetch ticket details through the local `jira` CLI.
- **Reusable workflows** — start from focused delivery, debugging, review, and testing prompts; provider commands and local skills are available from chat.
- **Themes** — Graphite, Dusk, Paper, System, and an optional Glass appearance.
- **Sites surface** — presentation-only Sites UI with search, refresh, and create hooks. Persistence and execution are intentionally not implemented here.

## Product tour

### See every agent and its priority at a glance

The Sessions view keeps running, completed, and failed work visible across projects, with linked tickets and current status in one scan-friendly table.

![OpenADE sessions overview](docs/img/openade-sessions.png)

### Review native chat and code changes together

Structured Codex and Claude output becomes readable Markdown while the Changes panel keeps the file list and diff attached to the same session.

![OpenADE native chat beside the changes review panel](docs/img/openade-native-chat-review.png)

### Use the provider's real terminal interface

Direct TUI renders Claude Code or Codex inside the daemon-owned PTY. It resizes with the window and survives closing and reopening the desktop client.

![OpenADE Direct TUI running Claude Code](docs/img/openade-direct-tui.png)

## Requirements

The current developer build is exercised on macOS Apple Silicon.

- Go 1.26+
- CGO enabled
- Node.js 20+
- npm
- Wails CLI 2.10.2
- Git
- At least one supported agent CLI installed and authenticated

Install Wails at the version used by the project:

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@v2.10.2
```

Supported agent executables:

| Provider | Executable | Native chat | Direct TUI | Resume |
|---|---|---:|---:|---:|
| Claude Code | `claude` | Yes | Yes | Yes |
| Codex CLI | `codex` | Yes | Yes | Yes |
| GitHub Copilot CLI | `copilot` | No | Raw CLI | No |
| OpenCode | `opencode` | No | Raw CLI | No |
| Local shell | `$SHELL` | No | Terminal | No |

Optional integrations:

- [GitHub CLI](https://cli.github.com) (`gh auth login`) for pull-request listing and creation.
- Jira CLI (`jira`) for live ticket metadata.

OpenADE does not proxy or store provider credentials. Each integration uses the CLI already authenticated on the machine.

## Build and run

```sh
git clone https://github.com/gitkamaal/OpenADE.git
cd OpenADE/apps/desktop
npm ci
npm run build
CGO_ENABLED=1 "$(go env GOPATH)/bin/wails" build -m -skipbindings -s
open build/bin/OpenADE.app
```

The packaged application starts or reconnects to the daemon at `127.0.0.1:7433`.

For native development:

```sh
cd apps/desktop
npm ci
CGO_ENABLED=1 "$(go env GOPATH)/bin/wails" dev
```

For browser-only frontend work, run the daemon and Vite separately:

```sh
# terminal 1
cd apps/desktop
export OPENADE_DATA_DIR="$PWD/.local-dev"
go run . --daemon --addr 127.0.0.1:7434

# terminal 2
cd apps/desktop
export OPENADE_DATA_DIR="$PWD/.local-dev"
VITE_OPENADE_DAEMON_URL=http://127.0.0.1:7434 VITE_OPENADE_AUTH_TOKEN="$(cat "$OPENADE_DATA_DIR/engine.token")" npm run dev
```

## First session

1. Open **Settings** and choose the default agent and Native chat or Direct TUI.
2. Select a workspace root to populate the Projects sidebar with repositories and resumable provider conversations.
3. Start a task from Home or choose a reusable workflow.
4. Select a Git repository and base branch.
5. Optionally add a Jira key such as `ADE-123` and its ticket URL.
6. Submit the task. OpenADE creates the worktree and task branch before launching the agent.

While an agent is working, follow-up messages can be queued, steered to the front, edited, or removed. The right sidebar opens Changes, Terminal, Pull Request, and Ticket without reducing the main conversation to a narrow column.

## Architecture

```text
┌──────────────────────────────────────────────────────────┐
│ Wails 2 desktop                                          │
│ React 19 + TypeScript + xterm.js                         │
│ Native chat, Direct TUI, projects, review, PRs, settings │
└────────────────────────────┬─────────────────────────────┘
                             │ authenticated loopback HTTP + SSE + WebSocket
┌────────────────────────────▼─────────────────────────────┐
│ One Go daemon                                            │
│ SQLite WAL index · message queues · transcripts          │
│ PTY/process-group ownership · terminal/session streaming │
│ Git worktrees · GitHub CLI · Jira CLI                    │
└───────────────┬──────────────────────────┬───────────────┘
                │                          │
       ┌────────▼────────┐        ┌────────▼────────┐
       │ Agent CLIs      │        │ Git repositories│
       │ Claude / Codex  │        │ + worktrees     │
       │ Copilot/OpenCode│        └─────────────────┘
       └─────────────────┘
```

The daemon is deliberately independent from the window lifecycle:

- Wails reconnects only to the matching profile. An occupied address or profile lock prevents a second owner before any migration.
- Closing the window leaves it and its managed PTYs running.
- Reopening the app reattaches to live sessions and terminal scrollback.
- Daemon shutdown closes PTYs, subscribers, transcript writers, process groups, and SQLite in a deterministic order.

## Local data

By default, state is stored in the operating system's user configuration directory. On macOS this is:

```text
~/Library/Application Support/OpenADE/
```

The directory contains:

```text
openade.sqlite3       session, queue, and terminal index
openade.sqlite3-wal   SQLite write-ahead log while active
worktrees/            isolated task checkouts
transcripts/          structured chat or raw PTY transcripts
terminal-transcripts/ independent shell transcripts
daemon.log            detached daemon output
```

Configuration knobs:

| Variable | Purpose | Default |
|---|---|---|
| `OPENADE_DATA_DIR` | Override daemon state and worktree storage | OS user config directory |
| `OPENADE_PROFILE` | Named profile under the existing data directory | `default` (preserves existing data) |
| `OPENADE_DAEMON_ADDR` | Override daemon listen address | `127.0.0.1:7433` |
| `VITE_OPENADE_DAEMON_URL` / `VITE_OPENADE_AUTH_TOKEN` | Explicit browser development connection | Native Wails bridge otherwise |

## Testing

Current desktop verification uses end-to-end tests only. The former Vitest/component and in-process Go test suites are retired. `npm test` and `npm run e2e` both run Playwright against the production UI, a real Go engine, real Git repositories/worktrees and PTYs, and deterministic synthetic provider CLIs. No external accounts or user data are involved.

```sh
cd apps/desktop
npm ci
npx playwright install chromium
npm run build
go vet ./...
npm run e2e
# Rebuild without test URL/token before packaging.
npm run build
wails build -m -skipbindings -s
```

The flows cover settings and shortcuts, native chat and model arguments, queue edit/order/turn ownership, files and write conflicts, diffs/commit/history, draft PR delivery through a synthetic gh CLI, archived sessions, conversation adoption, repository isolation, raw PTY input/resize, authenticated control, cancellation/crash recovery, daemon restart, replay and inactive-view cleanup. Production-client performance is measured with 24 sessions, two repositories and a 260-turn transcript. See [verification and limits](docs/zeron-rebuild.md).

CI checks the Go/Wails desktop on macOS. The earlier Rust release workflow is manual only; it does not publish the current desktop app.

## Repository layout

```text
apps/desktop/
  main.go                 Wails application and standalone daemon entrypoint
  app.go                  desktop-to-daemon lifecycle bridge
  internal/daemon/        sessions, terminals, SQLite, Git, GitHub, and Jira
  src/ade/                current React desktop experience
  e2e/                    Playwright fixture world and lifecycle coverage
  build/bin/OpenADE.app   local production output

crates/                   earlier Rust daemon/server prototype
docs/                     product and historical design documentation
```

## Current limitations

- Local UI follows Zeron while retaining the header/rail. Remote devices, Appshots, provider account switching/sync, imported themes and hunk staging are not implemented. Local-server discovery, native macOS browser previews and latest-turn diffs are available.
- Native chat uses a structured pipe per turn and durable provider resume. Persistent upstream sessions, mid-turn steering and interactive permission bridging are not claimed. “Send next” reorders the queue.

- Direct TUI and durable provider resume are implemented only for Claude Code and Codex CLI.
- Sites is a UI integration surface only.
- Jira support expects a locally installed and authenticated `jira` executable.
- GitHub operations expect a locally installed and authenticated `gh` executable and an `origin` repository you can push to.
- Terminal code loads only when used. Markdown rendering still emits a non-blocking large-chunk warning.
- Several documents and screenshots under `docs/` describe the earlier Rust/Tauri prototype and may not match this branch's current UI.

## Principles

- **Local first.** Agent processes, transcripts, state, and worktrees stay on the machine.
- **Bring your own agent.** Authentication remains with each provider's CLI.
- **Isolation by default.** Parallel tasks do not share a mutable checkout.
- **The daemon owns execution.** UI navigation and window lifecycle never define process lifetime.
- **Review before delivery.** Diffs, linked tickets, branches, and draft pull requests remain connected to the session that produced them.

## License

[Apache-2.0](LICENSE)
