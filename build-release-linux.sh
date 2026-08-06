#!/usr/bin/env bash
# =============================================================================
# build-release-linux.sh -- TFStudio Linux release build.
#
# Runs on any Linux host, including WSL. From Windows, prefer:
#
#   npm run dist:linux        # drives this script through WSL
#
# Directly, from inside Linux:
#
#   ./build-release-linux.sh              build, then smoke-test the result
#   ./build-release-linux.sh --no-verify  build only
#
# Produces, in dist/ :
#   TFStudio-<ver>-amd64.deb        Debian/Ubuntu package; the recommended install.
#                                   Installing as root is the only way chrome-sandbox
#                                   gets its setuid bit (or an AppArmor profile), so
#                                   this is the one target that keeps the Chromium
#                                   sandbox enabled.
#   TFStudio-<ver>-x86_64.AppImage  single-file portable application
#   TFStudio-<ver>-x64.tar.gz       plain archive; needs no FUSE, so it works on
#                                   distributions that no longer ship libfuse2.
#                                   Launch it via tfstudio.sh, not the bare binary.
#
# Staging: when the source tree lives on a Windows drive (/mnt/...), the build
# is copied into the Linux filesystem first and the artifacts are copied back at
# the end. Two reasons. electron-builder is very slow across the 9p mount, and a
# Linux `npm install` in place would replace the Windows node_modules with Linux
# binaries, breaking the Windows build. Override the staging directory with
# TFS_LINUX_BUILD_DIR.
#
# Requirements: Node.js 18+ and npm. The smoke test additionally needs Xvfb and
# the Electron runtime libraries; without them it is skipped, not failed:
#
#   sudo apt-get install -y xvfb libgtk-3-0t64 libnss3 libasound2t64
#
# (On Ubuntu 22.04 and older these are named libgtk-3-0 and libasound2; the t64
# suffix arrived with the 64-bit time_t transition in 24.04.)
# =============================================================================
set -euo pipefail

VERIFY=1
for arg in "$@"; do
    case "$arg" in
        --no-verify) VERIFY=0 ;;
        *) ;;
    esac
done

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

section() { printf '\n=== %s ===\n' "$1"; }
have()    { command -v "$1" >/dev/null 2>&1; }

# --- 0. Preflight: node and npm ----------------------------------------------
section "Preflight: required tools"

# WSL appends the Windows PATH to the Linux one, so `node` and `npm` can resolve
# to C:\Program Files\nodejs. Those are Windows executables and cannot build a
# Linux package, so anything found under /mnt is not treated as installed.
is_native() {
    case "$(command -v "$1" 2>/dev/null)" in
        '' | /mnt/*) return 1 ;;
        *)           return 0 ;;
    esac
}

if ! is_native node; then
    # nvm keeps this self-contained: no sudo, no system package manager.
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
        # shellcheck disable=SC1091
        . "$HOME/.nvm/nvm.sh"
    fi
fi

if ! is_native node || ! is_native npm; then
    cat >&2 <<'EOF'
Node.js is not available in this Linux environment.

(A Windows node or npm on the PATH, under /mnt, does not count: it cannot
produce Linux binaries.)

Install it with either:

  sudo apt-get update && sudo apt-get install -y nodejs npm

or, without root:

  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  exec "$SHELL" -l
  nvm install --lts

then re-run this script.
EOF
    exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
    echo "Node.js 18 or newer is required (found $(node -v))." >&2
    exit 1
fi
echo "node $(node -v) / npm $(npm -v)"

if ! have rsync; then
    echo "rsync is not installed. Install it with: sudo apt-get install -y rsync" >&2
    exit 1
fi

# --- 1. Stage the source into the Linux filesystem ---------------------------
case "$SRC" in
    /mnt/*)
        STAGE="${TFS_LINUX_BUILD_DIR:-$HOME/.cache/tfstudio-linux-build}"
        section "Staging source into the Linux filesystem"
        echo "  from $SRC"
        echo "  to   $STAGE"
        mkdir -p "$STAGE"
        rsync -a --delete \
            --exclude '.git/' \
            --exclude 'node_modules/' \
            --exclude 'docs-site/node_modules/' \
            --exclude 'docs-site/dist/' \
            --exclude 'dist/' \
            --exclude 'refractiveindex-db/' \
            "$SRC/" "$STAGE/"
        # The RII database is large and read-only for the build, so it is read
        # straight from the Windows mount instead of being copied.
        if [ -d "$SRC/refractiveindex-db/database" ]; then
            export TFS_RII_SOURCE="$SRC/refractiveindex-db/database"
            echo "RII offline mirror: $TFS_RII_SOURCE"
        else
            echo "RII database not checked out; the committed seed will be used."
        fi
        ;;
    *)
        STAGE="$SRC"
        section "Building in place (already on a Linux filesystem)"
        if [ -d "$SRC/refractiveindex-db/database" ]; then
            export TFS_RII_SOURCE="$SRC/refractiveindex-db/database"
        elif [ -d "$SRC/.git" ] && [ -f "$SRC/.gitmodules" ] && have git; then
            section "Provisioning: refractiveindex.info database (submodule)"
            git -C "$SRC" submodule update --init --recursive \
                || echo "Submodule checkout failed; falling back to the committed seed."
            [ -d "$SRC/refractiveindex-db/database" ] \
                && export TFS_RII_SOURCE="$SRC/refractiveindex-db/database"
        fi
        ;;
esac

cd "$STAGE"

# --- 2. Dependencies ---------------------------------------------------------
section "Provisioning: npm dependencies"
if [ -d node_modules/electron-builder ] && [ -d node_modules/esbuild ] \
   && [ -d node_modules/tmmcore ] && [ -d node_modules/cross-env ]; then
    echo "Root dependencies present."
else
    npm install
fi

section "Provisioning: docs-site dependencies"
if [ -d docs-site/node_modules/astro ]; then
    echo "docs-site dependencies present."
else
    npm --prefix docs-site install
fi

# --- 3. Verify the tmmcore WASM artifact -------------------------------------
section "Verifying tmmcore WASM kernel"
WASM="$(node -p "require.resolve('tmmcore/tmm_kernel.wasm')")"
[ -f "$WASM" ] || { echo "tmmcore/tmm_kernel.wasm could not be resolved." >&2; exit 1; }
printf 'tmmcore WASM kernel present: %s bytes\n' "$(stat -c %s "$WASM")"

# --- 4. Package --------------------------------------------------------------
section "Seeding materials, building docs site, packaging Linux artifacts"
npm run build:linux

# --- 5. Smoke test -----------------------------------------------------------
# The unpacked build is tested rather than the AppImage: running an AppImage
# needs FUSE, which WSL does not provide by default, and the unpacked tree
# exercises the same binary, asar and resource layout.
if [ "$VERIFY" -eq 1 ]; then
    section "Smoke test: launching the unpacked build under Xvfb"
    # The application binary is named after the package, not productName. It
    # cannot be found by scanning for the executable bit alone: the bundled
    # shared libraries and the Chromium helpers carry it too.
    APP_EXE="$(node -p 'const p=require("./package.json"); (p.build.linux && p.build.linux.executableName) || p.name' 2>/dev/null || true)"
    if [ -n "$APP_EXE" ] && [ -x "$STAGE/dist/linux-unpacked/$APP_EXE" ]; then
        BIN="$STAGE/dist/linux-unpacked/$APP_EXE"
    else
        BIN="$(find "$STAGE/dist/linux-unpacked" -maxdepth 1 -type f -executable \
                    ! -name '*.so' ! -name '*.so.*' \
                    ! -name 'chrome-sandbox' ! -name 'chrome_crashpad_handler' \
                    2>/dev/null | head -n 1 || true)"
    fi
    if [ -z "$BIN" ]; then
        echo "No executable found in dist/linux-unpacked; skipping." >&2
    elif ! have xvfb-run; then
        echo "Xvfb is not installed, so the smoke test was skipped. To enable it:"
        echo "  sudo apt-get install -y xvfb libgtk-3-0t64 libnss3 libasound2t64"
    else
        LOG="$(mktemp)"
        set +e
        # --no-sandbox: the Chromium sandbox needs user namespaces, which are
        # unavailable in many container and WSL configurations.
        timeout --signal=TERM 25 xvfb-run -a "$BIN" --no-sandbox >"$LOG" 2>&1
        RC=$?
        set -e
        if [ "$RC" -eq 124 ]; then
            # Still running when the timeout fired: it started and stayed up.
            echo "PASS: the application started and ran for 25s without exiting."
        else
            echo "FAIL: the application exited on its own (code $RC)." >&2
            echo "--- output ---" >&2
            cat "$LOG" >&2
            rm -f "$LOG"
            exit 1
        fi
        rm -f "$LOG"
    fi
fi

# --- 6. Copy artifacts back, and report --------------------------------------
if [ "$STAGE" != "$SRC" ]; then
    section "Copying artifacts back to $SRC/dist"
    mkdir -p "$SRC/dist"
    find "$STAGE/dist" -maxdepth 1 -type f \
        \( -name '*.AppImage' -o -name '*.tar.gz' -o -name '*.deb' \) \
        -exec cp -f {} "$SRC/dist/" \;
fi

section "Build complete - artifacts in dist/"
find "$SRC/dist" -maxdepth 1 -type f \
    \( -name '*.AppImage' -o -name '*.tar.gz' -o -name '*.deb' \) \
    -printf '%f\t%s\n' 2>/dev/null \
    | awk -F'\t' '{ printf "%-44s %8.1f MB\n", $1, $2/1048576 }'
