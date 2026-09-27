# Zeron → OpenADE feature and interaction map

Pinned Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`. Based on the source feature inventory (§0–8), current `crates/ui/src/lib.rs` modules, Shell actions, UiSettings fields, and the supplied native dropdown screenshots. Historical docs are cross-checked against current modules; their old “always dark” claim is not used. **Implemented means a working counterpart, not pixel-identical parity. Partial names an actual difference. Gap means no equivalent.** No feature is counted as supported because a button looks similar.

| Feature | Capability status | OpenADE/source location | Behavior, visual alignment or gap |
|---|---|---|---|
| Window shell | Partial | AppShell/native_material | Regular AppKit window, header and five-icon OpenADE rail retained intentionally; Zeron tabs/chrome differ. |
| Frosted/Liquid/Opaque | Implemented | AppShell/preferences/native_material | Adjustable background washes capped at 90%; legacy Transparent migrates to Frosted per user preference; public NSGlassEffectView on macOS 26; public NSVisualEffectView fallback; no whole-interface opacity. |
| Accessibility material fallback | Implemented | AppShell/native_material | Reduce Transparency and Increase Contrast resolve solid surfaces. Browser test simulates bridge events; host OS setting unchanged. |
| Built-in theme library | Implemented | themes/SettingsPage | All 19 source families and 30 resolved variants; independent light/dark selection and System following. |
| Theme import/remove/reload | Gap | theme_library.rs | Built-in catalog only; no custom theme import UI or watcher. |
| Accent presets | Implemented | themes/SettingsPage | Seven source presets with separate light/dark colors plus theme default. |
| Interface/code/terminal typography | Partial | SettingsPage/CodeEditor/Terminal | Source defaults and sizes; limited font families instead of installed-font enumeration/Nerd Font qualification. |
| Blank composer artwork/effects | Gap | new_thread_background_* | No background image chooser, crop/fade/effects. |
| Left/right pane sizing | Implemented | ResizeBoundary | Transparent seams, pointer capture, RAF coalescing, keyboard values, reset, persisted width; limits differ from source. |
| Sidebar collapse | Implemented | AppShell/Sidebar | Persisted collapse and keyboard toggle; animated width. |
| Project filter dropdown | Implemented | Sidebar/Select | Custom searchable popup under trigger; All projects, local rows, selection check and New project footer open the local folder palette. |
| Project clone/create/rename/remove | Partial | ProjectPalette/daemon project_registration | Current source New project is a local device/location/folder picker, not a clone wizard. Add/persist Git and plain folders, canonical Git roots, and real first/resumed non-Git Codex chats work. Native OS folder selection supplies bookmarks; directory access waits are bounded and failed navigation cannot add the previous folder. Source rename/remove menus remain absent; no clone action found in inspected current UI. |
| Projectless chats | Gap | shell/spaces.rs | Plain-folder workspaces now work; a chat without any folder remains absent. |
| Sidebar Organize/Sort/Show | Partial | Sidebar/Select | Source 300ms diagonal pointer-intent corridor and 44.8px pill switch geometry, By device/By project/None and Created/Last updated; correct side anchoring and persistent choices. Priority/Manual are OpenADE additions; complete source section/context hierarchy still differs. |
| Sidebar Compact | Implemented | Sidebar/styles | 29px single-line compact rows hide metadata; expanded rows reveal project and branch lines, 45/61px. |
| Sidebar provider/project/branch/PR details | Partial | Sidebar | Provider, labels, branch and PR display preferences; source project avatar/glyph/status placement differs. |
| Sidebar sections | Partial | Sidebar | Create/remove/move; no source full rename/reorder/synced profile section editing. |
| Pinned sessions | Partial | Sidebar/preferences | Local pin/unpin persists; no cross-device pins or repair pipeline. |
| Manual session order | Partial | Sidebar | Local drag reorder; full source section/space drag-drop and animation geometry differ. |
| Sidebar Show more | Implemented | Sidebar | Expand/reduce project and session lists. |
| Sidebar session search | Implemented | Sidebar/CommandPalette | Global custom action/history palette searches all local chats independently of sidebar/project filters; keyboard selection, focus return and theme action. |
| Chat context menu | Partial | Sidebar/SessionWorkspace | Pin/section/archive at pointer; rename/instructions in session header. Source rename/delete/source details hierarchy differs. |
| Session tabs | Gap | shell/tabs.rs | Workspace panel tabs exist; no source top-level session tabs, middle-click or reorder. |
| New chat and drafts | Implemented | AppShell/SessionWorkspace | New-chat choices persist through Settings; bounded session text draft memory through navigation. |
| Draft attachment persistence | Gap | attachments.rs | No image/file attachment draft strip, picker/drop/paste upload or lightbox. |
| Model/provider dropdown | Partial | ModelPicker | Custom searchable menu, provider rail, favorites, keyboard selection, focus return. Source complete provider catalogs/traits/hover behavior differs. |
| Reasoning and service tier | Implemented | ModelPicker/SessionWorkspace | Advertised Codex model options persist and affect real fixture CLI arguments. |
| Composer auto-grow/compact flip | Partial | AppShell/SessionWorkspace | Source 49px pill, 200px text capacity, 32px hysteresis, 150ms resize settle, 60–260px thread textarea and 76px new-chat minimum; controls move right/left and metadata sits below. Rich attachments and exact animated morph remain different. |
| Send/new turn/Stop | Implemented | SessionWorkspace/api | Real daemon turn lifecycle; startup failure shown, retry starts fresh identity. |
| Steering active provider run | Partial | MessageQueue/daemon | Explicit queued next turns; not source persistent app-server/ACP mid-run steering. |
| Queued messages | Implemented | MessageQueue | Queue session/turn association, edit/remove/send-next and restart persistence. |
| Question/approval wizard | Gap | composer.rs/harness | No source paged question wizard, number-key responses or durable approval control. |
| Skills and slash completion | Partial | AgentCommandMenu | Owning-worktree discovery and insertion; no all-harness completion preferences or full source advertised command control. |
| MCP discovery/settings | Gap | docs/mcp.md | CLI may use configured MCP; no equivalent application MCP registry/settings interface. |
| Thread naming/custom naming models | Gap | settings/thread_naming.rs | Explicit titles and rename; no source automatic naming configuration. |
| Markdown chat/syntax fences | Implemented | MarkdownMessage/ChatTimeline | Native chat client renders markdown, fenced code, activity groups and copy actions. |
| Transcript stick-to-bottom | Implemented | SessionWorkspace | Release on upward scroll and Jump to latest; own-send following. |
| Transcript virtualization | Partial | ChatTimeline | Bounded 80 article window; not source variable-height doc projection/minimap algorithm. |
| Message rail/minimap | Gap | rail.rs | No source prompt minimap/hover preview. |
| Activity folding | Partial | ChatTimeline | Compact/expanded thinking/tool summaries; source per-tool guides and nested subagent detail differ. |
| Context usage display | Gap | context_usage | No source context capacity/compaction telemetry. |
| Generated images and attachment lightbox | Gap | image_media/attachments | No structured generated-image ingestion or owner-targeted retry/cache/lightbox. |
| Chat links to embedded browser | Partial | MarkdownMessage/WorkspacePanels | Browser panel supports URLs; normal markdown links use external browser rather than configurable source routing. |
| Transcript timestamp/selection/context menus | Partial | MarkdownMessage | Basic copy/text selection; source timestamp transitions and full per-message menus differ. |
| Side chats/linked child transcripts | Gap | shell/side_chats.rs | No source nested side-chat view. |
| Inline comments/review annotations | Gap | comments/comment_ui | No source line/comment composer or annotation menu. |
| File tree/search/folders | Implemented | WorkspacePanels | Hierarchical tree, folder expansion, query, hidden/ignored flags. |
| File editor/tabs/syntax/save | Implemented | WorkspacePanels/CodeEditor | CodeMirror syntax roles, tabs, save/reload, conflict detection, dirty guards, font/wrap. |
| Settings editor continuity | Implemented | AppShell/SessionWorkspace | Retains dirty document, cursor focus, undo history, draft and panels while Settings is open. |
| File actions/context menu | Implemented | CodeEditor/clipboard/app.go | Inspected source editor context menu is Cut/Copy/Paste/Select All. Matching custom 170px pointer menu, disabled states, native clipboard, selection, undo and stale-edit guard. Earlier create/rename/delete/reveal claim was not supported by the inspected source UI. |
| Markdown/image file previews | Gap | files/image_viewer | Text editing available; no source rich markdown/image/zoom/copy image previews. |
| Diff scopes/staging | Implemented | ReviewWorkspace/daemon | Working/branch/latest turn/staged scopes, stage/unstage and commit. |
| Diff folding/split/navigation | Implemented | ReviewWorkspace | File fold/expand, split/unified, filter, previous/next changed file. |
| Diff syntax/wrap/partial snapshots | Partial | ReviewWorkspace | Theme colors/font and ±gutters; no full source syntax tokenization/wrap preference/partial snapshot UI. |
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
| Claude/Codex adapters | Partial | daemon | Existing chat CLI execution/resume verified with synthetic adapters; source durable app-server/stream protocol capabilities not fully replicated. |
| Grok/Copilot/OpenCode/Shell | Partial | daemon/ModelPicker | CLI/TUI surfaces; no complete source per-harness advertised model/option capabilities. |
| Cursor/Devin/Hermes/Pi/Antigravity ACP | Gap | harness | No source ACP adapters or complete native catalogs. |
| Local devices | Partial | SettingsPage | Local workspace status only; source device rename/presence/copy/targeting absent. |
| Remote devices/control/sync | Out of scope | README/state/engine | Local-only scope (Appshots separately excluded by prior user instruction). No account-linked remote workspace registry, relay, device control or transcript synchronization. |
| Account/org gate/switch/logout | Out of scope | shell/settings/accounts | Local-only scope (Appshots separately excluded by prior user instruction). Local app starts without account; no WorkOS membership/account phases. |
| Desktop notifications/sounds | Partial | AppShell/SettingsPage | Completion/input/error controls and foreground policy; browser permission dependent, no source custom sound library. |
| Appshots | Out of scope | appshots | Local-only scope (Appshots separately excluded by prior user instruction). No viewer-side screenshot capture shortcut/destination controls. |
| Keyboard recording/conflicts | Implemented | SettingsPage/preferences | Modifier capture, conflicts, Escape and restore defaults; source bindings not all identical. |
| Quick session jumps/global actions palette | Partial | AppShell/CommandPalette | Filtered Mod+1–9 and next/previous jumps; global command/history palette, Mod+K, New project Mod+Shift+N. Source held-modifier jump-hint rail remains absent. |
| Archive/restore | Implemented | Sidebar/SettingsPage | Archive hides without stopping agent/worktree; restore retained session. |
| Engine reconnect/recovery | Implemented | engine-store/daemon | Authenticated snapshot/sequenced SSE, daemon restart, queued turn/transcript persistence and competing owner rejection. |
| Engine watchdog/idle/presence | Partial | daemon | Local lifecycle checks; no full source host heartbeat/idle/stall/sync resource system. |
| Filesystem isolation/security | Implemented | daemon | Path escape/symlink/binary/large/conflicting write rejections, isolated identical-name repos. |
| Durable distributed commands/Loro docs | Intentional | daemon SQLite/activity | Authorized local Go/Wails architecture: SQLite state, sequenced activity and queued-turn recovery. Source Loro/distributed schema is not a required implementation choice; cloud commands remain outside local scope. |
| Control/Data/Auth RPC equivalents | Intentional | daemon HTTP/WebSocket API | Authenticated local sessions/files/diffs/terminals use the authorized Go engine API. Relay-forwardable source RPC schema is not a requirement for this local-only build. |
| Cloudflare edge/DOs/WorkOS | Out of scope | apps/edge | Local-only scope (Appshots separately excluded by prior user instruction). No source SessionRoom/DeviceRoom/auth/backup/organization edge backend. |
| Mobile/web synchronized viewport | Out of scope | apps/ios/landing | Local-only scope (Appshots separately excluded by prior user instruction). This deliverable is desktop macOS arm64; no source mobile remote-control client. |
| Updater/notarized distribution | Gap | dist/app_menus | Ad-hoc local build; no matching signed/notarized updater/release pipeline. |
| Reduced motion/focus | Implemented | styles/Select/menuKeys | CSS reduced-motion and visible keyboard focus; custom choices and action menu navigation. |
| Motion/hover-intent catalog | Partial | styles/Sidebar/Select | Source diagonal-hover intent ported; basic menu/width/fold transitions. Full source resort, minimap and compositor animation geometry differs. |
| Sites/Workflows/Review rail | Intentional | AppShell/SitesPage | OpenADE additions; Sites actions explicitly disabled when disconnected. Not counted as Zeron matches. |

The current target is **local desktop parity**. Remote/cloud/mobile/account relay and previously excluded Appshots remain mapped for completeness but are outside this target. Loro schema/RPC architecture is not a requirement to replace the authorized Go/Wails engine; local observable capability gaps remain explicit. Local-only does not imply that remaining local features are complete.

## Complete persisted-settings field index

All 66 public fields of current `UiSettings` are enumerated. “No counterpart” is an explicit mapping gap, including features covered above. Legacy fields do not imply an active Zeron feature.

| Zeron field | OpenADE counterpart/disposition |
|---|---|
| `window_geometry` | No counterpart; gap |
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
| `open_tabs` | No counterpart; gap |
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
| `settings_section` | settingsSection memory (not persisted) |
| `appearance` | color_scheme |
| `git_history_columns` | No counterpart; gap |
| `git_history_column_widths` | No counterpart; gap |
| `git_history_column_order` | No counterpart; gap |
| `git_history_author_display` | No counterpart; gap |
| `ui_font_family` | interface_font (restricted families) |
| `ui_font_size` | interface_size |
| `terminal_font_family` | terminal_font (restricted families) |
| `terminal_font_size` | terminal_size |
| `code_font_family` | code_font (restricted families) |
| `code_font_size` | code_size |
| `theme_selection` | light_theme/dark_theme |
| `diff_split` | ReviewWorkspace state (not persisted) |
| `diff_wrap` | No counterpart; gap |
| `code_fences_fit_content` | No counterpart; gap |
| `transcript_width` | conversation_width |
| `open_web_links_in_zeron` | No counterpart; gap |
| `transcript_compact_mode` | activity_detail |
| `files_autosave_enabled` | autosave |
| `files_autosave_delay_ms` | fixed 900ms (no control) |
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
| Home plus | Inline session-options disclosure | Intentional OpenADE layout difference from source attachments menu |
| Skills/commands | Custom completion menu above composer | Owning-worktree discovery and keyboard insertion |
| Session ellipsis | Custom action menu below titlebar trigger | Rename/instructions/copy/archive; arrow navigation/Escape |
| Add panel | Custom panel menu under panel plus | Opens corresponding panel and closes; arrow navigation/Escape |
| Diff scope | Custom popup beneath scope trigger | All four scopes change real diff content/staging behavior |
| Settings choices | Custom choice popup aligned to trailing preference row; flips upward when needed | Automatic inventory tests popup/expanded/bounds/Escape/focus; themes searchable |
| Sessions status / Review repo | Same custom Select surface | Filters sessions / loads real PR list; source has different search layout |
| File folders/activity groups/provider preferences | Disclosure/tree rows, not dropdowns | Expansion changes visible content; not incorrectly counted as popup controls |

## Verification boundaries

The browser inventory discovers each enabled visible `button[role=combobox]` across Home and Settings; separate E2Es cover model menus, sidebar actions, commands, scope choices and workspace panel menus. The source-wide map includes unsupported menus instead of hiding them from a denominator. No automated test establishes pixel-perfect fidelity for every source feature. Native captures/inspection and the audit report provide separate visual evidence. Source cloud/remote/mobile/account features are mapped and explicitly outside the user's local-only scope.
