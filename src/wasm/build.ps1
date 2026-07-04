# Build the TFStudio TMM WASM kernel with Emscripten (Windows / PowerShell).
#
# Usage:
#   npm run build:wasm            # build the kernel (auto-finds emsdk)
#   .\src\wasm\build.ps1          # same, directly
#   .\src\wasm\build.ps1 -InstallEmsdk   # clone+install emsdk first if missing
#
# emcc discovery order (first hit wins):
#   1. emcc already on PATH
#   2. $env:EMSDK
#   3. a list of common install locations (any drive) -- see $candidates below
#   4. with -InstallEmsdk (or $env:TFS_INSTALL_EMSDK=1): git-clone + install emsdk
#      into %USERPROFILE%\emsdk, then activate it
#
# One-time manual install (if you prefer): https://emscripten.org/docs/getting_started/downloads.html
#   git clone https://github.com/emscripten-core/emsdk
#   cd emsdk; .\emsdk install latest; .\emsdk activate latest
# Then either add it to PATH, set $env:EMSDK to that folder, or just put it in one
# of the searched locations below and re-run -- no path is hardcoded anymore.
#
# NOTE: keep this file ASCII-only. PowerShell 5.1 reads -File scripts as the
# system codepage, so non-ASCII bytes (em dashes, etc.) break string parsing.

param([switch]$InstallEmsdk)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $root

# --- Try to activate emsdk from a known root (returns $true if emcc appears) ---
function Activate-Emsdk([string]$emsdkRoot) {
    if (-not $emsdkRoot) { return $false }
    if (-not (Test-Path $emsdkRoot)) { return $false }
    $envScript = Join-Path $emsdkRoot 'emsdk_env.ps1'
    if (-not (Test-Path $envScript)) { return $false }
    Write-Host "Activating emsdk from $emsdkRoot ..."
    try { & $envScript | Out-Null } catch { }
    return [bool](Get-Command emcc -ErrorAction SilentlyContinue)
}

# --- Ensure emcc is available --------------------------------------------------
if (-not (Get-Command emcc -ErrorAction SilentlyContinue)) {

    # Candidate emsdk roots, in priority order. NONE is hardcoded as the only
    # option: we search every common spot across drives so a build on a fresh PC
    # finds an existing install wherever it was put. Add your own via $env:EMSDK.
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:EMSDK) { [void]$candidates.Add($env:EMSDK) }
    foreach ($p in @(
        (Join-Path $env:USERPROFILE 'emsdk'),
        (Join-Path $root '..\emsdk'),
        (Join-Path $root '..\..\emsdk'),
        'C:\emsdk', 'D:\emsdk', 'X:\emsdk',
        (Join-Path $env:LOCALAPPDATA 'emsdk'),
        (Join-Path ${env:ProgramFiles} 'emsdk')
    )) { if ($p) { [void]$candidates.Add($p) } }

    $activated = $false
    foreach ($c in $candidates) {
        if (Activate-Emsdk $c) { $activated = $true; break }
    }

    # Optional one-shot install (flag or env). Clones into %USERPROFILE%\emsdk.
    if (-not $activated -and ($InstallEmsdk -or $env:TFS_INSTALL_EMSDK -eq '1')) {
        $target = Join-Path $env:USERPROFILE 'emsdk'
        if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
            Write-Error "Cannot auto-install emsdk: git is not on PATH. Install Git, or install emsdk manually."
            exit 1
        }
        if (-not (Test-Path $target)) {
            Write-Host "Cloning emsdk into $target ..." -ForegroundColor Cyan
            & git clone --depth 1 https://github.com/emscripten-core/emsdk "$target"
            if ($LASTEXITCODE -ne 0) { Write-Error "git clone of emsdk failed."; exit 1 }
        }
        Write-Host "Installing + activating emsdk 'latest' (one-time, downloads the toolchain) ..." -ForegroundColor Cyan
        & (Join-Path $target 'emsdk.bat') install latest
        if ($LASTEXITCODE -ne 0) { Write-Error "emsdk install failed."; exit 1 }
        & (Join-Path $target 'emsdk.bat') activate latest
        if ($LASTEXITCODE -ne 0) { Write-Error "emsdk activate failed."; exit 1 }
        $activated = Activate-Emsdk $target
    }

    if (-not $activated) {
        Write-Error @"
emcc (Emscripten) not found. The WASM TMM kernel needs it to (re)build.

A prebuilt src/wasm/tmm_kernel.wasm is committed to the repo, so the desktop
build (npm run dist) will STILL succeed without emcc -- it just reuses that
artifact. Only run this when you actually changed tmm_kernel.c.

To build the kernel here, do ONE of:
  * install emsdk and re-run with auto-detect:
        .\src\wasm\build.ps1 -InstallEmsdk        (clones into %USERPROFILE%\emsdk)
  * or install it yourself, then point at it:
        `$env:EMSDK = 'C:\path\to\emsdk'; npm run build:wasm
  * or just put the emsdk folder in one of: %USERPROFILE%\emsdk, C:\emsdk,
    a sibling of the project, etc. (searched automatically).

Searched: $($candidates -join '; ')
"@
        exit 1
    }
}

# Each emcc flag is a quoted token. The EXPORTED_FUNCTIONS value contains commas;
# unquoted, PowerShell parses them as its array operator and errors ("Missing
# argument in parameter list"). Quoting passes the literal string through to emcc.
$emccArgs = @(
  'src/wasm/tmm_kernel.c'
  '-O3'
  '--no-entry'
  '-sSTANDALONE_WASM=1'
  '-sALLOW_MEMORY_GROWTH=1'
  '-sEXPORTED_FUNCTIONS=_tmm_one,_tmm_spectrum,_tmm_jacobian,_tmm_needle_scan,_tmm_hessian,_malloc,_free'
  '-o'
  'src/wasm/tmm_kernel.wasm'
)
& emcc @emccArgs

Write-Host "Built src/wasm/tmm_kernel.wasm"
node tests/wasm_tmm_equivalence.mjs
