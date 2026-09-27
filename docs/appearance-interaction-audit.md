# OpenADE local appearance and interaction audit

September 27, 2026. The current target is **local desktop parity**, preserving Go/Wails, OpenADE’s header and five-icon rail. Stage Manager was disabled at the user’s request; full-size native app-window captures now work. The latest change removes Transparent mode, defaults to Frosted, caps background adjustment at 90%, preserves the native blur at full strength and matches Zeron’s measured chat/composer geometry. The rebuilt app also adds the global command/history palette, source-style local project picker, plain-folder sessions, diagonal sidebar hover intent, source switch geometry, native editor context actions and persistent terminal ordering/closure. **Complete 1:1 local parity is not yet achieved.**

## Source, access and scope

Pinned Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`. Source code and the actual native source build were inspected before porting behavior. Current New project is a device/location/folder picker; no clone wizard was found in the inspected source UI. Its editor context menu is Cut/Copy/Paste/Select All; the earlier file CRUD claim was corrected.

Filesystem, builds, local engine and GitHub access work. The native production app and Zeron Source are accessible. No Source-build approval rejection repeated. Remote/cloud/mobile/account relay and previously excluded Appshots stay outside this local-only target. Source Loro/RPC implementation choices are mapped separately from the authorized Go engine architecture.

## Quantified checks

| Measure | Result | Boundary |
|---|---:|---|
| Final production-client E2Es | 51/51 passed, then 4/4 affected flows | Real Go engine, synthetic provider CLIs; end-to-end tests only |
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
- Settings retains drafts, dirty documents, undo/focus and panel/browser state. Native slider pointer and keyboard adjustment worked (78 → 77), plus Home/Page Up to 50. Opaque disables the slider and stays solid; Light/Dark/System and Frosted/Liquid/Opaque were inspected; legacy Transparent migrates to Frosted.
- A long folder path wrapped the picker heading; it now stays on one line. Failed navigation disables Add project so it cannot accidentally add the previous folder. Native directory waits are bounded to five seconds with at most four outstanding filesystem operations; FIFO/non-directory rejection and recovery are covered end to end. The rebuilt native daemon returned HTTP 504 with the native-chooser recovery hint after **5.011 seconds** for a blocked folder read, while its health endpoint remained responsive.

## Materials and actual desktop capture

Text/icons remain opaque; no global interface opacity is applied. The slider adjusts palette background coverage. Clear mode removes native material views and keeps a clear, non-opaque window. Frosted uses public behind-window NSVisualEffectView. Liquid uses genuine public NSGlassEffectView Clear on macOS 26+ over a behind-window material; unsupported systems get a labeled Frosted fallback. Composer/popover blur is a CSS approximation. Opaque and accessibility solid fallbacks remain; clear-mode text shadow was removed for crisp lettering.

The 1480×920 app-window captures flatten the desktop backdrop. They establish native layout and foreground rendering, not wallpaper transmission. After the user handled the Documents-access dialog, the previously blocked folder loaded in **35ms**, with zero live sessions, terminals and stream clients. Selected-folder access through the native chooser had already enabled the real Codex folder session. The agent did not accept a broad Documents grant; the user's choice is not inferred.

Actual 2560×1080 full-display captures and a continuous system screen recording establish desktop color transmission through the regular 1480×920 native window. A local AppKit contrast fixture supplies colored quadrants and white/black bands without changing the wallpaper or delivered app. Full desktop frames 58 (Frosted 45%), 59 (Liquid 50%) and 61 (Zeron alone on the same backdrop) are retained locally. The diagnostic colors are test data, not application theme colors. Source and OpenADE window sizes/content differ; these are qualitative material comparisons, not pixel-fidelity measurements.

The full-strength Frosted fix was motivated by frame 48: fading NSVisualEffectView to 0.40 mixed sharp desktop edges into the blur. A separate public AppKit probe confirmed that behavior; Frosted now uses alpha 1.0 and adjusts CSS background washes independently. Source GPUI uses additional private filter/tint manipulation; OpenADE does not port those private APIs. Liquid uses public NSGlassEffectView on supported macOS 26 SDK/runtime, with public NSVisualEffectView fallback. Opaque and accessibility solid surfaces remain available. Browser frost is labeled an approximation.

The user dismissed the earlier “screencaptureui can’t be opened” alert. No denial was bypassed: Computer Use had refused its host with `Computer Use is not allowed to use the app 'com.openai.codex' for safety reasons.` Launching the standard Screenshot application through Finder, then binding its already-running service, recovered full-screen capture. The continuous native recording was stopped through its exposed Stop Screen Recording control. The original 284.46-second H.264 recording contains one video stream and no audio; the delivered walkthrough is its first 180 continuous seconds, not a slideshow or browser video. It shows compact/expanded composer and model dropdown, project/Compact menus, resize/zoom, editor scrolling, a real project terminal, theme and material changes. Representative video frames were inspected. App-window Computer Use snapshots flatten the backdrop; full desktop captures/recording establish transmission. Some still desktop captures include an unrelated OS background-app notice outside the app; the reviewed video frames avoid it.

Native before/after chat frames 54–57 show the corrected composer. Zeron’s 49px established-thread pill, 26px radius, 736px column, 200px text capacity, 32px collapse hysteresis and 150ms resize settle are implemented. Multiline drafts grow to a 60–260px textarea; new chats remain expanded with a 76px minimum and a 768px default width. The final Home width correction passed the four affected composer/settings flows after the full suite. Model controls move right/left; checkout and branch metadata sit below. User bubbles have one 80% width limit, 16×10px padding, 14px/22px text and an accessible five-line fold. E2Es exercise growth, clearing, narrow resize, menu anchoring/focus and folding; native compact/expanded/menu/scroll flows were inspected. The working Skills/commands action remains a plus button; source image attachment picker/draft strip and exact animated morph remain gaps rather than decorative imitation.

## Matched browser performance

Fresh equivalent fixtures use 24 sessions, two projects and 260 historical turns; five cold/reload/stream samples and twelve switches. Chromium runs the production client against the real Go engine with synthetic provider CLIs. Real provider/network latency and native compositor performance are excluded. The latest two isolated runs are retained along with the suite-wide run; the suite-wide engine RSS is not compared because it includes preceding tests’ sessions.

| Metric | Earlier baseline | Latest isolated runs |
|---|---:|---:|
| Cold ready p95 | 110.2 ms | 98.5 / 101.9 ms |
| Reload ready p95 | 39.8 ms | 29.6 / 27.6 ms |
| Input to two frames p95 | 16.6 ms | 16.0 / 16.6 ms |
| Session switch p95 | 37.0 ms | 35.9 / 36.8 ms |
| First stream visible p95 | 479.9 ms | 832.1 / 818.0 ms |
| Engine RSS | 29.70 MiB | 29.58 / 28.80 MiB |

The stream timing worsened in the latest isolated samples. A suite-wide run was 494.1ms, and an earlier retained outlier was 816.3ms; these results are variable and do not justify either a speedup or a regression-free claim. Provider-start/session-render latency remains a profiling gap. Input and switch budgets pass.

Uncollected renderer heap ranged from 8.15 MiB in the suite to 21–22 MiB in fresh runs. The added explicit garbage-collection measurement gives 7.26 MiB retained; the earlier baseline did not force GC, so those heap readings are not a matched retained-memory comparison. Transcript rendering remains bounded to 80 articles. The measured engine had zero live sessions, terminals and stream clients after the workload. Raw metrics remain local in chat-final-performance.json, chat-matched-performance.json and chat-matched-gc-performance.json.

## Native GPU profile

A new 15-second Metal System Trace attached OpenADE’s dedicated WebKit GPU process 50112 (launched one second after host 50111; the only running WebKit GPU process) during Frosted 50% composer growth/clear/scroll and custom model-popup interaction. Filtering ownership leaves 546 active GPU intervals across 88 command buffers. Merging overlapping Vertex/Fragment intervals within each buffer gives active GPU work p50 **0.095ms**, p95 **0.963ms**, max **3.652ms**; start latency p95 **1.867ms**. No command-buffer errors were recorded.

These are GPU command-buffer measurements, not FPS, whole-frame or input-to-display latency. Native WindowServer material cost is excluded. The preceding profile’s panel/diff workload differed, so it is retained as historical evidence, not a matched regression baseline. Whole-frame profiling and a matched native comparator remain unverified. Raw trace, valid exports and native-chat-frosted-gpu-profile.json remain local.

## Delivery and remaining work

Native before frames `14-before-native-view-menu.png` and `16-local-native-before.png`; native after frames 20–40 include materials, menus, palette, folder flow, editor/context/scroll, resize/zoom, diffs, terminal input/closure and actual Codex continuation. Browser captures are labeled separately. Native screenshots and diagnostic desktop data remain local; no private captures/transcripts are committed.

The rebuilt ad-hoc-signed arm64 app/archive and `OpenADE-native-continuous-walkthrough.mp4` are local artifacts under `outputs/theme-interaction-audit`. Older snapshot/browser videos remain labeled historical artifacts. Types/build, Go vet, native build, signature/archive checks and final E2Es are the verification gates. The existing PR stays a draft and unmerged.

Stage Manager and the capture alert are resolved; native desktop transmission, regular-window interaction and a continuous native walkthrough are verified. Exact full-product source parity and matched whole-frame regression profiling remain incomplete. Remaining source capabilities include custom theme imports, project rename/remove and projectless chats, session tabs, rich attachments/questions/MCP/naming/minimap/context usage, side chats/comments/previews/history controls and additional provider/account adapters. Older macOS/work-machine runtime and notarized distribution remain unverified.
