# Native material verification

`backdrop.m` is an optional visual E2E fixture: an ordinary native window with
warm/cool columns and white/black bands behind the regular OpenADE window. It
never changes wallpaper, accessibility preferences, credentials, or input.
It is excluded from normal application builds.

From `apps/desktop`, with a compatible macOS SDK and the Wails CLI on PATH:

```sh
./e2e/native/build-visual.sh
OPENADE_VISUAL_E2E=1 build/bin/OpenADE.app/Contents/MacOS/OpenADE
```

Use an isolated OpenADE profile when creating test sessions. Inspect both
Frosted and Liquid Glass against the bands, open model/branch menus, scroll a
file and transcript, open/type/close a terminal, resize the regular window,
and switch through Opaque, Light, Dark and System. Verify focus and text clarity.
On macOS 26+ the Liquid Glass backing is an `NSGlassEffectView` over a public
behind-window `NSVisualEffectView`; the WebKit foreground stays in a stable
sibling. Composer and popover frost remains a CSS approximation.

Native window-only ScreenCaptureKit captures may replace the desktop material
with a flat snapshot. Such captures verify layout and foreground rendering,
but cannot prove desktop color transmission. Use a full-display capture for
that assessment. OS accessibility settings and macOS <26 fallback also require
native system checks; the Playwright bridge fixture covers client reactions,
including terminal material updates, rather than emulating AppKit.

After visual checks, build normally to remove the fixture from the binary:

```sh
npm run build
wails build -m -skipbindings -s
```
