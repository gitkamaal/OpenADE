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
