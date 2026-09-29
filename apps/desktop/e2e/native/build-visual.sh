#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
fixture=native_visual_e2e_darwin.m
if [ -e "$fixture" ]; then
 printf '%s\n' "Refusing to replace an existing $fixture" >&2
 exit 1
fi
trap 'rm -f native_visual_e2e_darwin.m' EXIT HUP INT TERM
cp e2e/native/backdrop.m "$fixture"
npm run build
"${WAILS_BIN:-wails}" build -m -skipbindings -s
