#!/usr/bin/env bash
# Portable launcher for the tar.gz build.
#
# Chromium's setuid sandbox helper has to be owned by root with mode 4755. A tar.gz
# unpacked by a normal user can't satisfy that — the files end up owned by whoever
# extracted them — so chrome-sandbox is left misconfigured and Electron aborts on
# startup rather than running unsandboxed. Chromium would normally fall back to the
# user-namespace sandbox, but Ubuntu 24.04+ ships
# kernel.apparmor_restrict_unprivileged_userns=1, which blocks that too. The result
# is a hard crash before any of our code runs.
#
# Probe for a usable namespace sandbox the same way the AppImage's AppRun does, and
# only disable the sandbox when there is no working alternative. Anyone who has
# chowned chrome-sandbox to root:4755 (or installed the .deb, which does it for you)
# keeps a real sandbox.
set -e
HERE="$(dirname "$(readlink -f "$0")")"

for arg in "$@"; do
  if [ "$arg" = "--no-sandbox" ]; then
    exec "$HERE/tfstudio" "$@"
  fi
done

EXTRA=()
if ! unshare -Ur true 2>/dev/null; then
  if [ "$(stat -c '%u %a' "$HERE/chrome-sandbox" 2>/dev/null)" != "0 4755" ]; then
    EXTRA=(--no-sandbox)
  fi
fi

exec "$HERE/tfstudio" "${EXTRA[@]}" "$@"
