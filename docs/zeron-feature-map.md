# Zeron → OpenADE feature and interaction map

Pinned Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`. Based on the source feature inventory (§0–8), current `crates/ui/src/lib.rs` modules, Shell actions, UiSettings fields, and the supplied native dropdown screenshots. Historical docs are cross-checked against current modules; their old “always dark” claim is not used. **Implemented means a working counterpart, not pixel-identical parity. Partial names an actual difference. Gap means no equivalent.** No feature is counted as supported because a button looks similar.

| Feature | Capability status | OpenADE/source location | Behavior, visual alignment or gap |
|---|---|---|---|
| Window shell | Partial | AppShell/native_material | Regular AppKit window, header and five-icon OpenADE rail retained intentionally; Zeron tabs/chrome differ. |
| Frosted/Liquid/Opaque | Implemented | AppShell/preferences/native_material | Adjustable background washes capped at 90%; legacy Transparent migrates to Frosted per user preference; public NSGlassEffectView on macOS 26; public NSVisualEffectView fallback; no whole-interface opacity. |
| Accessibility material fallback | Implemented | AppShell/native_material | Reduce Transparency and Increase Contrast resolve solid surfaces. Browser test simulates bridge events; host OS setting unchanged. |
| Built-in theme library | Implemented | themes/SettingsPage | All 19 source families and 30 resolved variants; independent light/dark selection and System following. |
| Theme import/remove/reload | Partial | themes/CustomThemeManager/ThemeImportDialog/daemon theme_library | Browser snapshots and native VS Code JSON/JSON5/extension families; the native two-step import analyzes real files, previews detected light/dark palettes, selects variants, and installs a copy or link. A digest rejects source changes between analysis and install. Apply, replace, remove, manual reload, reveal, editable/snapshot duplication, recovery and unique variant identities work. Source mapping/contrast diagnostic details and exact scene geometry remain differences. The pinned source exposes manual Reload; no automatic watcher was found, so watching is not a required counterpart. |
| Accent presets | Implemented | themes/SettingsPage | Seven source presets with separate light/dark colors plus theme default. |
| Interface/code/terminal typography | Partial | SettingsPage/native_preferences/CodeEditor/Terminal | Native installed-font enumeration, measured monospace terminal qualification, searchable choices and source defaults/sizes. Source Nerd Font glyph qualification is not reproduced. |
| Blank composer artwork/effects | Partial | NewThreadArtwork/SettingsPage/daemon new_thread_artwork | Local managed image chooser, durable replace/remove, five source-labeled effect choices, authenticated media and Home rendering. None preserves the image; Scanlines is CSS texture; Dither/ASCII/Halftone are explicitly labeled CSS approximations, not the source native image reconstruction. Source crop/placement and exact processing remain gaps. |
| Left/right pane sizing | Implemented | ResizeBoundary/SessionWorkspace | Transparent seams, pointer capture, frame-coalesced live resize with a bounded fallback when frames stall, keyboard values, reset, persisted width and native-safe focus return after workspace or tab close. With right workspace and Files open, the control now reports the drawn width across narrow windows and sidebar collapse; side-chat takeover keeps both right panels inside the minimum window. Manual limits still differ from source. |
| Sidebar collapse | Implemented | AppShell/Sidebar | Persisted collapse and keyboard toggle; animated width. Pointer activation hands focus to the replacement toggle in both directions; the shortcut preserves focus outside the sidebar. |
| Project filter dropdown | Implemented | Sidebar/Select | Custom searchable popup under trigger; All projects, local rows, selection check and New project footer open the local folder palette. |
| Project create/rename/remove | Partial | ProjectPalette/Sidebar/daemon project_registration | Add Git or plain folders with canonical roots, bookmark-backed native selection, a row-anchored Rename/Remove menu and persistent display aliases. New project now follows the source's local device → searchable Home/mounted locations → folders hierarchy, with back/arrow/Enter/⌘Enter navigation and an anchored `…` menu for deep breadcrumbs. Removal freezes the current visible and archived chat IDs, refuses stale confirmation, stops their resources, tombstones scanned results and retains repository files; explicit re-add works. Remote device picking is outside local scope; exact picker motion/geometry and some source context details still differ. No clone action was found in the inspected current UI. |
| Projectless chats | Implemented | Home/daemon sessions | Explicit No project creates a private local workspace, keeps an empty project/branch identity, excludes it from the project catalog, and disables Git-only choices without altering saved checkout preferences. |
| Sidebar Organize/Sort/Show | Partial | Sidebar/Select | Source 300ms diagonal pointer-intent corridor and 44.8px pill switch geometry, By device/By project/None and Created/Last updated; correct side anchoring and persistent choices. Priority/Manual are OpenADE additions; complete source section/context hierarchy still differs. |
| Sidebar Compact | Implemented | Sidebar/styles | 29px single-line compact rows hide metadata; expanded rows reveal project and branch lines, 45/61px. |
| Sidebar provider/project/branch/PR details | Partial | Sidebar | Provider, labels, branch and PR display preferences; source project avatar/glyph/status placement differs. |
| Sidebar sections | Implemented | Sidebar/preferences | Create, edit, archive all, delete, collapse, keyboard reorder and drag/drop across regular, pinned and project groups. Stable IDs preserve duplicate names and membership. Section state is local to this desktop profile; cross-device sync is outside the local target. |
| Pinned sessions | Partial | Sidebar/preferences | Local pin/unpin persists; no cross-device pins or repair pipeline. |
| Manual session order | Partial | Sidebar | Local drag reorder, project/section/pin drop targets and edge scrolling work; source sibling-slide/section animation geometry still differs. |
| Sidebar Show more | Implemented | Sidebar | Expand/reduce project and session lists. |
| Sidebar session search | Implemented | Sidebar/CommandPalette | Global custom action/history palette searches all local chats independently of sidebar/project filters; keyboard selection, focus return and theme action. |
| Chat context menu | Partial | Sidebar/SessionWorkspace | Pointer-anchored custom Rename, Pin/Unpin, Archive/Unarchive, same-card Copy submenu and Delete confirmation; actual ID/path copy, keyboard navigation, focus return and resource-safe deletion. Source side-chat variants and exact metadata hierarchy remain gaps. |

| New chat and drafts | Implemented | AppShell/SessionWorkspace | New-chat choices persist through Settings; bounded session text draft memory through navigation. |
| Draft attachment persistence | Partial | Attachments/daemon attachments/imageio_macos/svg_media | PNG/JPEG/GIF/WebP/BMP/TIFF/SVG/AVIF/HEIC picker/drop/paste upload, durable staged strip, navigation/restart persistence, synchronous submit guards, lazy authenticated thumbnails and keyboard-focused lightbox. BMP/TIFF and native AVIF/HEIC are boundedly converted to PNG; SVG is first reduced to a safe static subset, then AppKit rasterizes it to PNG before the typed Codex localImage payload. WebP retains its format. The system codecs may be unavailable on older macOS; source vector fidelity, provider-specific structured image payloads and exact processing remain gaps. |
| Model/provider dropdown | Partial | ModelPicker/daemon acp_models/cursor_catalog/claude_catalog | Custom searchable menu, provider rail, favorites, keyboard selection and focus return. The five source ACP providers show discovered model choices and available effort choices; Cursor reads model IDs from its SDK catalog. Claude now has the pinned seven named source fallback models and a bounded, cached initialize probe that overlays concrete models advertised by the local CLI; Refresh reprobes. Selected values are validated before a prompt. The generic Agent default is shown only before an explicit ACP choice because ACP has no generic reset RPC; an advertised default remains selectable. Claude account-specific availability could not be live-verified here, and its source model options (1M context, Fast Mode, thinking), Cursor catalog parameters/variants, source grouping, per-workspace catalogs and exact hover geometry remain gaps. |
| Reasoning and service tier | Implemented | ModelPicker/SessionWorkspace | Advertised Codex model options persist and affect real fixture CLI arguments. |
| Composer auto-grow/compact flip | Partial | AppShell/SessionWorkspace | Established chat now uses a 49px compact pill, 76–260px expanded text box, 42px action row, 200px compact capacity, 32px collapse hysteresis and 150ms resize settle. Drafts, image attachments, keyboard send/Stop and custom model menu survive the morph. Source compositor motion and unavailable harness controls still differ. |
| Send/new turn/Stop | Implemented | SessionWorkspace/api | Real daemon turn lifecycle; startup failure shown, retry starts fresh identity. |
| Steering active provider run | Partial | MessageQueue/daemon | Real persistent Codex app-server turn/steer with expected-turn ownership, atomic queue claims and uncertain-delivery quarantine. Claude now uses stream-json stdin for its initial prompt and control replies, but queued messages still use Send next rather than a replay-confirmed mid-run steer. ACP/other providers remain gaps. |
| Queued messages | Implemented | MessageQueue | Queue session/turn association, edit/remove/send-next and restart persistence. |
| Question/approval wizard | Partial | ProviderInteraction/ChatTimeline/daemon codex_server/claude_control | Supported Codex uses paged custom questions, number-key choices, private answers and explicit command approvals with full command/cwd. Claude `AskUserQuestion` now uses the same native custom wizard, including multi-select, and returns validated answers through its stdio control reply; source-shaped non-question `can_use_tool` controls receive an allow reply with unchanged input. Both keep neutral pending/answered/dismissed chips without saving the prompt or answers. Stale Claude replies fail; unknown/malformed Claude requests are denied. Codex unknown scopes, network/extra permissions/stdin and file approvals without complete patch presentation are rejected. Other-provider wizards and exact multi-question/source chip placement remain gaps. |
| Skills and slash completion | Partial | AgentCommandMenu | Owning-worktree discovery and insertion; no all-harness completion preferences or full source advertised command control. |
| Engine-injected MCP and linked tool activities | Partial | harness/engine MCP injection/daemon chat events | Existing provider CLI configuration can supply MCP tools and activity renders locally. Source engine injection, advertised tools and linked-child execution are not bridged. No active source application MCP registry/settings UI was found. |
| Thread naming/custom naming models | Partial | settings/thread_naming.rs / daemon title_generator/title_settings / SettingsPage | New Home chats receive a generated title after their first completed turn. A custom settings card selects Codex or Claude and its model, or follows the session with an automatic small model. The title-only run strips appended attachment paths, bounds the request, uses an isolated temporary directory, restricted provider flags, a 30-second timeout, bounded retries and a local fallback; manual rename wins, pending jobs recover after restart, and an untouched generated worktree branch is renamed. Source uses its internal harness adapters rather than these CLI invocations; exact title wording and model catalogs can differ. |
| Markdown chat/syntax fences | Implemented | MarkdownMessage/ChatTimeline | Native chat client renders markdown, fenced code, activity groups and copy actions. |
| Transcript stick-to-bottom | Implemented | SessionWorkspace | Release on upward scroll and Jump to latest; own-send following. |
| Transcript virtualization | Partial | ChatTimeline | Bounded 80 article window; not source variable-height doc projection/minimap algorithm. |
| Message rail/minimap | Implemented | MessageRail/ChatTimeline | Source prompt ticks, active reading marker, hover/focus previews, older-turn navigation and responsive hiding. Full variable-height transcript virtualization remains a separate partial area. |
| Activity folding | Partial | ChatTimeline/chat-model/codex_server/acp/cursor/codex_subagents/claude_subagents | Ordered thought/tool rows now share one work accordion with source-shaped summaries, a linked 32px activity rail, quiet collapsed state, and expandable reasoning text when the provider supplies it. Codex app-server, Claude, ACP and Cursor reasoning payloads reach the local transcript; empty turn-start events no longer invent a thought. Compact/expanded mode and reduced motion remain supported. Codex and Claude Agent/Task spawn chips stay outside the generic fold and link to owned child documents; Codex nested spawns remain visible non-link cards. Codex `fileChange` rows now keep provider IDs, typed operation and bounded paths across start/completion; their summary counts distinct files and failed items. Other adapters still use title-based tool summaries where typed call/path data is absent. Source's per-row compositor reveal, exact tween and complete note/tool/subagent normalization still differ. |
| Context usage display | Partial | ProviderInteraction/daemon codex_server/acp | Actual Codex and available ACP usage/context-window telemetry, 16px ring, anchored custom popup and restart persistence. Codex partial updates now preserve independently reported token/window fields across live turns and daemon reconnects. Unknown capacity stays unknown; context compaction, model-change semantics and the source's full provider coverage remain gaps. |
| Generated images and attachment lightbox | Partial | Attachments/ChatTimeline/daemon generated_images | Codex app-server `imageGeneration`/`image_generation` completion imports a bounded, source-root-confined PNG/JPEG/WebP/GIF into private per-session storage; duplicate item IDs reuse one image, and transcript events omit source paths and inline image data. A generated-image card opens the authenticated session-scoped lightbox with retry/blob cache, bounded zoom/pan, fit/actual size, arrows/0/Escape and focus return. The complete source image format set, non-Codex generated-image adapters and exact source geometry remain gaps. |
| Chat links to embedded browser | Implemented | MarkdownMessage/WebLinkContext/WorkspacePanels | Plain HTTP(S) chat/Markdown links route to the embedded browser; modifiers open externally. Preference persists and relative Markdown images stay scoped to the owning worktree. |
| Transcript timestamp/selection/copy | Partial | ChatTimeline/chat-model/daemon transcript markers | Source-shaped reserved 32px hover lane, absolute local date and copy affordance for new user/assistant entries, including steered partial replies, without shifting rows. Legacy transcripts with complete matching durable turn records recover exact stored send/finish times without rewriting the log; ambiguous histories and rows beyond the latest 200 records remain unlabeled. Ordinary text selection remains. The inspected active source row exposes timestamp and Copy, not a wider per-message context menu. |
| Side chats/linked child transcripts | Partial | shell/side_chats.rs / side_chats.go/SideChatPane/WorkspacePanels/codex_subagents/claude_subagents/SubagentPane | Header and Files → Chats controls create fresh or completed-history forks in the shared checkout; each child owns a provider session, transcript, model and draft. Multiple right-pane tabs, sibling forks, a source seam, independent send/Stop, and parent-delete reparenting work. The history fork uses a bounded normalized transcript and first-turn context bootstrap. Codex v1/v2 spawns and Claude Agent/Task stream-json spawns bind real read-only child documents; early/late tagged output stays outside the parent, SendMessage follow-ups reopen a Claude child, foreground tool results and background task notifications settle it, and Codex follow-ups form separate assistant turns. When the installed Claude CLI advertises `--forward-subagent-text`, OpenADE requests it so tagged child text reaches the panel; older CLIs keep their supported flags. Documents have a 2 MiB bound, remain session-owned, recover stale runs as interrupted after restart, and release with session deletion. The panel is live and resizable; Claude nested Agent/Task spawns open their own owned tabs, while unbound/failed Codex spawns do not claim a link. Claude coverage is synthetic because this host lacks a Claude subscription. Codex nested linked child documents, persistent Claude in-process steering, exact source card geometry, the full side-chat composer command set, linked child file-editor behavior, and forks over the current safe history limit remain gaps. |
| Inline comments/review annotations | Partial | comments/comment_ui / ReviewComments/ReviewWorkspace/CodeEditor/MarkdownMessage | Diff old/new gutters, code editor lines and Markdown preview blocks open inline comment drafts; staged cards can be edited/removed, travel with the owning chat draft, and become a cited text block plus transcript badge on send. Old-side renamed paths cite their original name; CodeMirror line anchors follow edits above them. Rejected sends restore staged comments, and image attachments retain both badges. Native diff/editor/Markdown cards were inspected. Zeron's complete Markdown block coverage, precise file-anchor detachment rules and exact card/motion geometry remain differences. |
| File tree/search/folders | Partial | WorkspacePanels | Hierarchical tree, folder expansion and file icons. The explorer eye toggles hidden and ignored files together; keyboard search supports fuzzy filename/path matching, active rows, Enter to reveal/open, native-safe Escape focus return and a 200-file result cap. The tree supports source-style arrow/Enter navigation. Large trees render a bounded visible row window with frame-coalesced scrolling and a bounded fallback when native frames stall. OpenADE rereads files on panel reopen or return from Settings and retains manual Refresh without an idle poll; Zeron searches through the workspace service and watches live changes. |
| File editor/tabs/syntax/save | Implemented | WorkspacePanels/CodeEditor | CodeMirror syntax roles, tabs, save/reload, conflict detection, dirty guards, font/wrap. |
| Settings editor continuity | Implemented | AppShell/SessionWorkspace | Retains dirty document, cursor focus, undo history, draft and panels while Settings is open. |
| File actions/context menu | Implemented | CodeEditor/clipboard/app.go | Inspected source editor context menu is Cut/Copy/Paste/Select All. Matching custom 170px pointer menu, disabled states, native clipboard, selection, undo and stale-edit guard. Earlier create/rename/delete/reveal claim was not supported by the inspected source UI. |
| Markdown/image file previews | Partial | WorkspacePanels/Attachments/daemon svg_media/imageio_macos | Toggle rich Markdown using the current unsaved buffer without losing editor state; authenticated PNG/JPEG/GIF/WebP/BMP/TIFF/AVIF/HEIC and static SVG preview/lightbox with scoped relative images. BMP/TIFF and native AVIF/HEIC decode are boundedly converted to PNG. SVG XML is parsed and re-serialized through a bounded static-element/attribute allowlist before reaching WebKit; scripts, foreign HTML, links, animation, external resources and DTDs are excluded. Selected file tabs, the Files pane and Markdown preview restore when returning to a chat; saved file content is reloaded, while unsaved edits still block chat switching. Source `usvg` supports more static SVG effects, text/font behavior and adaptive raster sizing; source default Markdown preview, older-codec runtime and exact renderer behavior remain gaps. No active source Copy image action was found. |
| Diff scopes/staging | Implemented | ReviewWorkspace/daemon | Working/branch/latest turn/staged scopes, stage/unstage and commit. |
| Diff folding/split/navigation | Implemented | ReviewWorkspace | File fold/expand, split/unified, filter, previous/next changed file. |
| Diff syntax/wrap/partial snapshots | Partial | ReviewWorkspace/SyntaxText/preferences | Persisted split/wrap choices and themed lexical syntax in diffs; Line-based CodeMirror/legacy-mode tokens approximate source Tree-sitter, with plain fallback above 2,000 file lines. Full partial snapshot selection and identical token boundaries remain gaps. |
| Git history | Partial | HistoryPanel/HistoryGraph/ReviewWorkspace/daemon | All public local/remote/tag commits load in 100-row pages; server-side fuzzy search reaches unloaded history, branch-tip overview and explicit non-pruning Fetch all update refs, and ahead/behind counts use local integration refs. A topological lane graph, ref badges, branch-run fold/expand, bounded row window, keyboard navigation, SHA copy, configurable columns and read-only commit patch tabs work. Source avatar image resolution, sparse-search ancestor contraction, exact graph hover/motion/geometry and full ref/context treatment remain differences. |
| Browser panel | Implemented | WorkspacePanels/native_browser | Native WKWebView, URL navigation/back/forward/reload and local server discovery; the page hides through Settings or pane closure and reappears without losing its WebView. |
| Browser tabs/page lifecycle | Partial | browser / WorkspacePanels/native_browser/browser_favicon | Multiple panel tabs own independent native WKWebViews in one nonpersistent data store. A webpage's new-window request opens a new tab; page title, URL and back/forward state update the custom tab chrome. Native page-finish discovery fetches a bounded raster favicon (or `/favicon.ico` fallback), converts it through Image I/O to a 32px PNG, and shows it in the tab; navigation, close and stale fetches clear or cancel it. Switching tabs, resizing, pane close/reopen and leaving/returning to the owning chat preserve the native page and its in-page state; closing a tab or deleting its chat releases its view. Source-shaped 112×24px chips swap the leading icon for Close on hover or keyboard focus, support middle-click and restore selected-tab focus. Panel chips now drag-reorder with fixed-slot quantization, 150ms sibling-slide preview, edge scrolling and a pointer ghost; browser panels stay mounted in creation order so moving a chip does not reload its WKWebView. Alt+Left/Right reorders a focused chip. A native NSEvent monitor routes browser chords only when the visible WKWebView owns focus; configured OpenADE shortcuts take precedence, and ⌘L falls through to the address when a shell session has no visible composer. Regular webpage editing remains native. Exact source ghost/compositor motion and older-system codec support still differ. Pinned Zeron explicitly cancels downloads and exposes no browser devtools action, so those are not missing source features. |
| Workspace panel tabs | Implemented | SessionWorkspace | Add/select/close browser, terminal, diffs, history, PR and editor; fixed-width hover-close chips, drag/keyboard reorder, middle-click, shortcuts and focus restoration. Tab order, selection and pane visibility restore when returning to the owning chat; file tabs reopen their saved content. |
| Independent project terminals | Implemented | Terminal/daemon | Real PTYs, session tabs, input/resize/output, hide/detach and stop escalation. |
| Terminal replay/reconnect/exit | Implemented | Terminal/daemon | Byte-cursor replay, bounded stale replay, reconnect, process exit and released sockets. |
| Terminal reorder/middle-click | Implemented | Terminal | Drag reorder, Alt+Left/Right accessible reorder, persistent local order and middle-click closes/releases the terminal. Explicitly closed tabs remain closed after relaunch; stop failure remains visible. |
| Terminal/theme/ANSI | Implemented | Terminal/themes | 16 source ANSI entries, selection/background/foreground; palette changes avoid unrelated redraw. |
| Direct TUI | Implemented | SessionWorkspace/Terminal | Exclusive native chat/TUI transports and resume provider identity; switch interrupts old turn. |
| Provider install/sign-in/enable | Partial | SettingsPage | Installed CLI detection, links, enable/default choice and interactive setup; source all provider-specific preferences differ. |
| Provider account switch/forget/quotas | Partial | settings/accounts/account_usage / daemon/agent_accounts / ProviderAccounts | Local Codex login slots are saved privately from the live CLI auth file, switchable and forgettable in a custom Settings card; the active account's session/week quota comes from the installed Codex app-server `account/rateLimits/read` protocol. Unknown quota remains unknown. Synthetic daemon/browser tests and a regular native QA window exercised the card and confirmation. Zeron's add-account OAuth, Claude/Cursor/Grok/Devin/OpenCode/Pi/Antigravity slots and provider-specific quota probes are absent; no live account mutation was tested. |
| Claude/Codex adapters | Partial | daemon/codex_server/claude_subagents/claude_control/claude_catalog | Codex 0.156+ persistent app-server initialize/thread/turn/start/steer/interrupt, typed inputs and ordered completion/ACK recovery verified with synthetic stdio adapter. Claude chat now starts from a stream-json stdin user frame and keeps stdin open for `can_use_tool` control replies; `AskUserQuestion` becomes a validated, paged native question with multi-select and a source-shaped `updatedInput.answers` response. Its Agent/Task output still routes to separate bounded child documents, with a version-aware `--forward-subagent-text` flag. Parent context sums input and cached input tokens against the parent-model window and displays the existing ring without child usage. Synthetic tests cover question answer/stop, non-question controls, context, child streams, seven fallback and discovered concrete models, and model/effort delivery. Claude still lacks replay-confirmed mid-run steering and other source protocol/model options; no live Claude account turn was tested. |
| Grok/Copilot/OpenCode/Shell | Partial | daemon/ModelPicker | Grok uses persistent ACP native chat and discovered first-class model choices; Copilot CLI Direct TUI now starts with `--session-id` and `-i` for an initial prompt, and resumes the exact saved UUID. Synthetic CLI tests cover start and resume; the Copilot CLI is absent on this host, so live authentication and work-machine behavior remain unverified. Pinned Zeron uses Copilot through Pi/OpenCode account paths rather than a direct Copilot CLI harness, so these are distinct provider surfaces. OpenCode/Shell retain CLI/TUI surfaces. Complete source per-harness options and provider-specific behavior remain gaps. |
| Grok/Devin/Hermes/Pi/Antigravity ACP | Partial | daemon/acp/acp_models/ModelPicker | Source entry points, protocol-v1 initialize/new/load/prompt/update/cancel, persistent session ownership, streamed text/tools/usage, explicit custom permission questions, Grok prompt-complete extension and process cleanup passed synthetic end-to-end tests. ACP model and reasoning catalogs are discovered from first-class models or config options, checked before session creation/model changes and applied before turns; synthetic Grok and Devin model/effort changes passed end-to-end tests. A real native Devin fixture turn and permission dialog were inspected earlier. Live provider-specific auth, exact catalog grouping, full tool/subagent normalization, steering extensions and installed-provider runtime remain unverified/incomplete. |
| Cursor native adapter | Partial | harness/cursor / daemon cursor/cursor_adapter/ModelPicker | Separate JSONL driver around the pinned `@cursor/sdk@1.0.32`, installed from an integrity-locked npm manifest into local app data on first use. Native chat streams text/thought/tool/usage, persists a provider identity, keeps a process for later turns, resumes after process/daemon restart, restarts on model changes and cancels active work. The custom picker discovers SDK models. Synthetic driver E2E and installed SDK import were checked. Live Cursor-account turns, SDK browser login/account slots, parameterized variants, native steering, exact nested subagent transcript presentation and complete permission parity remain unverified/incomplete. The SDK login is separate from `cursor-agent login`; Cursor is not treated as ACP or CLI print output. |
| Local devices | Partial | SettingsPage | Local workspace status only; source device rename/presence/copy/targeting absent. |
| Remote devices/control/sync | Out of scope | README/state/engine | Local-only scope (Appshots separately excluded by prior user instruction). No account-linked remote workspace registry, relay, device control or transcript synchronization. |
| Account/org gate/switch/logout | Out of scope | shell/settings/accounts | Local-only scope (Appshots separately excluded by prior user instruction). Local app starts without account; no WorkOS membership/account phases. |
| Desktop notifications/sounds | Partial | AppShell/SettingsPage | Completion/input/error controls and foreground policy; browser permission dependent, no source custom sound library. |
| Appshots | Out of scope | appshots | Local-only scope (Appshots separately excluded by prior user instruction). No viewer-side screenshot capture shortcut/destination controls. |
| Keyboard recording/conflicts | Implemented | SettingsPage/preferences | Modifier capture, conflicts, Escape and restore defaults; source bindings not all identical. |
| Quick session jumps/global actions palette | Implemented | AppShell/CommandPalette/useSessionJumpHints | Visible-row Mod+1–9 and next/previous jumps, configurable bindings and exact-modifier hint chips suppressed under menus/dialogs; global command/history palette and new-project action. OpenADE shortcut defaults differ intentionally where existing commands require it. |
| Archive/restore | Implemented | Sidebar/SettingsPage/daemon | Durable daemon state and legacy-local migration; Source-like default-open Archived shelf filters by project, shares active sort, pages 10 then 25, shows a collapsed count, opens without restoring and offers hover Unarchive. Header, context menu and Settings use the same state. Archiving retains the agent/worktree. |
| Engine reconnect/recovery | Implemented | engine-store/daemon | Authenticated snapshot/sequenced SSE, daemon restart, queued turn/transcript persistence and competing owner rejection. |
| Engine watchdog/idle/presence | Partial | daemon | Local lifecycle checks; no full source host heartbeat/idle/stall/sync resource system. |
| Filesystem isolation/security | Implemented | daemon | Path escape/symlink/binary/large/conflicting write rejections, isolated identical-name repos. |
| Durable distributed commands/Loro docs | Intentional | daemon SQLite/activity | Authorized local Go/Wails architecture: SQLite state, sequenced activity and queued-turn recovery. Source Loro/distributed schema is not a required implementation choice; cloud commands remain outside local scope. |
| Control/Data/Auth RPC equivalents | Intentional | daemon HTTP/WebSocket API | Authenticated local sessions/files/diffs/terminals use the authorized Go engine API. Relay-forwardable source RPC schema is not a requirement for this local-only build. |
| Cloudflare edge/DOs/WorkOS | Out of scope | apps/edge | Local-only scope (Appshots separately excluded by prior user instruction). No source SessionRoom/DeviceRoom/auth/backup/organization edge backend. |
| Mobile/web synchronized viewport | Out of scope | apps/ios/landing | Local-only scope (Appshots separately excluded by prior user instruction). This deliverable builds for desktop macOS arm64 and x86_64; only arm64 runtime is verified; no source mobile remote-control client. |
| Updater/notarized distribution | Gap | dist/app_menus | Universal arm64/x86_64 build succeeds and local ad-hoc signatures verify. Intel/older-macOS runtime, Developer ID notarization and signed updater pipeline remain unverified/unimplemented. |
| Reduced motion/focus | Implemented | styles/Select/menuKeys | CSS reduced-motion and visible keyboard focus; custom choices and action menu navigation. |
| Motion/hover-intent catalog | Partial | styles/Sidebar/Select | Source diagonal-hover intent ported; basic menu/width/fold transitions. Full source resort, minimap and compositor animation geometry differs. |
| Sites/Workflows/Review rail | Intentional | AppShell/SitesPage | OpenADE additions; Sites actions explicitly disabled when disconnected. Not counted as Zeron matches. |

The current target is **local desktop parity**. Remote/cloud/mobile/account relay and previously excluded Appshots remain mapped for completeness but are outside this target. Loro schema/RPC architecture is not a requirement to replace the authorized Go/Wails engine; local observable capability gaps remain explicit. Local-only does not imply that remaining local features are complete.

The pinned active `shell/tabs.rs` states that the horizontal session strip was removed on 2026-08-10 and `open_tabs` is unread legacy data. It is not a missing active feature.

## Complete persisted-settings field index

All 66 public fields of current `UiSettings` are enumerated. “No counterpart” is an explicit mapping gap, including features covered above. Legacy fields do not imply an active Zeron feature.

| Zeron field | OpenADE counterpart/disposition |
|---|---|
| `window_geometry` | Native per-profile AppKit frame persistence and screen clamping |
| `composer_send_behavior` | send_behavior |
| `skills_in_slash_menu` | Legacy source compatibility field |
| `skill_completion_by_harness` | No counterpart; gap |
| `sidebar_width` | sidebar_width |
| `sidebar_collapsed` | sidebar_open (inverse) |
| `sidebar_grouped` | Legacy source compatibility field |
| `sidebar_organization` | project_organization |
| `sidebar_sort` | project_sort |
| `sidebar_show_project_label` | sidebar_show_project_label |
| `sidebar_compact` | sidebar_compact |
| `sidebar_show_project_icon` | sidebar_show_project_icon (partial visual mapping) |
| `sidebar_show_harness` | sidebar_show_provider |
| `sidebar_show_branch` | sidebar_show_branch |
| `sidebar_show_pull_request` | sidebar_show_pr |
| `last_space_id` | No counterpart; gap |
| `last_project_action_by_space_id` | No counterpart; gap |
| `open_tabs` | Legacy source compatibility field; active horizontal session tabs were removed upstream |
| `space_filter` | sidebar_project_filter (local repo path) |
| `sidebar_sections_by_profile` | sidebar_sections/session_sections (local only) |
| `sidebar_pinned_session_ids_by_profile` | pinned_sessions (local only) |
| `tab_order` | Legacy source compatibility field |
| `space_order` | Legacy source compatibility field |
| `sound_enabled` | sounds |
| `sound_completion_enabled` | sound_completed |
| `sound_input_enabled` | sound_input |
| `sound_attention_enabled` | sound_errors |
| `notifications_enabled` | notifications |
| `notifications_background_only` | background_only |
| `files_panel_width` | No counterpart; gap |
| `right_pane_width` | panel_width |
| `right_pane_open` | Legacy source compatibility field |
| `terminal_height` | No counterpart; gap |
| `terminal_open` | Legacy source compatibility field |
| `keymap` | shortcuts |
| `appshots_enabled` | No counterpart; gap |
| `appshot_sound_enabled` | No counterpart; gap |
| `appshot_destination` | No counterpart; gap |
| `escape_stops_active_agent` | stop_on_escape |
| `settings_section` | settings_section persisted; unknown values recover to General |
| `appearance` | color_scheme |
| `git_history_columns` | history_columns |
| `git_history_column_widths` | history_widths |
| `git_history_column_order` | history_order |
| `git_history_author_display` | history_author_display |
| `ui_font_family` | interface_font (native installed-font catalog; Nerd qualification differs) |
| `ui_font_size` | interface_size |
| `terminal_font_family` | terminal_font (native installed-font catalog; Nerd qualification differs) |
| `terminal_font_size` | terminal_size |
| `code_font_family` | code_font (native installed-font catalog; Nerd qualification differs) |
| `code_font_size` | code_size |
| `theme_selection` | light_theme/dark_theme |
| `diff_split` | diff_split persisted |
| `diff_wrap` | diff_wrap persisted |
| `code_fences_fit_content` | code_fences_fit_content |
| `transcript_width` | conversation_width |
| `open_web_links_in_zeron` | open_web_links_in_app |
| `transcript_compact_mode` | activity_detail |
| `files_autosave_enabled` | autosave |
| `files_autosave_delay_ms` | autosave_delay_ms with custom choice control |
| `files_word_wrap` | word_wrap |
| `files_show_all` | show_hidden/show_ignored |
| `accent` | accent + accentFor |
| `surface` | glass + transparency |
| `new_thread_composer_background` | No counterpart; gap |
| `new_thread_background_effect` | No counterpart; gap |

## Shell action registry

| Zeron action | OpenADE counterpart |
|---|---|
| SaveFile | File save / Mod+S |
| ToggleSidebar | Toggle sidebar / Mod+B |
| ToggleChanges | Toggle right sidebar / Mod+R |
| ToggleFiles | Toggle files / Mod+E |
| AddSpacePalette | Workspace settings; partial, no palette |
| ToggleCommandPalette | Global command/history palette; keyboard navigation, source action shortcuts and theme action |
| OpenModelPicker | Mod+/ + Choose model |
| NewSession | Mod+N + header plus |
| OpenSettings | Mod+, + footer gear |
| NextSession | Ctrl+Tab |
| PrevSession | Ctrl+Shift+Tab |
| ArchiveSession | Session/context menu; shortcut gap |

## Dropdown and disclosure placement contract

| Trigger | Required/current surface | Behavioral verification |
|---|---|---|
| All projects / Filter projects | Custom searchable popup under selector, left aligned, 6px gap; selected project @ Local; New project footer | Selection filters actual sidebar rows, keyboard/Escape/focus; duplicate names disambiguation by full path still a gap |
| Sidebar ellipsis | Custom menu beside ellipsis, level with trigger; flips left near viewport edge | Organize/Sort/Show/Compact/create section; Compact changes metadata and geometry |
| Organize/Sort | Custom nested choice to right of view menu, flip left when constrained | Whole row opens nested choices; checked radio selection persists and keeps parent open; None naming; source 300ms diagonal hover intent |
| Show | Custom nested checkbox list beside menu | Repeated toggles, Escape returns to Show; settings persisted |
| Chat context menu | Custom menu at pointer, clamped to viewport | Pin, section, archive; full source submenu gap listed above |
| Model/provider | Custom model menu below Home composer / above session composer, provider icons/search/favorites | Search, selection, effort/tier, arguments, focus; Home stacking keeps provider choices clickable |
| Reasoning/service tier | Custom popup near row, viewport clamped | Selection reaches next turn |
| Home device/project/branch/checkout | Custom choice popup at triggering pill; project path/folder footer | Actual checkout/provider isolation checks; local folder registration; source project rename/remove gaps |
| Global search / Mod+K | Centered 560px custom action/history palette | Independent of sidebar filters; archived history, arrows/Enter/Escape, theme switching and focus restore |
| New project | Custom local device/location/folder palette; native folder chooser fallback | Canonical root registration, non-Git sessions, invalid-path recovery and bounded directory waits |
| Editor context | Custom 170px pointer menu, clamped to viewport | Cut/Copy/Paste/Select All, native clipboard, selection/undo and stale-document guard |
| Terminal tabs | Tab actions and direct manipulation | Drag/Alt+arrow reorder, middle-click close, persistence across native relaunch and visible stop errors |
| Home plus | Skills/commands plus and adjacent attachment picker | OpenADE retained layout; source attachment menu hierarchy still differs |
| Skills/commands | Custom completion menu above composer | Owning-worktree discovery and keyboard insertion |
| Session ellipsis | Custom action menu below titlebar trigger | Rename/instructions/copy/archive; arrow navigation/Escape |
| Add panel | Custom panel menu under panel plus | Opens corresponding panel and closes; arrow navigation/Escape |
| Diff scope | Custom popup beneath scope trigger | All four scopes change real diff content/staging behavior |
| Git History columns/Author | Custom popup below the matching toolbar/header trigger | Visibility, order, widths and avatar/name persist; keyboard Escape/focus, branch fold/tips, paged search, ref fetch, SHA copy and commit-detail tab verified |
| Settings choices | Custom choice popup aligned to trailing preference row; flips upward when needed | Automatic inventory tests popup/expanded/bounds/Escape/focus; themes searchable |
| Sessions status / Review repo | Same custom Select surface | Filters sessions / loads real PR list; source has different search layout |
| File folders/activity groups/provider preferences | Disclosure/tree rows, not dropdowns | Expansion changes visible content; not incorrectly counted as popup controls |

## Verification boundaries

The browser inventory discovers each enabled visible `button[role=combobox]` across Home and Settings; separate E2Es cover model menus, sidebar actions, commands, scope choices and workspace panel menus. The source-wide map includes unsupported menus instead of hiding them from a denominator. No automated test establishes pixel-perfect fidelity for every source feature. Native captures/inspection and the audit report provide separate visual evidence. Source cloud/remote/mobile/account features are mapped and explicitly outside the user's local-only scope.
