# =============================================================================
# build-release.ps1 -- ONE-CLICK TFStudio release build.
#
# Clone the repo and run this. It provisions EVERYTHING a fresh checkout needs,
# then packages the installers. No elevation / admin rights required.
#
#   npm run dist              # full build (dependencies + materials + docs + installers)
#
# What it auto-provisions on a fresh clone (each step is a no-op if already done):
#   - the refractiveindex.info database  (git submodule -> refractiveindex-db\database)
#   - root npm dependencies              (npm install)
#   - the docs-site dependencies         (npm --prefix docs-site install)
#   - tmmcore, including its prebuilt WASM kernel (root npm dependency)
#
# Flags (pass after the script, e.g. npm run dist -- -NoPause):
#   -NoPause      do not wait for a keypress at the end (CI / automation)
#   -Win7         also build the Windows 7/8.1 legacy installers (Electron 22).
#                 Without it, an interactive run ASKS; an unattended run
#                 (-NoPause) skips them unless -Win7 is given.
#   -Linux        also build the Linux artifacts, through WSL. Same prompt rules
#                 as -Win7. Requires a WSL distribution with Node.js 18+.
#   -CleanCache   wipe electron-builder's winCodeSign cache before building
#                 (opt-in recovery only; NOT done by default -- see note below).
#
# Produces, in dist\ :
#   TFStudio Setup <ver>.exe          NSIS installer (Win10/11, Electron 39)
#   TFStudio-<ver>-Portable.exe       portable single-exe (for locked-down fab PCs)
#   TFStudio-<ver>-Win7-Setup.exe     legacy installer (Win7 SP1/8/8.1, Electron 22)*
#   TFStudio-<ver>-Win7-Portable.exe  legacy portable*
#   TFStudio-<ver>-x86_64.AppImage    Linux single-file application**
#   TFStudio-<ver>-x64.tar.gz         Linux archive, needs no FUSE**
#     * only when -Win7 is passed or confirmed at the prompt
#    ** only when -Linux is passed or confirmed at the prompt
#
# The app is intentionally UNSIGNED: no certificate is configured, and
# CSC_IDENTITY_AUTO_DISCOVERY=false (set by npm run build) disables auto-signing.
# electron-builder still downloads its winCodeSign package on Windows because
# signtool ships inside it; that package is extracted ONCE into
# %LOCALAPPDATA%\electron-builder\Cache and reused. This script no longer deletes
# that cache, which is what previously forced a UAC/admin relaunch (the cached
# darwin symlinks only need SeCreateSymbolicLinkPrivilege at extraction time).
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads -File scripts as the
# system codepage, so non-ASCII bytes (em dashes, etc.) break string parsing.
# =============================================================================

param(
    [switch]$NoPause,
    [switch]$Win7,
    [switch]$Linux,
    [switch]$CleanCache
)

$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
Set-Location $proj

function Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Have-Cmd([string]$name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# -----------------------------------------------------------------------------
# Decide UP FRONT whether to also build the Windows 7/8.1 legacy installers
# (Electron 22), so the user can answer once and walk away.
#   -Win7     -> yes, no prompt
#   -NoPause  -> unattended; skip unless -Win7 is also given
#   neither   -> ask interactively (default No)
# The actual legacy packaging happens later, at step 5.
# -----------------------------------------------------------------------------
$doWin7 = $false
if ($Win7) {
    $doWin7 = $true
} elseif (-not $NoPause) {
    $ans = Read-Host 'Also build the Windows 7 / 8.1 legacy version (Electron 22)? [y/N]'
    if ($ans -match '^\s*(y|yes)\s*$') { $doWin7 = $true }
}
if ($doWin7) {
    Write-Host 'Windows 7 legacy installers WILL be built after the main build.' -ForegroundColor Green
} else {
    Write-Host 'Windows 7 legacy installers will be skipped.' -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Same decision, for the Linux artifacts. They are produced by WSL running
# build-release-linux.sh; the actual packaging happens at step 5c.
# -----------------------------------------------------------------------------
$doLinux = $false
if ($Linux) {
    $doLinux = $true
} elseif (-not $NoPause) {
    $ans = Read-Host 'Also build the Linux version (AppImage + tar.gz, via WSL)? [y/N]'
    if ($ans -match '^\s*(y|yes)\s*$') { $doLinux = $true }
}
if ($doLinux) {
    Write-Host 'Linux artifacts WILL be built after the main build.' -ForegroundColor Green
} else {
    Write-Host 'Linux artifacts will be skipped.' -ForegroundColor DarkGray
}

# -----------------------------------------------------------------------------
# Run a long child command, streaming its output live AND printing a heartbeat
# during silent stretches (electron-builder's NSIS / LZMA compression emits no
# progress for minutes). Returns the child process exit code.
# -----------------------------------------------------------------------------
function Invoke-WithProgress {
    param(
        [string]$Command,         # command line to run under cmd.exe, e.g. 'npm run build'
        [string]$WatchDir,        # dir to watch for the growing archive
        [int]$HeartbeatSec = 12   # emit a heartbeat after this much silence
    )

    $outLog = Join-Path $env:TEMP ("tfs-build-{0}-out.log" -f $PID)
    $errLog = Join-Path $env:TEMP ("tfs-build-{0}-err.log" -f $PID)
    $ecFile = Join-Path $env:TEMP ("tfs-build-{0}-ec.txt"  -f $PID)
    Set-Content -Path $outLog -Value '' -Encoding Ascii
    Set-Content -Path $errLog -Value '' -Encoding Ascii
    if (Test-Path $ecFile) { Remove-Item $ecFile -Force }

    # Run under cmd with delayed expansion so we can capture the REAL exit code of
    # $Command into a sentinel file. (Start-Process -PassThru does NOT reliably
    # populate .ExitCode, so we must not trust it.) stdout/stderr are redirected
    # to log files we tail below for live output + a silence heartbeat.
    $inner = '{0} & echo !errorlevel!>"{1}"' -f $Command, $ecFile
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/v:on', '/c', $inner) `
            -WorkingDirectory $proj -NoNewWindow -PassThru `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog

    # Tail helper: read whatever was appended to $path since [ref]$pos.
    $tail = {
        param($path, [ref]$pos)
        $printed = $false
        if (Test-Path $path) {
            $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open,
                  [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
            try {
                if ($fs.Length -gt $pos.Value) {
                    $fs.Position = $pos.Value
                    $sr = New-Object System.IO.StreamReader($fs)
                    $txt = $sr.ReadToEnd()
                    $pos.Value = $fs.Position
                    if ($txt.Length -gt 0) { Write-Host $txt -NoNewline; $printed = $true }
                }
            } finally { $fs.Dispose() }
        }
        return $printed
    }

    $outPos = 0; $errPos = 0
    $t0 = Get-Date
    $lastOutput = Get-Date

    while (-not $p.HasExited) {
        Start-Sleep -Milliseconds 400
        $a = & $tail $outLog ([ref]$outPos)
        $b = & $tail $errLog ([ref]$errPos)
        if ($a -or $b) {
            $lastOutput = Get-Date
        } elseif (((Get-Date) - $lastOutput).TotalSeconds -ge $HeartbeatSec) {
            $lastOutput = Get-Date
            $el = [int]((Get-Date) - $t0).TotalSeconds
            $extra = ''
            $arc = Get-ChildItem $WatchDir -Filter '*.nsis.7z' -ErrorAction SilentlyContinue |
                   Sort-Object Length -Descending | Select-Object -First 1
            if ($arc) { $extra = ' - compressing installer payload: {0:N1} MB' -f ($arc.Length / 1MB) }
            Write-Host ("  ...still packaging ({0}s elapsed){1}" -f $el, $extra) -ForegroundColor DarkGray
        }
    }

    # Final flush of anything written between the last poll and exit.
    $p.WaitForExit()
    & $tail $outLog ([ref]$outPos) | Out-Null
    & $tail $errLog ([ref]$errPos) | Out-Null

    # Read the real exit code from the sentinel (default to failure if absent).
    $code = 1
    if (Test-Path $ecFile) {
        $raw = (Get-Content $ecFile -Raw)
        if ($raw) { $n = 0; if ([int]::TryParse($raw.Trim(), [ref]$n)) { $code = $n } }
    }
    Remove-Item $outLog, $errLog, $ecFile -Force -ErrorAction SilentlyContinue
    return $code
}

$exitCode = 0
try {
    # --- 0. Preflight: required tools ----------------------------------------
    Section "Preflight: required tools"
    foreach ($t in @('node', 'npm')) {
        if (-not (Have-Cmd $t)) {
            throw "$t is not on PATH. Install Node.js 18+ from https://nodejs.org and re-run."
        }
    }
    Write-Host ("node {0} / npm {1}" -f (& node -v), (& npm -v)) -ForegroundColor Green

    # electron-builder resolves `powershell.exe` from PATH alone (it spawns it
    # directly, with no shell, to wrap package-manager calls). A PATH missing the
    # Windows PowerShell directory -- which happens when another tool rewrites it,
    # e.g. an emsdk activation -- fails packaging late with "spawn powershell.exe
    # ENOENT", long after the seed and docs have been built. Restore it up front.
    if (-not (Have-Cmd 'powershell')) {
        $wpsDir = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0'
        if (-not (Test-Path -LiteralPath (Join-Path $wpsDir 'powershell.exe'))) {
            throw "powershell.exe is not on PATH and is not in $wpsDir. electron-builder cannot package without it."
        }
        $env:PATH = "$env:PATH;$wpsDir"
        Write-Host "Added $wpsDir to PATH (electron-builder needs powershell.exe)." -ForegroundColor Yellow
    }

    $haveGit = Have-Cmd 'git'
    if (-not $haveGit) {
        Write-Warning "git not found on PATH. The RII submodule and emsdk auto-install cannot run; the committed seed and prebuilt WASM will be used instead."
    }

    # Check the WSL side NOW rather than after a ten-minute Windows build. A
    # failure here disables the Linux step but lets the Windows build finish.
    $linuxSkipReason = ''
    if ($doLinux) {
        if (-not (Have-Cmd 'wsl')) {
            $linuxSkipReason = 'wsl.exe is not on PATH. Install WSL with: wsl --install -d Ubuntu'
        } else {
            & wsl.exe -e true | Out-Null
            if ($LASTEXITCODE -ne 0) {
                $linuxSkipReason = 'WSL has no installed distribution. Install one with: wsl --install -d Ubuntu'
            } else {
                # A Windows node on the PATH (WSL exposes it under /mnt) cannot
                # build Linux binaries, so it must not satisfy this check.
                & wsl.exe -e bash -lc 'command -v node | grep -qv ^/mnt/ && command -v rsync >/dev/null 2>&1' | Out-Null
                if ($LASTEXITCODE -ne 0) {
                    $linuxSkipReason = 'The WSL distribution is missing a Linux node and/or rsync. Install them with: wsl -e sudo apt-get update, then wsl -e sudo apt-get install -y nodejs npm rsync'
                }
            }
        }
        if ($linuxSkipReason) {
            $doLinux = $false
            Write-Warning "Linux build disabled: $linuxSkipReason"
        } else {
            Write-Host ("WSL ready: {0}" -f (& wsl.exe -e bash -lc 'node -v')) -ForegroundColor Green
        }
    }

    # --- 1. RII database submodule -------------------------------------------
    # Registered in .gitmodules at refractiveindex-db\database. A plain clone
    # (without --recursive) leaves it empty, so check it out here. No-op outside
    # a git working copy (e.g. a source tarball), where the committed seed is used.
    Section "Provisioning: refractiveindex.info database (submodule)"
    $riiRepoPath = Join-Path $proj 'refractiveindex-db\database'
    $riiPresent = (Test-Path $riiRepoPath) -and `
                  ((Get-ChildItem $riiRepoPath -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0)
    if ($riiPresent) {
        Write-Host "RII database already checked out." -ForegroundColor Green
    } elseif ($haveGit -and (Test-Path (Join-Path $proj '.git')) -and (Test-Path (Join-Path $proj '.gitmodules'))) {
        Write-Host "Checking out refractiveindex-db submodule (large, one-time download)..." -ForegroundColor Yellow
        & git submodule update --init --recursive
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "git submodule update failed. RII mirror will fall back to the committed seed."
        } else {
            $riiPresent = Test-Path $riiRepoPath
        }
    } else {
        Write-Warning "Cannot check out RII submodule (not a git working copy, or git missing). Using committed seed."
    }
    # Point the seed generator at the in-repo mirror when it is present.
    if (Test-Path $riiRepoPath) {
        $env:TFS_RII_SOURCE = $riiRepoPath
        Write-Host "RII offline mirror: $riiRepoPath" -ForegroundColor Green
    }

    # --- 2. Root npm dependencies --------------------------------------------
    Section "Provisioning: root npm dependencies"
    $needInstall = $false
    if (-not (Test-Path (Join-Path $proj 'node_modules'))) {
        Write-Host "node_modules missing -> installing." -ForegroundColor Yellow
        $needInstall = $true
    } else {
        foreach ($dep in @('electron-builder', 'esbuild', 'cross-env', 'tmmcore')) {
            if (-not (Test-Path (Join-Path $proj "node_modules\$dep"))) {
                Write-Host "Dependency '$dep' missing -> running npm install." -ForegroundColor Yellow
                $needInstall = $true
            }
        }
    }
    if ($needInstall) {
        & npm install
        if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit $LASTEXITCODE)." }
    } else {
        Write-Host "Root dependencies present." -ForegroundColor Green
    }

    # --- 3. docs-site dependencies -------------------------------------------
    # The docs site is a nested npm package (Astro); the root install does not
    # touch it. Its build needs the local astro binary.
    Section "Provisioning: docs-site dependencies"
    if (Test-Path (Join-Path $proj 'docs-site\node_modules\astro')) {
        Write-Host "docs-site dependencies present." -ForegroundColor Green
    } else {
        Write-Host "Installing docs-site dependencies (astro)..." -ForegroundColor Yellow
        & npm --prefix docs-site install
        if ($LASTEXITCODE -ne 0) { throw "docs-site npm install failed (exit $LASTEXITCODE)." }
    }

    # --- 4. Verify the tmmcore WASM artifact ---------------------------------
    Section "Verifying tmmcore WASM kernel"
    $wasmPath = (& node -p "require.resolve('tmmcore/tmm_kernel.wasm')").Trim()
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $wasmPath)) {
        throw 'tmmcore/tmm_kernel.wasm could not be resolved after npm install.'
    }
    Write-Host ("tmmcore WASM kernel present: {0:N0} bytes" -f (Get-Item -LiteralPath $wasmPath).Length) -ForegroundColor Green

    # --- 5. Package: seed + docs + renderer + installers (npm run build) ------
    # Optional cache wipe is OPT-IN only (-CleanCache). Wiping it forces a
    # re-extraction of winCodeSign, whose darwin symlinks need elevation -- which
    # is exactly what we are avoiding, so it stays off by default.
    if ($CleanCache) {
        $winCodeSignCache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
        if (Test-Path $winCodeSignCache) {
            Write-Host "Clearing winCodeSign cache (-CleanCache)..." -ForegroundColor Yellow
            Remove-Item $winCodeSignCache -Recurse -Force -ErrorAction SilentlyContinue
        }
    }

    Section "Seeding materials, building docs site, packaging installers"
    $dist = Join-Path $proj 'dist'
    $buildExit = Invoke-WithProgress -Command 'npm run build' -WatchDir $dist
    if ($buildExit -ne 0) { throw "npm run build failed (exit $buildExit)." }

    # --- 5b. Windows 7 / 8.1 legacy installers (Electron 22) -----------------
    # Electron 39 (the main build) needs Windows 10+. Produce a SEPARATE pair of
    # installers packaged against Electron 22 for older lab PCs. The seed, docs,
    # and renderer from step 5 are reused as-is (no source differences).
    if ($doWin7) {
        Section "Building Windows 7 legacy installers (Electron 22)"
        Write-Host "  (first run downloads the Electron 22 binary - one time)" -ForegroundColor DarkGray
        $env:TFS_LEGACY = '1'
        $env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
        try {
            $win7Exit = Invoke-WithProgress `
                -Command 'npx electron-builder --config build/electron-builder.win7.js' `
                -WatchDir $dist
        } finally {
            Remove-Item Env:\TFS_LEGACY -ErrorAction SilentlyContinue
        }
        if ($win7Exit -ne 0) { throw "Windows 7 legacy build failed (exit $win7Exit)." }
        Write-Host "Windows 7 legacy installers built." -ForegroundColor Green
    } else {
        Section "Windows 7 legacy build - SKIPPED"
    }

    # --- 5c. Linux artifacts (AppImage + tar.gz, via WSL) --------------------
    # build-release-linux.sh stages the tree into the WSL filesystem, builds
    # there, smoke-tests the unpacked app under Xvfb, and copies the artifacts
    # back into dist\. See that script for why it does not build in place.
    if ($doLinux) {
        Section "Building Linux artifacts (WSL)"
        Write-Host "  (first run installs Linux node_modules and downloads Electron - one time)" -ForegroundColor DarkGray
        $drive   = $proj.Substring(0, 1).ToLower()
        $tail    = $proj.Substring(2) -replace '\\', '/'
        $wslProj = "/mnt/$drive$tail"
        & wsl.exe -e bash -lc "cd '$wslProj' && bash ./build-release-linux.sh"
        if ($LASTEXITCODE -ne 0) { throw "Linux build failed (exit $LASTEXITCODE)." }
        Write-Host "Linux artifacts built." -ForegroundColor Green
    } else {
        Section "Linux build - SKIPPED"
        if ($linuxSkipReason) { Write-Host "  $linuxSkipReason" -ForegroundColor Yellow }
    }

    # --- 6. Report -----------------------------------------------------------
    Section "Build complete - artifacts in dist\"
    if (Test-Path $dist) {
        Get-ChildItem $dist -File |
            Where-Object { $_.Extension -in @('.exe', '.AppImage') -or $_.Name -like '*.tar.gz' } |
            Sort-Object Length -Descending |
            Format-Table Name, @{N='Size (MB)'; E={ '{0:N1}' -f ($_.Length / 1MB) }} -AutoSize | Out-Host
    } else {
        Write-Warning "dist not found - packaging may have failed."
    }
}
catch {
    $exitCode = 1
    Write-Host ''
    Write-Host ("BUILD FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed }
}
finally {
    # Keep the console open so the result (or error) stays visible. Pass
    # -NoPause for unattended / CI runs.
    if (-not $NoPause) {
        Write-Host ''
        try { Read-Host 'Build finished - press Enter to close this window' | Out-Null } catch {}
    }
}

exit $exitCode
