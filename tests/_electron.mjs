/**
 * The path of the Electron binary the app runs on, for tests that run code on
 * the app's own runtime as Node (ELECTRON_RUN_AS_NODE), or null where it is
 * not installed: the CI test job skips its download. The binary is looked up
 * the way the electron package finds it; requiring the package would download
 * it when it is missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

export function electronBinary() {
    let dir;
    try {
        dir = path.dirname(createRequire(import.meta.url).resolve('electron/package.json'));
    } catch {
        return null;
    }
    const pathFile = path.join(dir, 'path.txt');
    if (!fs.existsSync(pathFile)) return null;
    const binary = path.join(dir, 'dist', fs.readFileSync(pathFile, 'utf8'));
    return fs.existsSync(binary) ? binary : null;
}
