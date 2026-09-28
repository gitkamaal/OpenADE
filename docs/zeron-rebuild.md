# OpenADE desktop rebuild — verification

The local Go/Wails/React client follows Zeron’s composer/chat/panel/settings layout while retaining OpenADE’s header and five-icon rail. Appshots is excluded.

## Implemented

- Bounded native startup/reconnect and profile/protocol ownership checks; selected-folder access survives restart, including linked worktree metadata.
- Custom searchable, keyboard-accessible choices throughout the active desktop UI; no native select/datalist controls.
- Whole-window Frosted/Opaque roles across canvas, sidebar, chat, settings, editor, terminal and menus. macOS now uses public AppKit material APIs; menus use a shared 16 px CSS blur. Apache/MIT/font notices are retained.
- Sidebar sections/pinning/detail controls/grouped drag order/archive; current/isolated checkout with real branches.
- Model favorites, reasoning and service tier; chat rename/instructions/context, durable queue, bounded streaming/replay and safe provider retry.
- Hierarchical files and a main-panel CodeMirror editor with tabs, syntax colors/fonts, autosave/conflict and filesystem guards.
- Working/branch/latest-turn/staged diffs, split/unified, folding/navigation and file staging; real Git history.
- Palette-aware independent terminals, configurable shortcuts, provider setup and isolated native WebKit previews with local-server discovery/navigation.

## Engine behavior

SQLite WAL stores sessions/turns/queue identities and committed activity. One engine owns each profile. Structured native chat uses pipes per turn; interactive providers/shells use PTYs. Snapshot plus sequenced SSE and bounded byte-cursor replay recover clients. Only mounted views subscribe. Rendering initially keeps 80 transcript articles; full transcripts remain on disk. Authentication is profile-scoped and loopback-only; file writes reject escapes, symlinks, binary/large content and conflicting edits. Turn diff snapshots use a separate Git index. Retry without a provider identity starts fresh rather than resuming an unrelated latest conversation.

## Verification

A full 35-flow production-client suite passed against the actual Go engine; the three affected model/material flows passed after the final menu-layer styling change. Coverage includes worktree-local skill discovery, terminal shutdown escalation, draft preservation and custom-selector keyboard editing. Frontend type/build checks, Go vet and a macOS arm64 Wails package build pass. Active unit/component/in-process suites were replaced with E2Es at the user’s request. CI retains build/static checks and rebuilds without fixture connection values before native packaging.

Native OpenADE connected and completed two real Codex code-inspection sessions. Actual native main-panel file editing, independent shell input/close, custom provider/model controls and Frosted/Opaque appearance were visually checked. A worktree-local $sidebar-review skill was selected through the real UI and completed a Codex turn. Native WebKit rendering, link/back navigation and settings visibility were exercised. Two real Codex sessions first/resumed turns and Grok PTY response/resize/stop passed separately. Claude’s OAuth is expired; its refresh domain was rejected by the browser tool. Deterministic tests use fixture providers and local bare Git remotes; they do not establish external account/GitHub delivery behavior.

## Browser performance

Same machine, production Chromium client/real Go engine, synthetic providers, 24 sessions/two projects and a 260-turn transcript. Baseline is `0e10ba6`. Five load samples, 12 switches and five streaming samples; input measures two animation frames. Reproduce with `OPENADE_PERF_OUTPUT=/absolute/report.json npm run e2e -- e2e/performance.spec.ts`.

| Measurement | Baseline | Rebuilt |
|---|---:|---:|
| Cold ready p95 | 90.3 ms | 104.5 ms |
| Warm ready p95 | 32.4 ms | 28.4 ms |
| Input to two frames p95 | 16.4 ms | 16.8 ms |
| Session switch p95 | 37.7 ms | 40.7 ms |
| First visible response p95 | 1873.7 ms | 478.8 ms |
| Renderer JS heap | 40.4 MiB | 8.7 MiB |
| Engine RSS | 25.1 MiB | 29.6 MiB |
| Transcript articles | 522 | 80 |

Heap/DOM are lower; engine RSS is higher. Timing results are mixed and small-sample; no whole-app/native performance claim is made. JS heap excludes browser/WebKit allocations and provider processes. CPU sampled after workload is not a controlled idle benchmark.

## Source Zeron comparison and limits

[Zeron v0.2.92 source](https://github.com/zeronsh/zeron/tree/68ef78bb1e6fa0b84feeb68c382230f8c560f96a) compiled locally. Matched sanitized engine replay used identical 51,769 assistant bytes/853 reasoning bytes/40 ms deltas. Zeron/OpenADE streaming CPU was 1.31%/0.62%, peak physical footprint 24.86/9.41 MiB. One run only, excluding providers/renderers; setup timings differ and are not comparable. Earlier Computer Use sessions rejected the separate source-build native app. This checkpoint accepted its launch, then a later capture timed out; a complete new source-GUI comparison remains unverified. Installed Zeron 0.2.90 supplies the previous native visual references.

Remaining: remote sync/device management, account switching/usage/provider settings sync, additional structured adapters (including Grok), persistent upstream execution and interactive permission bridging, theme imports/background images, full Git graph/ref details and hunk staging/syntax-aligned diffs. Exact pixel equivalence across operating systems/backdrops is not established. Browser builds use a sandboxed iframe; native macOS uses an isolated WebKit child. Complete native notification, every shortcut/account/browser state, Windows/Linux and whole-process-family performance remain unverified. Public PRs must not include private reference screenshots or transcripts.


## September 26 — thinner materials and native Liquid Glass

The native background now uses a supported behind-window `NSVisualEffectView`,
with 40% opacity applied only to that background view. Window/content opacity stays
at one. Removed the private layer/filter edits and reduced the native shell tint
from 80% to 55%, with 12% sidebar/panel washes. Files-panel clipping, diff layout
and user-message fills no longer cover the backdrop with solid colors.

Liquid Glass explicitly selects `NSGlassEffectView` Clear style on macOS 26+,
over a public behind-window material. WebKit remains in a stable foreground host
when changing treatment; reparenting it into/out of glass caused a native blank
view and was removed. Composer, dropdown and in-app card effects are CSS frost
approximations, rather than native Liquid Glass controls. Opaque is preserved.
Older systems/build SDKs fall back to Frosted; non-macOS native clients fall back
to solid. Reduce Transparency and Increase Contrast select solid materials and
notify the client immediately, including mounted xterm themes. Full-strength
foreground colors and visible focus outlines preserve label/editor clarity.

Validation at this checkpoint: all 35 existing production-client E2Es passed.
The new native-bridge accessibility flow passed after fixes, including persistent
Liquid Glass selection, theme-default translucency, focus retention and live
terminal background changes. The two affected material flows passed after the
last panel-wrapper change. The native bridge fixture controls status callbacks;
it does not emulate AppKit or change OS accessibility settings. Frontend
TypeScript/production build, Go vet, macOS arm64 packaging and signature checks
passed. Native app inspection exercised keyboard menus/focus return, file-editor
paging, fresh shell input/close, native window zoom/restore, settings and material
switching. Native diff inspection covered the empty working-tree surface; real
patch staging/split flows are covered by the engine E2Es.

Current capture limitation: Computer Use's window snapshots show a flat material
instead of the desktop behind the window. Full-display color transmission and a
continuous full-desktop recording are still unverified; an alternative macOS
`screencapture` request is pending. Existing saved captures verify native layout,
crisp foregrounds and treatment switching, rather than desktop-color fidelity.
An optional native contrasting-backdrop fixture is in `apps/desktop/e2e/native`;
it is excluded from the delivered app. CUA also returned ScreenCaptureKit error
-3812 (invalid parameter), transformed Stage Manager thumbnails, and
`windowNotFoundAtPosition` during background-window setup. No denial was bypassed
and no setting was assumed to be at fault. Wallpaper remained unchanged.

The separate source-built Zeron was accepted by Computer Use this time and
initially showed its setup screen; a later capture timed out (`timeoutReached`).
A new complete source-GUI comparison therefore remains unavailable.

Updated production Chromium measurements versus the last delivered rebuild:
input p95 16.8 → 16.4 ms, session switching 40.7 → 32.3 ms, warm ready 28.4 →
34.7 ms, first visible streaming response 478.8 → 485.2 ms. Renderer JS heap
8.7 → 7.7 MiB; engine RSS 29.6 → 41.9 MiB. Timings are mixed and engine memory
was higher; this does not establish regression-free whole-app performance.
Native app-only startup/idle samples were approximately 116 MiB before and 114 MiB
after. Following the native flows the app was 139.6 MiB with sampled CPU 0.0%;
no matched warm native baseline was captured. WebKit, WindowServer, GPU and
providers are excluded.

## September 26 — actual Transparent treatment

User inspection found the refined Frosted treatment still too opaque. A separate
Transparent choice now removes the entire native material/backdrop layer, leaves
the NSWindow clear and non-opaque, and reduces only the HTML background wash to
22%, with 6% sidebar/panel washes. It uses ordinary native window transparency,
not Liquid Glass. New profiles default to Transparent; existing material choices
are preserved. The native preview profile was explicitly switched to Transparent.
Text/icons retain full opacity; a one-pixel text-edge shadow improves readability
over bright backgrounds. Local dropdowns retain stronger fills and CSS frost.
Opaque and native accessibility fallbacks remain solid, including light-theme
shadow removal. macOS 10.13 uses Sidebar material for the optional Frosted fallback
instead of the macOS 10.14 UnderWindowBackground material.

The real native content-alpha fixture shows contrasting colors through the chat,
sidebar, editor and terminal. Its sampled dark-mode canvas pixels across four
columns were (189,50,9), (202,158,27), (0,138,165), (27,50,190); Opaque covered the
same colors with solid (6,6,6)/(13,13,13). This verifies actual native WebKit
compositing, not desktop capture. Foreground focus, editor paging, fresh fish shell
echo/close, custom menus, light/dark/system transitions and native zoom/restore
were exercised. Fourteen parity E2Es passed; affected material/accessibility checks
were repeated after the text-shadow adjustment. Full-desktop color transmission
and continuous recording remain unverified because the available Computer Use
window capture replaces the backdrop and sometimes captures Stage Manager
thumbnails. A native-snapshot walkthrough labels its content-alpha fixture.

The delivered Transparent app's post-settings sample was 114,128 KiB RSS (111.5
MiB) and 0.0% sampled CPU. This is app-only, excluding WebKit, WindowServer, GPU,
providers and the daemon; there is no matched warm workload baseline. No
whole-app performance or universal text-contrast claim is made.

## September 27 — local themes, media and workspace continuation

All 77 production-client E2Es passed, followed by 11 theme and 19 menu/workspace flows after the last corrections; TypeScript and Go static checks pass for this continuation. The current local continuation adds native linked/custom themes with collision-safe identities, projectless chats, persistent draft images and a keyboard-focused lightbox, rich file previews, lexical syntax roles, prompt minimap navigation, installed-font choices and native per-profile window geometry. Split/wrap/autosave/link-routing settings persist. Settings reopen at the last section; visiting Settings keeps project expansion and Show more state, and collapsing the final group no longer resets it. Configurable session jump hints use the same visible-row order as navigation and disappear while menus/dialogs own the keyboard.

The active source map is `docs/zeron-feature-map.md`: 38 implemented, 31 partial and nine missing local capability areas among 78. The 68.6/100 weighted index measures counterparts, not visual fidelity. Historical horizontal session tabs were removed in the pinned active source; source engine-injected MCP is distinct from an application MCP settings screen, which was not found. Full local parity remains unfinished.

Native verification uses the actual app and separate source build. The latest window restored 1301×920, retained its linked palette and image draft, and exercised actual-size/fit/0/Escape focus and narrow Markdown wrapping. A real terminal returned the pasted verification marker and released its PTY. The universal binary contains arm64 and x86_64 slices; only Apple Silicon runtime is exercised. New full-desktop captures show Frosted transmission but are obstructed by Screenshot launch-error alerts; the existing unobstructed continuous video belongs to the preceding checkpoint. Do not claim that an app-window capture establishes desktop transmission or that this continuation has a clean new walkthrough.

A latest predominantly idle 15-second Metal trace contained no intervals attributable to the selected OpenADE WebKit GPU process. That is an uninformative workload, not zero frame cost or a speedup. Earlier interactive GPU measurements remain historical, exclude WindowServer material cost and lack a matched baseline. Intel/older macOS/work-machine runtime, clean latest desktop captures/walkthrough, full-frame performance, and notarized distribution remain open. No Developer ID Application signing identity was available at the last check. Private captures, traces and transcripts remain local.

### September 27 local desktop continuation checkpoint

Added linked/snapshot themes with stable declaration identities and last-good reload, projectless chats, authenticated PNG/JPEG/GIF attachments and native lightbox, Markdown/raster previews, lexical syntax, prompt rail, native fonts/window geometry and persisted workspace controls. Custom menus block session shortcuts and keep focus; sidebar disclosure state survives Settings. Pending draft/image ownership survives navigation and rejection without duplicate sends. Optional Codex cache reads now fall back within one second with at most two outstanding reads; invalid/nonregular caches do not stall metadata.

Verification: 83/83 full E2Es, then 23/23 affected engine/attachment flows and 3/3 final syntax flows, types/build and Go vet; final universal native build and actual delivered/isolated native window checks. Local artifact is OpenADE-macOS-universal.zip; ad-hoc signing is local delivery, not notarized distribution. Fresh app screenshots remain local and were shown inline. The clean previous video is historical; latest desktop recording is still obstructed by tool-caused OS alerts. Full local capability parity and matched native frame profiling remain unfinished; see the maintained feature map/audit.

## September 27 — persistent Codex interaction checkpoint

Codex 0.156+ uses bounded persistent stdio app-server conversations with typed images, live steering, explicit custom questions/command approvals and actual context telemetry. Legacy Codex/Claude CLI paths remain. Request ownership, ordered start acknowledgement, final EOF drain, atomic queue claims and crash-safe uncertain delivery are covered end to end. Unknown approval scopes and file approvals lacking a displayed patch fail closed; no permissions or answers are silently accepted or persisted.

Full regression: 102/102 production-client E2Es before the final approval/retry-recovery guards, then 15/15 focused provider checks after them. Native questions/private input/composer focus and context popup placement/Escape/Settings dismissal were inspected using an isolated fixture profile. Its executable path was asserted before dispatch. Fresh native screenshots were shown inline and kept local. The updated map has 38 implemented, 33 partial and seven gap local capability areas (69.9/100 weighted counterpart index, not visual fidelity). Local project/sidebar management, other provider protocols, side chats/comments, media formats, naming and distribution remain active work. Installed Codex 0.156.1 completed two actual native app-server turns in an isolated owned folder, remembered the first marker without tools and supplied real context telemetry; its README remained unchanged. Actual-account approval/steering paths, other providers, latest clean continuous native walkthrough, matched native frame profiling and work-machine compatibility remain unverified.

## September 27 — project, sidebar, archive and composer continuation

The local counterpart now includes persistent project display aliases and resource-safe removal/re-add, source-shaped project/chat action cards, stable custom sections with pointer/keyboard reordering, functional Compact rows, daemon-backed archive recovery and the established-chat compact/expanded composer. The native bridge uses public AppKit layout/display invalidation on the existing WKWebView after a scheme change; the actual regular-width QA window immediately repainted on both Light and Dark switches. The light terminal now repaints existing rows with readable foreground colors. OpenADE’s header and five-icon rail remain intentionally distinct.

The full 118-flow production-client suite passed before the final native redraw, terminal and popup-selection edits; their two affected browser flows passed afterward. A fresh read-only review found three deletion races, all corrected: project creation is barred through confirmed removal commit, terminal state persists before its live entry is removed, and persistent Codex subprocess exit is awaited before metadata deletion. The full 16-flow project/sidebar suite then passed with a real fixture-PID exit assertion, followed by Go vet and a new universal macOS build. The production frontend build passed. The signed delivered preview launched and its ZIP passed extraction checks. A new 20-second walkthrough assembles authentic native window captures; it is explicitly not a continuous desktop recording. The Screenshot utility still fails to bind through Computer Use with `-10005`, `NSCocoaErrorDomain Code=256`, `RBSRequestErrorDomain Code=5`, `NSPOSIXErrorDomain Code=162 (Launchd job spawn failed)`. No denial was bypassed. The maintained map counts 39 implemented, 32 partial and seven gap local areas among 78; its 70.5/100 weighted counterpart index is not a pixel-fidelity score. Two isolated browser-performance runs disagree on cold-ready p95 (163.7/107.2ms); input p95 was 16.6/15.7ms and session switch 36.1/40.6ms. Native FPS, work-machine/Intel runtime and notarization remain unverified. The PR stays draft and unmerged.
## September 27 — New Thread artwork and transcript metadata

The local New Thread canvas now accepts optional managed PNG/JPEG/GIF artwork through a native file chooser. Appearance offers five source-named effects and Replace/Remove controls; the choice survives daemon restart. Dither, ASCII and Halftone are CSS approximations rather than Zeron's pixel processing. The composer retains an opaque-enough local surface for readable text. Completed chats now expose source-style user/assistant hover timestamps and Copy actions without moving transcript rows; old messages without timestamp markers cannot recover exact dates.

The expanded production-client suite passed 122/122 against the real Go daemon and synthetic providers. After the final shared date-formatter optimization, two affected chat flows passed 2/2. Go vet, production frontend build and universal Wails build passed. Native QA used the macOS image picker, opened the custom effect menu, checked image persistence after app and daemon restart, and used a completed fixture conversation to inspect hover metadata and Copy feedback. The latest isolated 24-session/260-turn browser run measured cold/warm/input/switch/first-stream p95 at 120.2/38.7/16.4/40.3/487.9ms, retained renderer heap 9.65MiB and engine RSS 30.5MiB; it released all live resources. These are browser/synthetic-provider timings, not native FPS or a matched whole-app regression score.

The map now has 39 implemented, 33 partial and six gap local capability areas among 78; its 71.2/100 weighted index is counterpart coverage, not visual fidelity. Native window stills are local. The updated still-frame walkthrough is not a continuous recording or evidence of desktop transmission. Screenshot binding failed with `-10005`, `NSCocoaErrorDomain Code=256`, `RBSRequestErrorDomain Code=5`, `NSPOSIXErrorDomain Code=162 (Launchd job spawn failed)`; no source-build denial repeated. Local-only scope, older macOS/Intel runtime, whole-frame native profiling and notarization remain open as documented in the feature map.
