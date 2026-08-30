/**
 * Launch electron-builder with the small amount of environment repair it
 * needs on Windows.
 *
 * Activating emsdk can leave a VS Code terminal with Emscripten's bundled Node
 * first on PATH and the Windows PowerShell directory missing. electron-builder
 * invokes powershell.exe while collecting production dependencies, so that
 * otherwise fails late with `spawn powershell.exe ENOENT`. TFStudio does not
 * need emsdk: tmmcore and its WASM binary arrive prebuilt from npm.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);

export function prepareBuilderEnvironment(source = process.env, options = {}) {
  const platform = options.platform || process.platform;
  const existsSync = options.existsSync || fs.existsSync;
  const env = { ...source, CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  if (platform !== 'win32') return env;

  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.WINDIR;
  if (!systemRoot) throw new Error('SystemRoot is unavailable; cannot locate Windows PowerShell.');

  const powerShellDir = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0');
  const powerShellExe = path.win32.join(powerShellDir, 'powershell.exe');
  if (!existsSync(powerShellExe)) {
    throw new Error(`Windows PowerShell was not found at ${powerShellExe}.`);
  }

  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const entries = String(env[pathKey] || '').split(';').filter(Boolean);
  const normalized = value => path.win32.normalize(value).replace(/[\\/]+$/, '').toLowerCase();
  if (!entries.some(entry => normalized(entry) === normalized(powerShellDir))) {
    entries.push(powerShellDir);
    console.warn(`[build] Added ${powerShellDir} to PATH for electron-builder.`);
  }
  env[pathKey] = entries.join(';');
  return env;
}

/**
 * Install build/portable.nsi over electron-builder's stock portable template.
 *
 * The portable target's NSIS script is hardcoded in app-builder-lib (no custom
 * script option exists for it, unlike the installer target), and the stock
 * script briefly shows the installer dialog at launch and again, titled
 * "Setup: Completed", after the app exits. The fork parks that dialog
 * off-screen; see the header of build/portable.nsi.
 */
export function installPortableTemplate(options = {}) {
  const readFile = options.readFileSync || fs.readFileSync;
  const writeFile = options.writeFileSync || fs.writeFileSync;
  const source = options.source ||
    path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'portable.nsi');
  const target = options.target ||
    path.join(path.dirname(require.resolve('app-builder-lib/package.json')), 'templates', 'nsis', 'portable.nsi');
  const wanted = readFile(source, 'utf8');
  const current = (() => { try { return readFile(target, 'utf8'); } catch { return null; } })();
  if (current === null) throw new Error(`stock portable template not found at ${target}`);
  if (current === wanted) return { target, updated: false };
  writeFile(target, wanted, 'utf8');
  console.warn('[build] Installed build/portable.nsi over the stock portable template.');
  return { target, updated: true };
}

export function runElectronBuilder(args = process.argv.slice(2)) {
  installPortableTemplate();
  const cli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: process.cwd(),
    env: prepareBuilderEnvironment(),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  try {
    process.exitCode = runElectronBuilder();
  } catch (error) {
    console.error(`[build] ${error.message}`);
    process.exitCode = 1;
  }
}
