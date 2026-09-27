# OpenADE local transparency and interaction audit

September 27, 2026. The current target is **local desktop parity**, preserving Go/Wails, OpenADE’s header and five-icon rail. Stage Manager was disabled at the user’s request; full-size native app-window captures now work. The rebuilt app adds the global command/history palette, source-style local project picker, plain-folder sessions, diagonal sidebar hover intent, source switch geometry, native editor context actions and persistent terminal ordering/closure. **Complete 1:1 local parity is not yet achieved.**

## Source, access and scope

Pinned Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`. Source code and the actual native source build were inspected before porting behavior. Current New project is a device/location/folder picker; no clone wizard was found in the inspected source UI. Its editor context menu is Cut/Copy/Paste/Select All; the earlier file CRUD claim was corrected.

Filesystem, builds, local engine and GitHub access work. The native production app and Zeron Source are accessible. No Source-build approval rejection repeated. Remote/cloud/mobile/account relay and previously excluded Appshots stay outside this local-only target. Source Loro/RPC implementation choices are mapped separately from the authorized Go engine architecture.

## Quantified checks

| Measure | Result | Boundary |
|---|---:|---|
| Final production-client E2Es | 49/49 passed | Real Go engine, synthetic provider CLIs; end-to-end tests only |
| Built-in themes | 30/30 | 19 families, 10 light and 20 dark; background/syntax/ANSI/diff roles, selection and persistence |
| Automatic custom-choice inventory | 17/17 | Home/Settings popups open, fit, dismiss and return focus; other menus have dedicated flows |
| Solid theme contrast | 30/30 | Body and muted text ≥4.5:1 against solid palette backgrounds; arbitrary desktops vary |
| Browser responsiveness budgets | 2/2 | Input p95 <150ms; switch p95 <600ms |
| Actual native Codex folder turns | 2/2 completed | First/resumed turns in a non-Git folder; same provider thread, read-only fixture |
| Local capability counterparts | 34/79 fully implemented | 28 partial and 17 gaps; capability, not pixel fidelity |
| Local capability index | 60.8/100 | Implemented=1, partial=0.5, gap=0; exclusions and intentional architecture stay visible in the map |
| Whole-product visual fidelity | Not scored | No automated test establishes every source interaction or pixel match |

The [complete map](zeron-feature-map.md) retains 87 areas, 66 settings fields and 12 action areas. It separates five out-of-scope areas and three intentional choices from the 79 local capability areas; remaining local gaps are not hidden by narrowing the scope.

## Implemented interactions and native audit fixes

- All projects opens the custom searchable menu under its trigger. Its New project footer, global palette action and Mod+Shift+N open the local device → location/folder palette. Projects persist before a chat exists. Git subfolders normalize to one project root; ordinary folders use an explicit Folder workspace, with Git-only controls disabled or explained.
- Mod+K and the header search button open the centered 560px action/history palette. It searches all local chats independently of sidebar filters, includes archived history, restores focus and supports arrows/Enter/Escape without repeat activation.
- Sidebar choices include source By device/By project/None and Created/Last updated. The 300ms diagonal pointer corridor follows source intent; nested choices stay beside the trigger. Compact changes row metadata and density. Its white 24px pill thumb, 44.8px switch and 180ms motion follow current source widgets. Priority/Manual remain OpenADE additions.
- Sidebar dragging uses a transparent seam and one persisted preference write per completed drag. Native drag and double-click reset worked. Native Window → Zoom resized 1480×920 to 2560×1050 and restored layout/editor state. Computer Use edge drags did not change the window size, so manual edge-drag behavior is not claimed from those attempts.
- Editor Cut/Copy/Paste/Select All uses a custom 170px pointer menu, native clipboard bridge, disabled states, selection/undo and stale-edit guard. Native selection, menu dismissal and long-file scrolling were inspected; editing checks use isolated E2E workspaces.
- Terminal tabs reorder by drag or Alt+Left/Right and close on middle-click. Closed tabs stay closed after a native relaunch; stop errors remain visible. Native shell input returned the expected marker and cleanup left zero live terminals. The TUI action now uses the selected theme accent rather than a hardcoded blue.
- Native staging/split/scoped diffs changed a real temporary repository index and were undone. Empty scopes name staged/latest-turn/branch/working changes correctly; a filter with no matches gives a clear message and disables file navigation. The temporary file was removed.
- Settings retains drafts, dirty documents, undo/focus and panel/browser state. Native slider pointer and keyboard adjustment worked (78 → 77), plus Home/Page Up to 50. Opaque disables the slider and stays solid; Light/Dark/System and Transparent/Frosted/Liquid were inspected.
- A long folder path wrapped the picker heading; it now stays on one line. Failed navigation disables Add project so it cannot accidentally add the previous folder. Native directory waits are bounded to five seconds with at most four outstanding filesystem operations; FIFO/non-directory rejection and recovery are covered end to end. The rebuilt native daemon returned HTTP 504 with the native-chooser recovery hint after **5.011 seconds** for a blocked folder read, while its health endpoint remained responsive.

## Materials and actual desktop capture

Text/icons remain opaque; no global interface opacity is applied. The slider adjusts palette background coverage. Clear mode removes native material views and keeps a clear, non-opaque window. Frosted uses public behind-window NSVisualEffectView. Liquid uses genuine public NSGlassEffectView Clear on macOS 26+ over a behind-window material; unsupported systems get a labeled Frosted fallback. Composer/popover blur is a CSS approximation. Opaque and accessibility solid fallbacks remain; clear-mode text shadow was removed for crisp lettering.

The 1480×920 app-window captures flatten the desktop backdrop. They establish native layout and foreground rendering, not wallpaper transmission. macOS’s actual Screenshot UI was recovered at `/System/Library/CoreServices/screencaptureui.app`; a genuine full-display capture was saved locally. It revealed a pending Documents-access dialog behind OpenADE and a Finder window covering the scene. That frame is diagnostic evidence, not the requested clean contrasting-desktop comparison.

Selected-folder access through the native chooser worked and enabled the real Codex folder session. A broad Documents grant has not been accepted by the agent. Computer Use refused the dialog’s system app exactly: `Computer Use is not allowed to use the app 'com.apple.UserNotificationCenter' for safety reasons.` The user was asked to handle the prompt. No coordinates, alternate app or shell command bypass that refusal. Clean desktop comparison and continuous native recording remain dependent on that handoff; the old Stage Manager thumbnail limitation is resolved.

## Matched browser performance

Fresh equivalent fixtures: 24 sessions, two projects, 260 historical turns; five cold/reload/stream samples and twelve switches. These are Chromium production-client measurements against the actual Go engine, with synthetic provider CLIs. They exclude real provider/network latency and do not establish native compositor performance.

| Metric | Baseline | Rebuilt repeat | Change |
|---|---:|---:|---:|
| Cold ready p95 | 110.2 ms | 96.0 ms | -12.9% |
| Reload ready p95 | 39.8 ms | 28.0 ms | -29.6% |
| Input to two frames p95 | 16.6 ms | 15.5 ms | -6.6% |
| Session switch p95 | 37.0 ms | 36.2 ms | -2.4% |
| First stream visible p95 | 479.9 ms | 486.9 ms | +1.5% |
| Renderer JS heap | 8.30 MiB | 8.99 MiB | +8.3% |
| Engine RSS | 29.70 MiB | 29.98 MiB | +0.9% |

The first local run had a first-stream outlier of 816.3ms and a switch worst sample of 45.7ms. A fresh repeat produced 486.9ms/36.2ms; both runs are retained. Small samples and this variability prevent a statistically significant speed or regression-free claim. The transcript remains capped at 80 articles and remaining stream clients are zero.

## Native GPU profile

A 15-second Metal System Trace attached OpenADE’s dedicated WebKit GPU process during Compact/panel/split-diff/staging interactions. After filtering process ownership, 600 active GPU intervals across 51 command buffers were measured. Overlapping Vertex/Fragment intervals were merged within each buffer: active GPU work p50 **0.609ms**, p95 **1.615ms**, max **1.835ms**. Start latency p95 **2.183ms**. CPU Metal encoding p95 **0.236ms** across 249 encoders; no command-buffer errors were recorded.

These are command-buffer measurements, not FPS or whole-frame/input-to-display latency. Global compositor tables include unrelated processes and missing latency and are excluded from OpenADE frame claims. The execution-point XML export is malformed; valid interval/submission tables were used. The trace warned about backdated signposts; final post-recording exports were analyzed. No matched native GPU baseline exists. Raw trace, valid exports and `native-gpu-profile.json` remain local.

## Delivery and remaining work

Native before frames `14-before-native-view-menu.png` and `16-local-native-before.png`; native after frames 20–40 include materials, menus, palette, folder flow, editor/context/scroll, resize/zoom, diffs, terminal input/closure and actual Codex continuation. Browser captures are labeled separately. Native screenshots and diagnostic desktop data remain local; no private captures/transcripts are committed.

The rebuilt ad-hoc-signed arm64 app/archive and the explicitly labeled snapshot-based native walkthrough are local artifacts under `outputs/theme-interaction-audit`. A snapshot walkthrough does not replace a continuous native recording. Types/build, Go vet, native build, signature/archive checks and final E2Es are the verification gates. The existing PR stays a draft and unmerged.

Next handoff-dependent check: clear the pending OS prompt, capture the regular window over contrasting desktop areas and record the continuous native walkthrough through the recovered system UI. Remaining source capabilities include custom theme imports, project rename/remove and projectless chats, session tabs, rich attachments/questions/MCP/naming/minimap/context usage, side chats/comments/previews/history controls and additional provider/account adapters. Older macOS/work-machine runtime and notarized distribution remain unverified.
