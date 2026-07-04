# =============================================================================
# build-release-win7.ps1 -- WIN7-ONLY release build (Electron 22).
#
#   npm run dist:win7-only        # full Win7 build (WASM + seed + docs + installers)
#   npm run dist:win7-only -- -SkipWasm
#
# Produces ONLY the legacy installers (no Win10/11 Electron-39 build):
#   dist\TFStudio-<ver>-Win7-Setup.exe        NSIS installer  (Win7 SP1 / 8 / 8.1)
#   dist\TFStudio-<ver>-Win7-Portable.exe     portable single-exe
#
# Electron 22 is the last line that runs on Windows < 10. Packaging is driven by
# build\electron-builder.win7.js (electronVersion override -> E22 binary fetched
# on first run). No source changes vs the main build: TFStudio has no native node
# modules and the WASM kernel is a prebuilt .wasm.
#
# For the COMBINED main + Win7 build, use build-release.ps1 (npm run dist, which
# asks; or npm run dist:win7 to force both). This script is Win7 ONLY.
#
# Flags (pass after the script, e.g. via npm run dist:win7-only -- -NoPause):
#   -SkipWasm   reuse the existing tmm_kernel.wasm artifact
#   -NoPause    do not wait for a keypress at the end (for CI / automation)
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads -File scripts as the
# system codepage, so non-ASCII bytes (em dashes, etc.) break string parsing.
# =============================================================================

param([switch]$SkipWasm, [switch]$NoPause)

$ErrorActionPreference = 'Stop'
$proj = $PSScriptRoot
Set-Location $proj

function Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }

# -----------------------------------------------------------------------------
# Run a long child command, streaming its output live AND printing a heartbeat
# during silent stretches (the electron-builder NSIS / LZMA compression and the
# one-time Electron 22 download emit no progress for minutes). Returns the child
# process exit code. (Same helper as build-release.ps1.)
# -----------------------------------------------------------------------------
function Invoke-WithProgress {
    param(
        [string]$Command,         # command line to run under cmd.exe, e.g. 'npm run build:win7'
        [string]$WatchDir,        # dir to watch for the growing archive
        [int]$HeartbeatSec = 12   # emit a heartbeat after this much silence
    )

    $outLog = Join-Path $env:TEMP ("tfs-build-{0}-out.log" -f $PID)
    $errLog = Join-Path $env:TEMP ("tfs-build-{0}-err.log" -f $PID)
    $ecFile = Join-Path $env:TEMP ("tfs-build-{0}-ec.txt"  -f $PID)
    Set-Content -Path $outLog -Value '' -Encoding Ascii
    Set-Content -Path $errLog -Value '' -Encoding Ascii
    if (Test-Path $ecFile) { Remove-Item $ecFile -Force }

    $inner = '{0} & echo !errorlevel!>"{1}"' -f $Command, $ecFile
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList @('/v:on', '/c', $inner) `
            -WorkingDirectory $proj -NoNewWindow -PassThru `
            -RedirectStandardOutput $outLog -RedirectStandardError $errLog

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
            Write-Host ("  ...still working ({0}s elapsed){1}" -f $el, $extra) -ForegroundColor DarkGray
        }
    }

    $p.WaitForExit()
    & $tail $outLog ([ref]$outPos) | Out-Null
    & $tail $errLog ([ref]$errPos) | Out-Null

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
    Write-Host "TFStudio WIN7-ONLY build (Electron 22)" -ForegroundColor Yellow

    $wasmPath = Join-Path $proj 'src\wasm\tmm_kernel.wasm'

    # --- 1. WASM TMM kernel --------------------------------------------------
    if ($SkipWasm) {
        Section "WASM kernel - SKIPPED (using existing artifact)"
    } else {
        Section "Building WASM TMM kernel"
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

    # --- 2. Seed + docs + renderer + Electron 22 packaging -------------------
    # `npm run build:win7` = npm run seed && npm run docs:build &&
    #   npm run build:renderer &&
    #   cross-env CSC_IDENTITY_AUTO_DISCOVERY=false TFS_LEGACY=1 \
    #     electron-builder --config build/electron-builder.win7.js
    # The first run downloads the Electron 22 binary (one time); the wrapper's
    # heartbeat fills the silence so it never looks hung.
    Section "Seeding, building docs, packaging Win7 installers (Electron 22)"
    Write-Host "  (first run downloads the Electron 22 binary - one time)" -ForegroundColor DarkGray
    $dist = Join-Path $proj 'dist'
    $buildExit = Invoke-WithProgress -Command 'npm run build:win7' -WatchDir $dist
    if ($buildExit -ne 0) { throw "Win7 build failed (exit $buildExit)." }

    # --- 3. Report -----------------------------------------------------------
    Section "Win7 build complete - artifacts in dist\"
    if (Test-Path $dist) {
        $win7 = Get-ChildItem $dist -Filter '*Win7*.exe' -ErrorAction SilentlyContinue |
                Sort-Object Length -Descending
        if ($win7) {
            $win7 | Format-Table Name, @{N='Size (MB)'; E={ '{0:N1}' -f ($_.Length / 1MB) }} -AutoSize | Out-Host
        } else {
            Write-Warning "No *Win7*.exe found in dist - packaging may have failed."
        }
    } else {
        Write-Warning "dist not found - packaging may have failed."
    }
}
catch {
    $exitCode = 1
    Write-Host ''
    Write-Host ("WIN7 BUILD FAILED: {0}" -f $_.Exception.Message) -ForegroundColor Red
    if ($_.ScriptStackTrace) { Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed }
}
finally {
    if (-not $NoPause) {
        Write-Host ''
        try { Read-Host 'Build finished - press Enter to close this window' | Out-Null } catch {}
    }
}

exit $exitCode
