# =============================================================================
# build-release.ps1 -- ONE-COMMAND TFStudio release build.
#
#   npm run dist        # full build (WASM + materials + docs + installers)
#   npm run dist:fast   # reuse the existing tmm_kernel.wasm artifact
#
# Flags (pass after the script, e.g. via npm run dist -- -NoPause):
#   -SkipWasm   reuse the existing tmm_kernel.wasm artifact
#   -NoPause    do not wait for a keypress at the end (for CI / automation)
#   -Win7       also build the Windows 7/8.1 legacy installers (Electron 22).
#               Without this flag, an interactive run ASKS whether to build them;
#               an unattended run (-NoPause) skips them unless -Win7 is given.
#
# Produces, in dist\ :
#   TFStudio Setup <ver>.exe          NSIS installer (Win10/11, Electron 39)
#   TFStudio-<ver>-Portable.exe       portable single-exe (for locked-down fab PCs)
#   TFStudio-<ver>-Win7-Setup.exe     legacy installer (Win7 SP1/8/8.1, Electron 22)*
#   TFStudio-<ver>-Win7-Portable.exe  legacy portable*                              *
#     * only when -Win7 is passed or confirmed at the prompt
#
# What it bundles (handled by package.json `build` config + extraResources):
#   - the offline material seed: Schott AGF, coating/substrate catalogs, and the
#     RefractiveIndex.info offline mirror  (npm run seed -> build\seed\)
#   - the offline help site                (npm run docs:build -> docs-site\dist\)
#   - the WASM TMM kernel                  (this script -> src\wasm\tmm_kernel.wasm)
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads -File scripts as the
# system codepage, so non-ASCII bytes (em dashes, etc.) break string parsing.
# =============================================================================

param([switch]$SkipWasm, [switch]$NoPause, [switch]$Win7)

$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
Set-Location $proj

function Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# -----------------------------------------------------------------------------
# Decide UP FRONT whether to also build the Windows 7/8.1 legacy installers
# (Electron 22), so the user can answer once and walk away rather than babysit
# the multi-minute main build for a prompt at the end.
#   -Win7     -> yes, no prompt
#   -NoPause  -> unattended; skip unless -Win7 is also given
#   neither   -> ask interactively (default No)
# The actual legacy packaging happens later, at step 2b.
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
# Run a long child command, streaming its output live AND printing a heartbeat
# during silent stretches (the electron-builder NSIS / LZMA compression emits no
# progress for minutes). The heartbeat reports elapsed time and the size of the
# installer payload archive as it grows, so the build never *looks* hung.
# Returns the child process exit code.
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
    # --- 0. Dependency preflight ---------------------------------------------
    # Ensure node_modules is present and complete up front: if it's missing, or a
    # key build-only dep isn't there, run `npm install` once. (npm is a no-op when
    # everything is current.)
    Section "Checking build dependencies"
    $needInstall = $false
    if (-not (Test-Path (Join-Path $proj 'node_modules'))) {
        Write-Host "node_modules missing -> installing." -ForegroundColor Yellow
        $needInstall = $true
    } else {
        foreach ($dep in @('electron-builder', 'esbuild')) {
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
        Write-Host "All build dependencies present." -ForegroundColor Green
    }

    $wasmPath = Join-Path $proj 'src\wasm\tmm_kernel.wasm'

    # --- 1. WASM TMM kernel --------------------------------------------------
    if ($SkipWasm) {
        Section "WASM kernel - SKIPPED (using existing artifact)"
    } else {
        Section "Building WASM TMM kernel"
        # Run the dedicated build in a child process so its `exit` can't abort us.
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $proj 'src\wasm\build.ps1')
        $wasmExit = $LASTEXITCODE
        if ($wasmExit -ne 0) {
            if (Test-Path $wasmPath) {
                Write-Warning "WASM build failed (emsdk missing?). Reusing existing tmm_kernel.wasm."
            } else {
                Write-Warning "WASM build failed and no prebuilt artifact exists."
                Write-Warning "The app will still run, falling back to the (slower) pure-JS TMM."
            }
        }
    }

    if (Test-Path $wasmPath) {
        Write-Host ("WASM kernel present: {0:N0} bytes" -f (Get-Item $wasmPath).Length) -ForegroundColor Green
    } else {
        Write-Warning "No WASM kernel will be bundled (JS-TMM fallback at runtime)."
    }

    # --- 2. Materials seed + docs site + package (npm run build) --------------
    # package.json `build` = npm run seed && npm run docs:build &&
    #                        npm run build:renderer && electron-builder
    # The electron-builder NSIS / LZMA stage is silent for minutes, so run the
    # whole chain through the progress wrapper (heartbeat fills the silence).
    Section "Seeding materials, building docs site, packaging installers"
    $dist = Join-Path $proj 'dist'
    $buildExit = Invoke-WithProgress -Command 'npm run build' -WatchDir $dist
    if ($buildExit -ne 0) { throw "npm run build failed (exit $buildExit)." }

    # --- 2b. Windows 7 / 8.1 legacy installers (Electron 22) ------------------
    # Electron 39 (the main build above) requires Windows 10+. For labs whose PCs
    # still run Windows 7 (e.g. older lab PCs), produce a SEPARATE pair of
    # installers packaged against Electron 22 -- the last line that runs on Win7
    # SP1/8/8.1. Only the electron-builder step is rerun here: the seed, docs and
    # renderer built in step 2 are reused as-is (no source differences).
    # ($doWin7 was decided up front, before the main build.)
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

    # --- 3. Report -----------------------------------------------------------
    Section "Build complete - artifacts in dist\"
    if (Test-Path $dist) {
        Get-ChildItem $dist -Filter *.exe |
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
