#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: build-handoff.sh OUTPUT_DIRECTORY" >&2
  exit 2
fi

output_dir="$1"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
cd "$(dirname "$0")/.."

# Playwright builds dist with a synthetic daemon URL and token. Always rebuild
# the embedded frontend for a handoff, even when a QA build just succeeded.
unset VITE_OPENADE_DAEMON_URL VITE_OPENADE_AUTH_TOKEN OPENADE_VISUAL_E2E
export SDKROOT="${SDKROOT:-$(xcrun --sdk macosx --show-sdk-path)}"
npm run build

if command -v wails >/dev/null 2>&1; then
  wails_bin="$(command -v wails)"
else
  wails_bin="$(go env GOPATH)/bin/wails"
fi
if [[ ! -x "$wails_bin" ]]; then
  echo "Wails CLI is required to build the macOS app" >&2
  exit 1
fi
"$wails_bin" build -m -skipbindings -s -platform darwin/universal

app="$output_dir/OpenADE.app"
if [[ -e "$app" ]]; then
  echo "output already exists: $app" >&2
  exit 1
fi
ditto build/bin/OpenADE.app "$app"
binary="$app/Contents/MacOS/OpenADE"
python3 - "$binary" <<'PY'
from pathlib import Path
import sys

binary = Path(sys.argv[1]).read_bytes()
for fixture in (b"openade-e2e-synthetic-token-2026", b"127.0.0.1:7455"):
    if fixture in binary:
        raise SystemExit("handoff app contains a synthetic E2E daemon setting")
PY
archs="$(lipo -archs "$binary")"
[[ " $archs " == *" arm64 "* && " $archs " == *" x86_64 "* ]] || {
  echo "handoff app is not universal: $archs" >&2
  exit 1
}
codesign --force --deep --sign - "$app"
codesign --verify --deep --strict "$app"
archive="$output_dir/OpenADE-macOS-universal.zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$archive"
unzip -tq "$archive"
echo "Built and verified $archive ($archs)"
