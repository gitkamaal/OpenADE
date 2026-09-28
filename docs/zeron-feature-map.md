# Zeron → OpenADE feature and interaction map

Pinned Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`. Based on the source feature inventory (§0–8), current `crates/ui/src/lib.rs` modules, Shell actions, UiSettings fields, and the supplied native dropdown screenshots. Historical docs are cross-checked against current modules; their old “always dark” claim is not used. **Implemented means a working counterpart, not pixel-identical parity. Partial names an actual difference. Gap means no equivalent.** No feature is counted as supported because a button looks similar.

| Feature | Capability status | OpenADE/source location | Behavior, visual alignment or gap |
|---|---|---|---|
| Window shell | Partial | AppShell/native_material | Regular AppKit window, header and five-icon OpenADE rail retained intentionally; Zeron tabs/chrome differ. |
| Frosted/Liquid/Opaque | Implemented | AppShell/preferences/native_material | Adjustable background washes capped at 90%; legacy Transparent migrates to Frosted per user preference; public NSGlassEffectView on macOS 26; public NSVisualEffectView fallback; no whole-interface opacity. |
| Accessibility material fallback | Implemented | AppShell/native_material | Reduce Transparency and Increase Contrast resolve solid surfaces. Browser test simulates bridge events; host OS setting unchanged. |
| Built-in theme library | Implemented | themes/SettingsPage | All 19 source families and 30 resolved variants; independent light/dark selection and System following. |
| Theme import/remove/reload | Partial | themes/CustomThemeManager/daemon theme_library | Browser snapshots and native linked VS Code JSON/JSON5/extension families; apply, replace, remove, reload, reveal, editable/snapshot duplication, recovery and unique variant identities. Source native-format preview/variant-selection workflow and automatic source watching remain gaps. |
| Accent presets | Implemented | themes/SettingsPage | Seven source presets with separate light/dark colors plus theme default. |
| Interface/code/terminal typography | Partial | SettingsPage/native_preferences/CodeEditor/Terminal | Native installed-font enumeration, measured monospace terminal qualification, searchable choices and source defaults/sizes. Source Nerd Font glyph qualification is not reproduced. |
| Blank composer artwork/effects | Partial | NewThreadArtwork/SettingsPage/daemon new_thread_artwork | Local managed image chooser, durable replace/remove, five source-labeled effect choices, authenticated media and Home rendering. None preserves the image; Scanlines is CSS texture; Dither/ASCII/Halftone are explicitly labeled CSS approximations, not the source native image reconstruction. Source crop/placement and exact processing remain gaps. |
| Left/right pane sizing | Implemented | ResizeBoundary | Transparent seams, pointer capture, RAF coalescing, keyboard values, reset, persisted width; limits differ from source. |
| Sidebar collapse | Implemented | AppShell/Sidebar | Persisted collapse and keyboard toggle; animated width. |
| Project filter dropdown | Implemented | Sidebar/Select | Custom searchable popup under trigger; All projects, local rows, selection check and New project footer open the local folder palette. |
| Project create/rename/remove | Partial | ProjectPalette/Sidebar/daemon project_registration | Add Git or plain folders with canonical roots, bookmark-backed native selection, a row-anchored Rename/Remove menu and persistent display aliases. Removal freezes the current visible and archived chat IDs, refuses stale confirmation, stops their resources, tombstones scanned results and retains repository files; explicit re-add works. Source New project has a device/location/folder picker; its complete location hierarchy still differs. No clone action was found in the inspected current UI. |
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
| Draft attachment persistence | Partial | Attachments/daemon attachments | PNG/JPEG/GIF picker/drop/paste upload, durable staged strip, navigation/restart persistence, synchronous submit guards, lazy authenticated thumbnails and keyboard-focused lightbox. Codex app-server receives typed localImage payloads; source WebP/SVG/BMP/TIFF formats and other structured provider image payloads remain gaps. |
| Model/provider dropdown | Partial | ModelPicker | Custom searchable menu, provider rail, favorites, keyboard selection, focus return. Source complete provider catalogs/traits/hover behavior differs. |
| Reasoning and service tier | Implemented | ModelPicker/SessionWorkspace | Advertised Codex model options persist and affect real fixture CLI arguments. |
| Composer auto-grow/compact flip | Partial | AppShell/SessionWorkspace | Established chat now uses a 49px compact pill, 76–260px expanded text box, 42px action row, 200px compact capacity, 32px collapse hysteresis and 150ms resize settle. Drafts, image attachments, keyboard send/Stop and custom model menu survive the morph. Source compositor motion and unavailable harness controls still differ. |
| Send/new turn/Stop | Implemented | SessionWorkspace/api | Real daemon turn lifecycle; startup failure shown, retry starts fresh identity. |
| Steering active provider run | Partial | MessageQueue/daemon | Real persistent Codex app-server turn/steer with expected-turn ownership, atomic queue claims and uncertain-delivery quarantine. Older CLI Send next remains a queued turn; ACP/other providers remain gaps. |
| Queued messages | Implemented | MessageQueue | Queue session/turn association, edit/remove/send-next and restart persistence. |
| Question/approval wizard | Partial | ProviderInteraction/daemon codex_server | Supported Codex uses paged custom questions, number-key choices, private answers and explicit command approvals with full command/cwd. Stale/duplicate replies fail; unknown scopes, network/extra permissions/stdin and file approvals without complete patch presentation are rejected. Historical question chips and other-provider wizards remain gaps. |
| Skills and slash completion | Partial | AgentCommandMenu | Owning-worktree discovery and insertion; no all-harness completion preferences or full source advertised command control. |
| Engine-injected MCP and linked tool activities | Partial | harness/engine MCP injection/daemon chat events | Existing provider CLI configuration can supply MCP tools and activity renders locally. Source engine injection, advertised tools and linked-child execution are not bridged. No active source application MCP registry/settings UI was found. |
| Thread naming/custom naming models | Partial | settings/thread_naming.rs / daemon title_generator/title_settings / SettingsPage | New Home chats receive a generated title after their first completed turn. A custom settings card selects Codex or Claude and its model, or follows the session with an automatic small model. The title-only run strips appended attachment paths, bounds the request, uses an isolated temporary directory, restricted provider flags, a 30-second timeout, bounded retries and a local fallback; manual rename wins, pending jobs recover after restart, and an untouched generated worktree branch is renamed. Source uses its internal harness adapters rather than these CLI invocations; exact title wording and model catalogs can differ. |
| Markdown chat/syntax fences | Implemented | MarkdownMessage/ChatTimeline | Native chat client renders markdown, fenced code, activity groups and copy actions. |
| Transcript stick-to-bottom | Implemented | SessionWorkspace | Release on upward scroll and Jump to latest; own-send following. |
| Transcript virtualization | Partial | ChatTimeline | Bounded 80 article window; not source variable-height doc projection/minimap algorithm. |
| Message rail/minimap | Implemented | MessageRail/ChatTimeline | Source prompt ticks, active reading marker, hover/focus previews, older-turn navigation and responsive hiding. Full variable-height transcript virtualization remains a separate partial area. |
| Activity folding | Partial | ChatTimeline | Compact/expanded thinking/tool summaries; source per-tool guides and nested subagent detail differ. |
| Context usage display | Partial | ProviderInteraction/daemon codex_server | Actual Codex last usage/context-window telemetry, 16px ring, anchored custom popup and restart persistence. Unknown capacity stays unknown; context compaction and other-provider telemetry remain gaps. |
| Generated images and attachment lightbox | Partial | Attachments/daemon file_media | Local authenticated image lightbox with owner-scoped retry/blob cache, bounded zoom/pan, fit/actual size, arrows/0/Escape and focus return. Structured generated-image ingestion and the full source format set remain absent. |
| Chat links to embedded browser | Implemented | MarkdownMessage/WebLinkContext/WorkspacePanels | Plain HTTP(S) chat/Markdown links route to the embedded browser; modifiers open externally. Preference persists and relative Markdown images stay scoped to the owning worktree. |
| Transcript timestamp/selection/copy | Partial | ChatTimeline/chat-model/daemon transcript markers | Source-shaped reserved 32px hover lane, absolute local date and copy affordance for new user/assistant entries, including steered partial replies, without shifting rows. Historical transcripts lack timestamp markers; ordinary text selection remains. The inspected active source row exposes timestamp and Copy, not a wider per-message context menu. |
| Side chats/linked child transcripts | Gap | shell/side_chats.rs | No source nested side-chat view. |
| Inline comments/review annotations | Gap | comments/comment_ui | No source line/comment composer or annotation menu. |
| File tree/search/folders | Implemented | WorkspacePanels | Hierarchical tree, folder expansion, query, hidden/ignored flags. |
| File editor/tabs/syntax/save | Implemented | WorkspacePanels/CodeEditor | CodeMirror syntax roles, tabs, save/reload, conflict detection, dirty guards, font/wrap. |
| Settings editor continuity | Implemented | AppShell/SessionWorkspace | Retains dirty document, cursor focus, undo history, draft and panels while Settings is open. |
| File actions/context menu | Implemented | CodeEditor/clipboard/app.go | Inspected source editor context menu is Cut/Copy/Paste/Select All. Matching custom 170px pointer menu, disabled states, native clipboard, selection, undo and stale-edit guard. Earlier create/rename/delete/reveal claim was not supported by the inspected source UI. |
| Markdown/image file previews | Partial | WorkspacePanels/Attachments | Toggle rich Markdown using the current unsaved buffer without losing editor state; authenticated raster preview/lightbox and scoped relative images. Source default Markdown preview, SVG/TIFF and exact renderer behavior remain gaps. No active source Copy image action was found. |
| Diff scopes/staging | Implemented | ReviewWorkspace/daemon | Working/branch/latest turn/staged scopes, stage/unstage and commit. |
| Diff folding/split/navigation | Implemented | ReviewWorkspace | File fold/expand, split/unified, filter, previous/next changed file. |
| Diff syntax/wrap/partial snapshots | Partial | ReviewWorkspace/SyntaxText/preferences | Persisted split/wrap choices and themed lexical syntax in diffs; Line-based CodeMirror/legacy-mode tokens approximate source Tree-sitter, with plain fallback above 2,000 file lines. Full partial snapshot selection and identical token boundaries remain gaps. |
| Git history | Partial | WorkspacePanels | Commit search/detail/list; no source optional/resizable/reordered columns, author display or full commit actions. |
| Browser panel | Implemented | WorkspacePanels/native_browser | Native WKWebView, URL navigation/back/forward/reload, local server discovery; hidden through Settings and restored. |
| Browser devtools/tabs/downloads | Partial | browser | Simple session preview; source browser controls and multi-tab/tooling not fully mirrored. |
| Workspace panel tabs | Implemented | SessionWorkspace | Add/select/close browser, terminal, diffs, history, PR and editor; shortcuts and focus restoration. |
| Independent project terminals | Implemented | Terminal/daemon | Real PTYs, session tabs, input/resize/output, hide/detach and stop escalation. |
| Terminal replay/reconnect/exit | Implemented | Terminal/daemon | Byte-cursor replay, bounded stale replay, reconnect, process exit and released sockets. |
| Terminal reorder/middle-click | Implemented | Terminal | Drag reorder, Alt+Left/Right accessible reorder, persistent local order and middle-click closes/releases the terminal. Explicitly closed tabs remain closed after relaunch; stop failure remains visible. |
| Terminal/theme/ANSI | Implemented | Terminal/themes | 16 source ANSI entries, selection/background/foreground; palette changes avoid unrelated redraw. |
| Direct TUI | Implemented | SessionWorkspace/Terminal | Exclusive native chat/TUI transports and resume provider identity; switch interrupts old turn. |
| Provider install/sign-in/enable | Partial | SettingsPage | Installed CLI detection, links, enable/default choice and interactive setup; source all provider-specific preferences differ. |
| Provider account switch/forget/quotas | Gap | settings/accounts/account_usage | Existing CLI identity only; no account vault/switch/forget or quota meters. |
| Claude/Codex adapters | Partial | daemon | Codex 0.156+ persistent app-server initialize/thread/turn/start/steer/interrupt, typed inputs and ordered completion/ACK recovery verified with synthetic stdio adapter. Older Codex and Claude retain legacy CLI; complete Claude SDK/all-source protocol capabilities remain gaps. |
| Grok/Copilot/OpenCode/Shell | Partial | daemon/ModelPicker | CLI/TUI surfaces; no complete source per-harness advertised model/option capabilities. |
| Cursor/Devin/Hermes/Pi/Antigravity ACP | Gap | harness | No source ACP adapters or complete native catalogs. |
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
| `git_history_columns` | No counterpart; gap |
| `git_history_column_widths` | No counterpart; gap |
| `git_history_column_order` | No counterpart; gap |
| `git_history_author_display` | No counterpart; gap |
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
| Settings choices | Custom choice popup aligned to trailing preference row; flips upward when needed | Automatic inventory tests popup/expanded/bounds/Escape/focus; themes searchable |
| Sessions status / Review repo | Same custom Select surface | Filters sessions / loads real PR list; source has different search layout |
| File folders/activity groups/provider preferences | Disclosure/tree rows, not dropdowns | Expansion changes visible content; not incorrectly counted as popup controls |

## Verification boundaries

The browser inventory discovers each enabled visible `button[role=combobox]` across Home and Settings; separate E2Es cover model menus, sidebar actions, commands, scope choices and workspace panel menus. The source-wide map includes unsupported menus instead of hiding them from a denominator. No automated test establishes pixel-perfect fidelity for every source feature. Native captures/inspection and the audit report provide separate visual evidence. Source cloud/remote/mobile/account features are mapped and explicitly outside the user's local-only scope.
