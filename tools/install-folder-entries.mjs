/**
 * The list of entries the app puts at the top of its install folder, written
 * for the NSIS installer and uninstaller.
 *
 * The uninstaller removes these entries and nothing else, so a folder the user
 * installed into keeps whatever else it holds, a data folder among them; the
 * installer uses the same names when it removes an older app that sits beside
 * a data folder. The files Electron ships change between Electron versions,
 * and the Windows 7 build packs an older Electron than the main one, so the
 * list is read from the packed app folder of each build rather than kept by
 * hand. The file associations from the build config go in the same file, for
 * the installer to remove an old per-user install's association.
 *
 * electron-builder calls afterPack once the packed folder is complete and
 * before it compiles the installer. build/installer.nsh includes the file
 * written here in both compiles, and the file carries the app version: a build
 * that packs nothing (--prepackaged) skips afterPack and stops at the include,
 * or at the version check when a list from a build of another version is still
 * there. A list from an earlier build of the same version is not caught.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { FOLDER_SPECS } = require('../src/main/userPaths.js');

export const ENTRIES_FILE = 'install-folder-entries.nsh';

// The names at the top of the packed app folder, in a fixed order.
export function packedEntries(appOutDir) {
  return fs.readdirSync(appOutDir).sort((a, b) => a.localeCompare(b, 'en'));
}

// The entries named like a subfolder of the data folder, which the installer
// and uninstaller would remove from a data folder that is also the install
// folder. Windows compares names without case.
export function dataFolderClashes(entries) {
  const subfolders = new Set(FOLDER_SPECS.map(spec => spec.subdir.toLowerCase()));
  return entries.filter(name => subfolders.has(name.toLowerCase()));
}

// NSIS reads $ as the start of a variable; $$ is a literal dollar sign.
function nsisString(text) {
  return `"${text.replace(/\$/g, '$$$$')}"`;
}

// The extension and file class of each file association, as electron-builder's
// NSIS target registers them (an extension without its dot, the class named
// by `name` or else the extension).
export function fileAssociations(associations = []) {
  return [associations].flat().flatMap(item => [item.ext].flat()
    .map(ext => [ext.replace(/^\./, ''), item.name || ext]));
}

// The app version the list was read for, and NSIS macros that insert the macro
// named by DO once per entry and once per file association.
export function entriesNsh(entries, version, associations = []) {
  return [
    '; The top level of the packed app folder and the file associations,',
    '; written by tools/install-folder-entries.mjs at build time.',
    `!define INSTALL_FOLDER_ENTRIES_VERSION ${nsisString(version)}`,
    '!macro packedAppEntries DO',
    ...entries.map(name => `  !insertmacro \${DO} ${nsisString(name)}`),
    '!macroend',
    '!macro appFileAssociations DO',
    ...associations.map(([ext, fileClass]) => `  !insertmacro \${DO} ${nsisString(ext)} ${nsisString(fileClass)}`),
    '!macroend',
    '',
  ].join('\r\n');
}

export async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const { appInfo, buildResourcesDir } = context.packager;
  const entries = packedEntries(context.appOutDir);
  const exe = `${appInfo.productFilename}.exe`;
  if (!entries.includes(exe)) {
    throw new Error(`${exe} is not in ${context.appOutDir}, so its entries are not the app's`);
  }
  const clashes = dataFolderClashes(entries);
  if (clashes.length) {
    throw new Error(`${clashes.join(', ')} in ${context.appOutDir} is named like a data folder subfolder, which the uninstaller would remove`);
  }
  const associations = fileAssociations(context.packager.fileAssociations);
  fs.writeFileSync(path.join(buildResourcesDir, ENTRIES_FILE), entriesNsh(entries, appInfo.version, associations), 'utf8');
}
