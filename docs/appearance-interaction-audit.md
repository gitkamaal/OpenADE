# OpenADE transparency, themes and interaction audit

The rebuilt desktop adds adjustable background transparency, all 30 Zeron built-in theme variants, a real project filter dropdown, side-anchored view menus, visibly different Compact rows, seamless resize grips, and Settings continuity for drafts/editors/panels. OpenADE’s header and five-icon rail remain. **This is not complete 1:1 Zeron parity.** The feature map explicitly records unsupported features and interaction differences.

## Access and source baseline

- Repository: `feature/zeron-parity`, baseline `3f38902315461cbdf2a31110fff21cab73ff22f0`; initial request’s `458801b` had already been superseded by the transparent-window correction. Filesystem reads/writes, builds and GitHub network access verified; draft PR #1 is the personal fork’s open draft.
- Source reference: Zeron v0.2.92, `68ef78bb1e6fa0b84feeb68c382230f8c560f96a`, including actual resolved registry export, current UI modules, settings, Shell actions and the user’s native dropdown screenshots.
- Native OpenADE and the already-running Zeron Source build are accessible through Computer Use. No repeat Source-build approval rejection occurred in this pass. Native screenshots currently alternate between full windows and small skewed Stage Manager thumbnails; source capture also had earlier 2×2/no-window results. The thumbnails/invalid captures are not counted as full visual verification. Dock binding returned exactly `Computer Use server error -10005: timeoutReached`.

## Scores with explicit denominators

| Measure | Result | Meaning |
|---|---:|---|
| Unique end-to-end checks | 43/43 passed | Final full suite includes narrow-pane layout, filtered keyboard navigation, popup dismissal and action-menu behavior. Actual Go engine; synthetic provider CLIs. |
| Built-in variants | 30/30, 100% | 19 families; 10 light, 20 dark. UI-selected and persisted, source background/syntax/ANSI/diff role checks. |
| Automatic custom choice inventory | 17/17, 100% | Home and Settings enabled choices open custom popups, expand, fit viewport, dismiss on Escape, restore focus. Other action/model/panel/command menus have dedicated flows. |
| Solid-theme text contrast | 30/30, 100% | All body and muted text ≥4.5:1 against solid palette background. This is not a contrast guarantee over arbitrary desktop content. |
| Responsiveness budgets | 2/2, 100% | Input-to-two-frames p95 <150ms; session switch p95 <600ms. Chromium production build, not native compositor timing. |
| Source feature mapping | 87 areas + 66 settings fields | Every mapped area states counterpart, partial difference, gap or intentional OpenADE addition. Includes backend/cloud/remote/mobile, not just visible buttons. |
| Fully implemented counterparts | 30/86, 34.9% | Excludes one intentional OpenADE addition. 30 partial, 26 gaps. This measures broad capability coverage, not pixel fidelity. |
| Capability coverage index | 52.3/100 | Rubric: implemented=1, partial=0.5, gap=0 across the 86 source areas. Working full/partial counterparts: 60/86 (69.8%). |
| Whole-product visual fidelity | Not scored | Full-size native after capture and comprehensive native visual review remain incomplete; assigning a high cosmetic score would be misleading. |

## Interaction audit and concrete fixes

1. **Project filter — improved, partial source parity.** “All projects” now opens a custom searchable popup beneath its trigger, with All projects always available during search, local host labels, selection check and New project footer. Selection filters actual sessions. New project opens the workspace-folder settings flow; source clone/create/project palette remains a gap. Evidence: `11-project-picker.png` and project-picker E2E.
2. **Sidebar view menu — improved, partial.** The ellipsis popup is beside the trigger, with side-opening Organize/Sort choices, source “None” naming, Show details and Compact. Context menus are placed at the pointer. Whole-row clicks open Organize/Sort; radio selection keeps the parent menu open, as in the source. Source diagonal hover-intent and full context-menu hierarchy remain different. Evidence: `12-expanded-sidebar.png`, `13-compact-sidebar.png`; geometry checks wait for menu animation to settle.
3. **Compact — fixed.** Compact hides project/branch metadata and uses 29px rows; expanded rows show metadata at 45/61px. Native AX inspection confirmed `OpenADE @ Local` disappears and returns when toggled. It is no longer a cosmetic switch without a clear content change.
4. **Resize — fixed.** Hover/pointer dragging paints no accent stripe and does not select transcript text. RAF-coalesced resizing persists one preference write per completed drag, compared with 34 in the first instrumented audit. Keyboard arrows/Home/End, values, focus outline and double-click reset remain. A needless observer in full-width shell sessions was removed; lifecycle checks pass.
5. **Panel picker — fixed.** Choosing Diffs while the empty right panel was open could toggle it closed because the default tab matched before it existed. The toggle now checks that the tab is already in the open-tab list. Scope/stage/split tests pass. Diff scope uses a readable text button rather than an icon-sized frame; narrow composers wrap their controls without clipping Send. Compressed resize limits report actual geometry and become keyboard-disabled until space is available.
6. **Settings continuity — fixed.** Visiting Settings retains the session workspace, unsent draft, dirty document, editor undo/focus, panel state and preview URL. The retained workspace is hidden/inert; hidden keyboard consumers are guarded, and native preview bounds hide its overlay. Leaving to another session still protects dirty edits.
7. **Custom popup keyboard behavior — improved.** Choices focus their actual listbox or search input; Escape/Tab/outside blur close correctly. Action menus acquire focus, support arrows/Home/End and return focus on Escape. Footer button Enter performs its action. Collapsing the sidebar dismisses its popup; a reference-counted custom-menu marker keeps the native preview hidden until all nested popups close. Filtered next/previous and numeric session jumps follow the visible sidebar order. Source hover traversal is still a listed gap.
8. **Theme/material propagation — improved.** UI, menu, composer, chat, settings, editor, diff and terminal roles use the resolved catalog. Editors get all relevant syntax roles and terminals all 16 ANSI entries. Same-palette layout changes no longer reassign terminal theme/font options. Light accents use the source’s darker preset colors; Theme default swatch shows the actual theme accent.
9. **Unavailable Sites actions — fixed.** Disconnected Create/Refresh controls are disabled and the empty state says Sites are not connected, instead of presenting working-looking no-op actions. Sites is an intentional OpenADE addition.
10. **Native appearance — partially verified.** Real native mode changes report genuine Liquid Glass and solid Opaque behavior, complete dark catalog selection works, the production searchable project picker opens, and Compact changes actual native row content. The separate AppKit-band fixture shows native canvas alpha. Full-size after captures, regular-window desktop-background comparison, native slider pointer/keyboard changes, native editor/terminal/scroll/resize inspection and native frame/GPU profiling remain outstanding because captures return thumbnails. Browser checks are not substituted for those claims.

## Material behavior

The slider controls palette-background coverage from 0–100 while text/icons stay opaque. Fresh profiles default to 50; legacy Transparent profiles migrate to 78 and other saved materials to 45, preserving the previous look. Transparent is a clear native window; Frosted uses public behind-window NSVisualEffectView. Liquid uses genuine public NSGlassEffectView with clear style on supported macOS, plus a public behind-window material; unsupported systems use a labeled Frosted fallback. Accessibility requests resolve solid surfaces. Opaque is preserved. The slider controls tint density rather than claiming to change native blur physics.

Browser materials are explicitly an approximation. Native accessibility events are simulated only in browser E2Es; the host’s Reduce Transparency/Increase Contrast settings were not changed. Older OS fallback is code/build verified, not exercised on an older Mac. The colorful band fixture is test-only, within the native window, and is **not** proof of desktop transmission. Its app has been closed; Zeron Dark/theme-default accent is restored in the production preview; the delivered production binary contains neither fixture code nor fixture environment flags. No wallpaper changes were made.

## Matched performance profile

Baseline and rebuild were run separately from freshly prepared equivalent fixtures: 24 sessions, 2 projects, 260 historical turns; 5 cold/reload samples, 12 session switches, 5 first-stream samples. Memory measurements from the accumulated full test suite were rejected for comparison and replaced with isolated samples. Small timing differences with these sample counts are not evidence of a statistically significant speed improvement.

| Metric | Baseline | Rebuilt | Change |
|---|---:|---:|---:|
| Cold ready p95 | 110.2 ms | 102.2 ms | -7.3% |
| Reload ready p95 | 39.8 ms | 37.3 ms | -6.1% |
| Input to two frames p95 | 16.6 ms | 17.5 ms | +5.4% |
| Session switch p95 | 37.0 ms | 36.7 ms | -1.0% |
| First stream visible p95 | 479.9 ms | 494.2 ms | +3.0% |
| Renderer JS heap | 8.30 MiB | 8.93 MiB | +7.6% |
| Engine RSS | 29.70 MiB | 29.03 MiB | -2.3% |
| Inactive transcript article cap | 80 | 80 | bounded |
| Remaining stream clients | 0 | 0 | released |

The palette catalog increases initial compressed JS by 17.2 KiB and CSS by 7.6 KiB. Theme selection median 201.0ms includes opening/selecting/awaiting the custom menu, so it is not a pure paint benchmark. Minimum solid body contrast 6.10:1; muted 4.56:1.

One recorded warm frontend build took 4.63s; native packaging 2.70s. Final builds passed after later menu fixes. Go vet and git diff checks pass. Vite still reports its existing >500KB chunk warning; terminal and editor remain lazy chunks. Source notices and hashes are retained and OpenADE’s Apache-2.0 root license is unchanged.

A real 10-second Instruments Time Profiler attachment recorded 3 CPU samples (3ms weighted) and no potential hangs over 250ms in the idle Wails host. This excludes WebKit/XPC/GPU/provider work and does not establish interactive frame performance. Raw trace and exported tables are retained.

A five-sample native process read showed the durable Go daemon around 21.5 MiB and the Wails host around 111.5 MiB, with ps averaged CPU 0.0%/0.5%. This excludes WebKit/XPC/GPU/provider allocations and is not a matched total-native baseline or compositor/frame-time benchmark.

## Evidence and delivery

- [Full feature/settings/action map](zeron-feature-map.md) and [theme catalog/provenance](theme-catalog.md) are checked into the draft PR. JSON profiles and captures are in `outputs/theme-interaction-audit`.
- `01-before-sidebar-resize.png` and `14-before-native-view-menu.png` are full native baseline captures. `native-alpha-thumbnail.png` is deliberately labeled limited native evidence. Full native after screenshots remain pending; `11-project-picker.png`, `12-expanded-sidebar.png`, `13-compact-sidebar.png`, `15-narrow-workspace.png` and `theme-gallery.png` are browser captures.
- `OpenADE-walkthrough.mp4` is an updated 32s browser walkthrough, slowed 4× for readability, with a persistent caption identifying its renderer/limitation. It does not replace the requested native walkthrough recording.
- Rebuilt `OpenADE Preview.app` and `OpenADE-macOS-arm64.zip` are local ad-hoc-signed arm64 artifacts; signature and archive CRC verified. The same rebuilt app/archive also replace the earlier glass-refinement delivery locations. The work machine has not been exercised, and Intel/Windows/Linux builds or notarization are not part of this artifact.
- Draft PR remains open and unmerged. Remaining source gaps include custom theme imports, source hover-intent/global palette/session tabs, rich attachments/questions/side chats/comments, complete file context actions/history columns/provider accounts/ACP adapters, remote sync/cloud/mobile and distribution updates. Details and counterpart locations are in the map, rather than hidden from the scores.

## Native review still required

Bring the production preview to the foreground in a session where full-window captures work, then capture regular-window Transparent/Frosted/Liquid/Opaque at 25/55/75 over contrasting desktop backgrounds; drag/resize/scroll, open each popup, switch palettes and exercise the editor, diff, native browser and terminal. Capture full-size native after frames and native walkthrough, and measure native frame/GPU/whole-process resources. Those are real unfinished verification items, not user-setting assumptions or approval rituals.
