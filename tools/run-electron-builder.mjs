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
import { pathToFileURL } from 'node:url';

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

export function runElectronBuilder(args = process.argv.slice(2)) {
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
