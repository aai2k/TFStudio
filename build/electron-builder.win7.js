/**
 * Legacy Windows 7 / 8 / 8.1 build config (dual-build, see PLAN).
 *
 * The MAIN build (Win10/11) uses package.json `build` as-is on Electron 39.
 * THIS config produces a separate "Win7" installer/portable packaged against
 * Electron 22.3.27 — the last Electron line that runs on Windows 7 SP1 / 8 / 8.1
 * (Electron 23+ requires Windows 10). Chromium 108; Node 18.
 *
 *   npm run build:win7      # -> dist\TFStudio-<ver>-Win7-Setup.exe (+ -Win7-Portable.exe)
 *
 * No source changes are needed: TFStudio has no native node modules (deps are
 * pure JS; the WASM TMM kernel is a prebuilt .wasm loaded at runtime), and a
 * static audit found no Chromium-110+ / Node-20+ APIs. electron-builder fetches
 * the E22 binary via the `electronVersion` override below — the installed
 * `electron@39` devDependency and the modern build path are untouched.
 */

const base = require('../package.json').build;

module.exports = {
    ...base,
    // Package against the last Electron that supports Windows 7/8/8.1.
    electronVersion: '22.3.27',
    win: {
        ...base.win,
        artifactName: '${productName}-${version}-Win7-Setup.${ext}',
    },
    nsis: {
        ...base.nsis,
        artifactName: '${productName}-${version}-Win7-Setup.${ext}',
    },
    portable: {
        ...base.portable,
        artifactName: '${productName}-${version}-Win7-Portable.${ext}',
    },
};
