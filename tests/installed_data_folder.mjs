/**
 * Where an installed build keeps its data, and what the installer and
 * uninstaller do with an install folder that holds more than the app.
 *
 * userData holds the Chromium profile, whose localStorage is the session of
 * unsaved designs, and settings.json. An installer update runs the previous
 * version's uninstaller, which deletes the install folder, so an installed
 * build must keep userData outside it. Releases up to 1.8.3 kept it in AppData
 * inside the install folder; build/installer.nsh copies that folder to the new
 * place before the old uninstaller runs.
 *
 * The user can also install into a folder that holds the data folder. The
 * uninstaller removes only the app's own entries, listed from the packed app
 * folder at build time; tests/installer_old_app.mjs covers what an update does
 * with an older app whose uninstaller removes the whole folder.
 *
 * The installer parts compile the real build/installer.nsh with the makensis
 * electron-builder caches and run its steps on throwaway folders; the
 * uninstaller part runs the template's own removal with it. Where that
 * makensis or its plugins are not present (not Windows, no installer built
 * yet) the part is left out and said so. Nothing here reads or writes the
 * registry: the steps that read it are checked where they stand in the script.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterPack, ENTRIES_FILE } from '../tools/install-folder-entries.mjs';
import {
    root, pkg, template, nshText, write, read, check, finish, macroText, functionText, assertInOrder,
    makensis, plugins, compile, assertCompiled, harnessHead, templateFlags, LANGUAGES, WRITE_TEXT,
    checkLanguages, PACKED, tops, packContext, writeList,
} from './_installer_harness.mjs';

const require = createRequire(import.meta.url);
const { resolveUserDataDir, resolveInstallDir } = require('../src/main/userDataDir.js');

// ── Where the app keeps its data ─────────────────────────────────────────────
const installDir = path.join('C:', 'Users', 'u', 'AppData', 'Local', 'Programs', 'TFStudio');
const appDataDir = path.join('C:', 'Users', 'u', 'AppData', 'Roaming');

const installed = resolveUserDataDir({ portableDir: undefined, isPackaged: true, exeDir: installDir, appDataDir });
assert.equal(installed, path.join(appDataDir, 'TFStudio'),
    'an installed build keeps its data in the per-user application data folder');
assert.ok(path.relative(installDir, installed).startsWith('..'),
    'an installed build keeps its data outside the install folder, which an update deletes');

const portableDir = path.join('D:', 'Tools', 'TFStudio');
assert.equal(
    resolveUserDataDir({ portableDir, isPackaged: true, exeDir: portableDir, appDataDir }),
    path.join(portableDir, 'AppData'),
    'the portable build keeps its data beside the exe the user started');
assert.equal(
    resolveUserDataDir({ portableDir: '', isPackaged: false, exeDir: path.join('X:', 'repo'), appDataDir }),
    path.join('X:', 'repo', 'AppData'),
    'a run from source keeps its data in the project directory');

// Only an installed build has an install folder an update deletes.
assert.equal(resolveInstallDir({ portableDir: undefined, isPackaged: true, exeDir: installDir }), installDir,
    'an installed build names its install folder');
assert.equal(resolveInstallDir({ portableDir, isPackaged: true, exeDir: portableDir }), null,
    'the portable build has none: no uninstaller runs on its folder');
assert.equal(resolveInstallDir({ portableDir: '', isPackaged: false, exeDir: path.join('X:', 'repo') }), null,
    'and neither has a run from source');

// ── The list of the app's own entries ────────────────────────────────────────
async function listCases(dir) {
    await check('every Windows build, the Windows 7 one too, writes the list of app entries', () => {
        assert.equal(pkg.build.afterPack, './tools/install-folder-entries.mjs');
        assert.equal(require(path.join(root, 'build', 'electron-builder.win7.js')).afterPack, pkg.build.afterPack);
    });
    await check('a Linux build writes no list', async () => {
        const out = path.join(dir, 'linux');
        fs.mkdirSync(out, { recursive: true });
        await afterPack(packContext(out, out, 'linux'));
        assert.equal(fs.existsSync(path.join(out, ENTRIES_FILE)), false);
    });
    await check('a packed folder without the app is refused rather than listed', async () => {
        const out = path.join(dir, 'no-app');
        write(path.join(out, 'other.exe'), '');
        await assert.rejects(afterPack(packContext(out, out)), /TFStudio\.exe/);
        assert.equal(fs.existsSync(path.join(out, ENTRIES_FILE)), false);
    });
    await check('a packed entry named like a data folder subfolder is refused, case ignored', async () => {
        const out = path.join(dir, 'clash');
        write(path.join(out, 'TFStudio.exe'), '');
        write(path.join(out, 'materials', 'x.json'), '');
        await assert.rejects(afterPack(packContext(out, out)), /materials/);
        assert.equal(fs.existsSync(path.join(out, ENTRIES_FILE)), false);
    });
    await check('the list holds the top level of the packed app folder, the version and the associations', async () => {
        const list = read(path.join(await writeList(path.join(dir, 'listed')), ENTRIES_FILE));
        assert.ok(list.includes(`!define INSTALL_FOLDER_ENTRIES_VERSION "${pkg.version}"`));
        for (const entry of tops(PACKED)) assert.ok(list.includes(`!insertmacro \${DO} "${entry}"`), `${entry} is listed`);
        assert.ok(!list.includes('app.asar'), 'and nothing below it');
        assert.ok(list.includes('!insertmacro ${DO} "tfs" "TFStudio.Design"'), 'the association, as the template registers it');
    });
}

// ── Where the steps run ──────────────────────────────────────────────────────
// The steps read the registry, which the harnesses leave alone, so where they
// stand in the script, and in the template around it, is checked as text.
async function placementCases() {
    const nsh = nshText();
    const section = template('installSection.nsh');
    await check('the installer runs the steps once the app is closed, before uninstallOldVersion', () => {
        assertInOrder(macroText(nsh, 'customCheckAppRunning'),
            ['_CHECK_APP_RUNNING', 'Call prepareOldInstalls', '$oldInstallFailure', 'Abort'], 'customCheckAppRunning');
        assertInOrder(section, ['${ifNot} ${UAC_IsInnerInstance}', 'CHECK_APP_RUNNING', '${endif}',
            'uninstallOldVersion SHELL_CONTEXT'], 'installSection.nsh');
    });
    await check('the elevated instance, which skips that check, runs them before its install starts', () => {
        assertInOrder(macroText(nsh, 'customInit'),
            ['${UAC_IsInnerInstance}', '${Silent}', 'Call prepareOldInstallsElevated'], 'customInit');
        assertInOrder(template('installer.nsi'), ['Function .onInit', 'initMultiUser', 'customInit', 'FunctionEnd',
            'Section "install"'], 'installer.nsi');
        assertInOrder(macroText(nsh, 'customPageAfterChangeDir'), ['!define MUI_PAGE_CUSTOMFUNCTION_SHOW elevatedInstallStarts',
            'Function elevatedInstallStarts', '${UAC_IsInnerInstance}', 'Call prepareOldInstallsElevated'],
        'customPageAfterChangeDir');
        assert.match(template('assistedInstaller.nsh'), /!insertmacro customPageAfterChangeDir\n\s*!endif\n\s*!insertmacro MUI_PAGE_INSTFILES/,
            'the install page follows straight after');
        assertInOrder(functionText(nsh, 'prepareOldInstallsElevated'), ['$oldInstallFailure == ""', '${else}', 'MessageBox', 'Quit'],
            'a failure ends the elevated instance');
    });
    await check('they read the old installs uninstallOldVersion removes, from the same keys', () => {
        const util = template(path.join('include', 'installUtil.nsh'));
        assert.ok(util.includes('"${UNINSTALL_REGISTRY_KEY}" UninstallString') && util.includes('"${INSTALL_REGISTRY_KEY}" InstallLocation'));
        assertInOrder(macroText(nsh, 'readOldInstall'), ['readOldInstallValues ${ROOT_KEY}', 'Call resolveOldInstall',
            'storeOldInstall ${N}'], 'readOldInstall');
        assertInOrder(macroText(nsh, 'readOldInstallValues'), ['${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" UninstallString',
            '${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" DisplayVersion', '${ROOT_KEY} "${INSTALL_REGISTRY_KEY}" InstallLocation'],
        'readOldInstallValues');
        assertInOrder(section, ['uninstallOldVersion SHELL_CONTEXT', '${if} $installMode == "all"',
            'uninstallOldVersion HKEY_CURRENT_USER'], 'installSection.nsh');
        assertInOrder(functionText(nsh, 'prepareOldInstalls'), ['readOldInstall SHELL_CONTEXT 1', 'clearOldInstall 2',
            '${if} $installMode == "all"', 'readOldInstall HKEY_CURRENT_USER 2', 'Call prepareFoundOldInstalls'],
        'prepareOldInstalls');
        assertInOrder(functionText(nsh, 'prepareOldInstallsElevated'), ['readOldInstall HKEY_LOCAL_MACHINE 1',
            'readOldInstall HKEY_CURRENT_USER 2', 'Call prepareFoundOldInstalls'], 'prepareOldInstallsElevated');
    });
    await check('the profile goes to the current user\'s folder the app reads, also for all users', () => {
        assertInOrder(macroText(nsh, 'findUserDataDir'), ['SetShellVarContext current',
            `StrCpy $userDataDir "$APPDATA\\${path.basename(installed)}"`, '${if} $installMode == "all"',
            'SetShellVarContext all'], 'findUserDataDir');
        assertInOrder(functionText(nsh, 'keepOldProfile'), ['!insertmacro keepInstallData "$0" "$userDataDir"'],
            'keepOldProfile');
    });
}

// ── The old profile ──────────────────────────────────────────────────────────
async function profileCases(dir, buildDir) {
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, 'harness.exe');
    const compiled = compile([
        ...harnessHead('keepInstallData', exe, buildDir, []),
        ...LANGUAGES,
        'Section',
        '  ${GetParameters} $0',
        '  ClearErrors',
        '  ${GetOptions} $0 "/TEXT=" $3',
        '  ${IfNot} ${Errors}',
        '    !insertmacro keepDataFailedText $4',
        ...WRITE_TEXT,
        '  ${EndIf}',
        '  ${GetOptions} $0 "/OLD=" $1',
        '  ${GetOptions} $0 "/DATA=" $2',
        // The installer reaches the step with the error flag set when the
        // registry has no InstallLocation; the step must not read it as a failure.
        '  SetErrors',
        '  !insertmacro keepInstallData "$1" "$2"',
        '  ${If} $oldInstallFailure != ""',
        '    Abort',
        '  ${EndIf}',
        'SectionEnd',
        '',
    ], path.join(dir, 'harness.nsi'));
    const run = (oldDir, dataDir) => {
        assertCompiled(compiled);
        return spawnSync(exe, [`/OLD=${oldDir}`, `/DATA=${dataDir}`]).status;
    };
    const log = (folder, name = '000003.log') => path.join(folder, 'Local Storage', 'leveldb', name);
    const oldInstall = (name) => {
        const folder = path.join(dir, name, 'install');
        write(log(path.join(folder, 'AppData')), 'session of the old version');
        write(path.join(folder, 'AppData', 'settings.json'), '{"folders":{"root":"E:\\\\Coatings"}}');
        return folder;
    };

    await check('the old profile is copied and left for the old uninstaller', () => {
        const oldDir = oldInstall('fresh');
        const dataDir = path.join(dir, 'fresh', 'Roaming', 'TFStudio');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'session of the old version', 'the session is copied');
        assert.equal(read(path.join(dataDir, 'settings.json')), '{"folders":{"root":"E:\\\\Coatings"}}',
            'settings.json, with the chosen data folder, is copied');
        assert.equal(read(log(path.join(oldDir, 'AppData'))), 'session of the old version',
            'the old folder is left for the old uninstaller, not moved');
    });
    await check('a profile of a newer build is kept aside, not mixed', () => {
        const oldDir = oldInstall('downgraded');
        const dataDir = path.join(dir, 'downgraded', 'Roaming', 'TFStudio');
        write(log(dataDir, '000005.log'), 'profile of a newer build');
        write(log(`${dataDir}.old`, '000001.log'), 'two updates ago');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'session of the old version', 'the old install, used last, wins');
        assert.equal(read(log(dataDir, '000005.log')), null, 'the two profiles are not mixed');
        assert.equal(read(log(`${dataDir}.old`, '000005.log')), 'profile of a newer build',
            'the profile that was there is kept aside');
        assert.equal(read(log(`${dataDir}.old`, '000001.log')), null, 'only the latest profile is kept aside');
    });
    await check('an old AppData the old version never ran from changes nothing', () => {
        const oldDir = path.join(dir, 'unused', 'install');
        write(path.join(oldDir, 'AppData', 'settings.json'), '{}');
        const dataDir = path.join(dir, 'unused', 'Roaming', 'TFStudio');
        write(log(dataDir), 'profile in use');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'profile in use');
        assert.equal(fs.existsSync(`${dataDir}.old`), false);
    });
    await check('a data folder that exists without a profile takes the copy', () => {
        const oldDir = oldInstall('partial');
        const dataDir = path.join(dir, 'partial', 'Roaming', 'TFStudio');
        write(path.join(dataDir, 'Crashpad', 'settings.dat'), 'crash reporter state');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'session of the old version');
    });
    await check('a copy that cannot be made stops the install before the old uninstaller runs', () => {
        const oldDir = oldInstall('blocked');
        const blocker = path.join(dir, 'blocked', 'Roaming');
        write(blocker, 'a file where the folder should be');
        assert.notEqual(run(oldDir, path.join(blocker, 'TFStudio')), 0);
        assert.equal(read(log(path.join(oldDir, 'AppData'))), 'session of the old version');
    });
    await checkLanguages('the message for a failed copy is in the installer language', exe, [],
        'The update was stopped and nothing was removed: TFStudio could not copy its settings and unsaved designs out of the old installation folder. Check that the disk has free space, then run the installer again.',
        [[1049, 'Обновление остановлено'], [2052, '更新已停止'], [1040, "L'aggiornamento"]]);
}

// ── What the uninstaller removes ─────────────────────────────────────────────
// Written into the install folder by the installer, and by the app beside its exe.
const ADDED = ['Uninstall TFStudio.exe', 'uninstallerIcon.ico', 'app-debug.log'];
const APP = [...PACKED, ...ADDED];
// A data folder at the top of the install folder, and a file of the user's.
const USER = ['Projects/Coating.tfs', 'Materials/My glass.catalog.json', 'notes.txt'];

// The uninstaller compiled as electron-builder compiles it: the template's
// removal and the two functions it calls, with the `updated` flag the
// template's header defines, and build/installer.nsh with the list of entries
// in buildDir. /LOCK= holds a file open, as a running program would.
function uninstallerHarness(dir, buildDir, version) {
    fs.mkdirSync(dir, { recursive: true });
    const uninstallerText = template('uninstaller.nsh');
    const functions = uninstallerText.match(/Function un\.atomicRMDir[\s\S]*?Function un\.restoreFiles[\s\S]*?FunctionEnd/);
    const removal = uninstallerText.match(/ {2}!ifmacrodef customRemoveFiles[\s\S]*?\n {2}!endif/);
    assert.ok(functions && removal, 'the template still has the removal this test runs');
    const writer = path.join(dir, 'write-uninstaller.exe');
    const uninstaller = path.join(dir, 'uninstall.exe');
    const compiled = compile([
        ...harnessHead('customRemoveFiles', writer, buildDir, [
            `!addplugindir /x86-unicode "${plugins}"`,
            '!include "StdUtils.nsh"',
            templateFlags(['updated']),
            '!define BUILD_UNINSTALLER',
            '!define UNINSTALL_FILENAME "Uninstall TFStudio.exe"',
        ], version),
        'SilentUnInstall silent',
        'Section',
        `  WriteUninstaller "${uninstaller}"`,
        'SectionEnd',
        functions[0],
        'Function un.onInit',
        '  ${GetParameters} $0',
        '  ClearErrors',
        '  ${GetOptions} $0 "/LOCK=" $1',
        '  ${IfNot} ${Errors}',
        '    FileOpen $9 "$INSTDIR\\$1" r',
        '  ${EndIf}',
        'FunctionEnd',
        'Section "un.Uninstall"',
        removal[0],
        'SectionEnd',
        '',
    ], path.join(dir, 'harness.nsi'));
    return { compiled, writer, uninstaller };
}

async function uninstallerCases(dir, buildDir) {
    const { compiled, writer, uninstaller } = uninstallerHarness(path.join(dir, 'harness'), buildDir, pkg.version);
    const built = () => {
        assertCompiled(compiled);
        if (!fs.existsSync(uninstaller)) spawnSync(writer);
        assert.ok(fs.existsSync(uninstaller), 'the harness writes its uninstaller');
    };
    const installFolder = (name, files) => {
        const folder = path.join(dir, name);
        for (const file of files) write(path.join(folder, file), file);
        return folder;
    };
    const uninstall = (folder, { updated = false, lock = null } = {}) => {
        built();
        const args = [...(updated ? ['--updated'] : []), ...(lock ? [`/LOCK=${lock}`] : []), '/S'];
        // NSIS reads the rest of the command line after _?= as the folder,
        // unquoted, so it goes last and nothing is quoted for it.
        return spawnSync(uninstaller, [...args, `_?=${folder}`],
            { windowsVerbatimArguments: true, argv0: `"${uninstaller}"` }).status;
    };
    const unchanged = (folder, files) => files.filter(file => read(path.join(folder, file)) !== file);
    const appEntriesLeft = folder => tops(APP).filter(entry => fs.existsSync(path.join(folder, entry)));

    for (const updated of [false, true]) {
        const run = updated ? 'an update' : 'an uninstall';
        await check(`${run} removes every app entry and keeps the data folder and a stray file`, () => {
            const folder = installFolder(`kept-${updated}`, [...APP, ...USER]);
            assert.equal(uninstall(folder, { updated }), 0);
            assert.deepEqual(appEntriesLeft(folder), [], 'no app entry is left');
            assert.deepEqual(unchanged(folder, USER), [], 'the data folder and the stray file are kept');
        });
        await check(`${run} removes an install folder that holds only the app`, () => {
            const folder = installFolder(`only-app-${updated}`, APP);
            assert.equal(uninstall(folder, { updated }), 0);
            assert.equal(fs.existsSync(folder), false);
        });
    }
    for (const lock of ['resources\\app.asar', 'vulkan-1.dll']) {
        await check(`an update stops with every file back in place when ${lock} is in use`, () => {
            const folder = installFolder(`busy-${path.basename(lock)}`, [...APP, ...USER]);
            assert.notEqual(uninstall(folder, { updated: true, lock }), 0, 'the old uninstaller fails');
            assert.deepEqual(unchanged(folder, [...APP, ...USER]), [], 'every file is where it was');
        });
    }
    await check('a build that has not written the list fails to compile', () => {
        const empty = path.join(dir, 'no-list');
        fs.mkdirSync(empty, { recursive: true });
        const { compiled: failed } = uninstallerHarness(path.join(dir, 'harness-no-list'), empty, pkg.version);
        assert.notEqual(failed.status, 0, 'makensis stops');
        assert.match(failed.stdout + failed.stderr, new RegExp(ENTRIES_FILE.replace(/\./g, '\\.')));
    });
    await check('a list written for another version fails to compile', () => {
        const { compiled: failed } = uninstallerHarness(path.join(dir, 'harness-old-list'), buildDir, '0.0.1');
        assert.notEqual(failed.status, 0, 'makensis stops');
        assert.match(failed.stdout + failed.stderr, /lists the files of .* not of 0\.0\.1/);
    });
}

// ── Running the cases ────────────────────────────────────────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-installer-'));
try {
    await listCases(path.join(sandbox, 'lists'));
    await placementCases();
    if (makensis && plugins) {
        const buildDir = await writeList(sandbox);
        await profileCases(path.join(sandbox, 'profile'), buildDir);
        await uninstallerCases(path.join(sandbox, 'uninstall'), buildDir);
    } else {
        console.log('installed data folder: no cached makensis or NSIS plugins, installer steps not run');
    }
} finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
}

finish('Installed data folder');
