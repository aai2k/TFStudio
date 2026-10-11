/**
 * What an update does with an older TFStudio whose uninstaller removes the
 * whole install folder, when that folder also holds a data folder: the
 * installer removes the old app's own files itself, leaves the user's, and
 * makes sure the old uninstaller never runs on that folder.
 *
 * Two old installs can be removed by one update: the one in its install mode
 * and, when it installs for all users, the current user's own. Both are
 * checked before anything moves, and both are moved out before either is
 * deleted.
 *
 * The steps of build/installer.nsh are compiled with the makensis
 * electron-builder caches and run on throwaway folders, the registry values
 * of the old installs given on the command line. One harness also runs the
 * template's own uninstallOldVersion after them, its registry reads answered
 * from those values. Nothing here reads or writes the registry: the steps
 * that do are checked where they stand in the script.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
    template, nshText, write, read, check, finish, macroText, functionText, assertInOrder,
    makensis, plugins, compile, assertCompiled, harnessHead, templateFlags, templateFunctions,
    LANGUAGES, WRITE_TEXT, checkLanguages, PACKED, tops, writeList,
} from './_installer_harness.mjs';

const require = createRequire(import.meta.url);
const { FOLDER_SPECS } = require('../src/main/userPaths.js');

// An old install as releases before 1.8.6 left it: the top level of the packed
// app folder of 1.8.5 built with Electron 44.5.1 and with Electron 22.3.27
// (libEGL.dll and libGLESv2.dll only in 22, dxcompiler.dll and dxil.dll only
// in 44), and the files the installer and the app add, the two folders with
// files in them.
const OLD_NAMES = [
    'TFStudio.exe', 'Uninstall TFStudio.exe', 'uninstallerIcon.ico', 'app-debug.log', 'resources', 'locales',
    'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'dxcompiler.dll', 'dxil.dll',
    'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE.electron.txt', 'LICENSES.chromium.html',
    'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'vk_swiftshader.dll',
    'vk_swiftshader_icd.json', 'vulkan-1.dll',
];
const INSIDE = {
    resources: ['resources/app.asar', 'resources/app-update.yml', 'resources/help/index.html',
        'resources/app.asar.unpacked/build/app/index.html'],
    locales: ['locales/en-US.pak', 'locales/ru.pak'],
};
const OLD_APP = OLD_NAMES.flatMap(name => INSIDE[name] || [name]);
// Files of the user's at the top of the install folder, results.dat named the
// way some of Electron's files are.
const OLD_USER = ['notes.txt', 'results.dat'];
const DATA = ['Projects/Coating.tfs', 'Materials/Glass.catalog.json'];
const DEFINES = [
    '!define PRODUCT_FILENAME "TFStudio"',
    '!define APP_EXECUTABLE_FILENAME "TFStudio.exe"',
    '!define UNINSTALL_FILENAME "Uninstall TFStudio.exe"',
    '!define APP_ID "com.tfstudio.test"',
    '!define INSTALL_REGISTRY_KEY "Software\\TFStudio installer test"',
    '!define UNINSTALL_REGISTRY_KEY "Software\\TFStudio installer test uninstall"',
];

// The old install in slot N from /DIR, /VER and /UNINSTALLER with SUFFIX:
// InstallLocation, DisplayVersion and the uninstaller in UninstallString,
// written as the template writes it.
const SLOT_MACRO = [
    '!macro harnessOldInstall N SUFFIX',
    '  ${GetOptions} $0 "/DIR${SUFFIX}=" $oldInstallDir',
    '  ${GetOptions} $0 "/VER${SUFFIX}=" $oldVersion',
    '  ClearErrors',
    '  ${GetOptions} $0 "/UNINSTALLER${SUFFIX}=" $1',
    '  ${If} ${Errors}',
    '    StrCpy $oldUninstaller ""',
    '  ${Else}',
    '    StrCpy $oldUninstaller \'"$1" /currentuser\'',
    '  ${EndIf}',
    '  Call resolveOldInstall',
    '  !insertmacro storeOldInstall ${N}',
    '!macroend',
];

// The step for one or two old installs. /DATA= is the user's data folder,
// /INSTDIR= the folder being installed into, /LOCK= a file held open, as a
// running program would.
function stepHarness(dir, buildDir) {
    fs.mkdirSync(dir, { recursive: true });
    const exe = path.join(dir, 'harness.exe');
    const compiled = compile([
        ...harnessHead('prepareFoundOldInstalls', exe, buildDir,
            [`!addplugindir /x86-unicode "${plugins}"`, ...DEFINES]),
        'Var installMode',
        ...templateFunctions(['GetInQuotes', 'GetFileParent']),
        '!insertmacro customHeader',
        ...SLOT_MACRO,
        ...LANGUAGES,
        'Section',
        '  ${GetParameters} $0',
        '  ClearErrors',
        '  ${GetOptions} $0 "/TEXT=" $3',
        '  ${IfNot} ${Errors}',
        '    ${GetOptions} $0 "/FILE=" $1',
        '    !insertmacro oldAppNotMovedText $4 "$1"',
        ...WRITE_TEXT,
        '  ${EndIf}',
        '  ClearErrors',
        '  ${GetOptions} $0 "/MATCH=" $1',
        '  ${IfNot} ${Errors}',
        '    Push $1',
        '    Call isOldAppEntry',
        '    Pop $1',
        '    SetErrorLevel $1',
        '    Quit',
        '  ${EndIf}',
        '  ClearErrors',
        '  ${GetOptions} $0 "/ISLINK=" $1',
        '  ${IfNot} ${Errors}',
        '    Push $1',
        '    Call isLink',
        '    Pop $1',
        '    SetErrorLevel $1',
        '    Quit',
        '  ${EndIf}',
        '  !insertmacro harnessOldInstall 1 ""',
        '  !insertmacro harnessOldInstall 2 2',
        '  ${GetOptions} $0 "/DATA=" $userDataDir',
        '  ${GetOptions} $0 "/INSTDIR=" $INSTDIR',
        '  ClearErrors',
        '  ${GetOptions} $0 "/LOCK=" $1',
        '  ${IfNot} ${Errors}',
        '    FileOpen $9 "$1" r',
        '  ${EndIf}',
        '  Call prepareFoundOldInstalls',
        '  ${If} $oldInstallFailure != ""',
        '    Abort',
        '  ${EndIf}',
        'SectionEnd',
        '',
    ], path.join(dir, 'harness.nsi'));
    return { compiled, exe };
}

// Runs EXE with ARGS unquoted: GetOptions reads a value up to the next " /",
// spaces included, and NSIS reads the rest of the line after _?= as a folder.
const runVerbatim = (exe, args, timeout = 60000) =>
    spawnSync(exe, args, { timeout, windowsVerbatimArguments: true, argv0: `"${exe}"` }).status;

const changed = (folder, files) => files.filter(file => read(path.join(folder, file)) !== file);
const appLeft = folder => tops(OLD_APP).filter(entry => fs.existsSync(path.join(folder, entry)));
const asideLeft = folder => fs.readdirSync(folder).filter(name => name.startsWith('TFStudio old app'));
const assertRemoved = (folder, dataFiles) => {
    assert.deepEqual(appLeft(folder), [], 'no file of the old app is left');
    assert.deepEqual(changed(folder, [...OLD_USER, ...dataFiles]), [], 'the user\'s files are untouched');
    assert.deepEqual(asideLeft(folder), [], 'and the folder the files were moved into is gone');
};
const assertUntouched = (folder, dataFiles = []) => {
    assert.deepEqual(changed(folder, [...OLD_APP, ...OLD_USER, ...dataFiles]), [], 'every file is where it was');
    assert.deepEqual(asideLeft(folder), [], 'and no folder of moved files is left');
};

function oldInstalls(dir) {
    const oldInstall = (name) => {
        const folder = path.join(dir, name);
        for (const file of [...OLD_APP, ...OLD_USER]) write(path.join(folder, file), file);
        return folder;
    };
    // An old install with a data folder at PARTS inside it.
    const withData = (name, ...parts) => {
        const folder = oldInstall(name);
        for (const file of DATA) write(path.join(folder, ...parts, file), path.posix.join(...parts, file));
        return folder;
    };
    return { oldInstall, withData };
}

// The arguments for an old install in FOLDER at VERSION in slot SUFFIX.
function slotArgs(folder, { version = '1.8.5', location = folder, uninstaller = 'Uninstall TFStudio.exe' } = {}, suffix = '') {
    const given = [[`/DIR${suffix}=`, location, location], [`/UNINSTALLER${suffix}=`, uninstaller, path.join(folder, uninstaller)]];
    return [`/VER${suffix}=${version}`, ...given.filter(([, value]) => value).map(([option, , value]) => option + value)];
}

async function oneInstallCases(dir, step, { oldInstall, withData }) {
    await check('an update from 1.8.5 removes the old app from a data folder that is the install folder', () => {
        const folder = withData('depth0', '.');
        assert.equal(step(folder), 0, 'and the install carries on');
        assertRemoved(folder, DATA);
    });
    await check('it does so for a data folder one level inside the install folder', () => {
        const folder = withData('depth1', 'Data');
        assert.equal(step(folder), 0);
        assertRemoved(folder, DATA.map(file => `Data/${file}`));
    });
    await check('and three levels inside', () => {
        const folder = withData('depth3', 'a', 'b', 'c');
        assert.equal(step(folder), 0);
        assertRemoved(folder, DATA.map(file => `a/b/c/${file}`));
    });
    await check('and for a data folder reached through a junction, which the old uninstaller follows', () => {
        const folder = oldInstall('linked');
        const elsewhere = path.join(dir, 'elsewhere', 'TFStudio');
        for (const file of DATA) write(path.join(elsewhere, file), file);
        fs.symlinkSync(elsewhere, path.join(folder, 'Shared'), 'junction');
        assert.equal(step(folder), 0);
        assertRemoved(folder, []);
        assert.deepEqual(changed(elsewhere, DATA), [], 'the data folder the junction leads to is untouched');
        assert.ok(fs.existsSync(path.join(folder, 'Shared')), 'and so is the junction');
    });
    await check('the uninstaller is found from UninstallString when InstallLocation is empty', () => {
        const folder = withData('no-location', '.');
        assert.equal(step(folder, { location: '' }), 0);
        assertRemoved(folder, DATA);
    });
    await check('an old install with no version recorded counts as older', () => {
        const folder = withData('unversioned', '.');
        assert.equal(step(folder, { version: '' }), 0);
        assertRemoved(folder, DATA);
    });
    for (const lock of ['resources\\app.asar', 'vk_swiftshader_icd.json', 'TFStudio.exe']) {
        await check(`a busy ${lock} stops the update with every file back in place`, () => {
            const folder = withData(`busy-${path.basename(lock)}`, '.');
            assert.notEqual(step(folder, { lock: path.join(folder, lock) }), 0, 'the install stops');
            assertUntouched(folder, DATA);
        });
    }
    await check('an old install of 1.8.6 or later is left to its own uninstaller', () => {
        const folder = withData('safe', '.');
        assert.equal(step(folder, { version: '1.8.6' }), 0);
        assert.equal(step(folder, { version: '1.10.0' }), 0);
        assertUntouched(folder, DATA);
    });
    await check('an old install without a data folder is left to its uninstaller', () => {
        const folder = oldInstall('no-data');
        write(path.join(folder, 'Projects', 'Coating.tfs'), 'Projects/Coating.tfs');
        assert.equal(step(folder), 0);
        assertUntouched(folder, ['Projects/Coating.tfs']);
    });
    await check('an old install whose uninstaller is gone is left alone, as uninstallOldVersion leaves it', () => {
        const folder = withData('no-uninstaller', '.');
        fs.rmSync(path.join(folder, 'Uninstall TFStudio.exe'));
        assert.equal(step(folder), 0);
        assert.deepEqual(changed(folder, [...OLD_APP.filter(file => !file.startsWith('Uninstall')), ...OLD_USER, ...DATA]), []);
    });
    await check('a fresh install, with no old install, touches nothing', () => {
        assert.equal(step(path.join(dir, 'nothing'), { location: '', uninstaller: '' }), 0);
    });
}

// Followed every time, links back to the top would multiply the walk at every
// level until the paths passed Windows' 260 characters.
async function linkCases(dir, step, { oldInstall }) {
    await check('junctions back up the tree are searched once, and without a data folder nothing moves', () => {
        const folder = oldInstall('loop');
        for (const at of ['l', 'resources/l', 'locales/l']) fs.symlinkSync(folder, path.join(folder, at), 'junction');
        assert.equal(step(folder, { timeout: 30000 }), 0, 'the search ends');
        assertUntouched(folder);
    });
    await check('when the links would not fit in the list of those followed, it counts as a data folder', () => {
        const folder = oldInstall('full-list');
        const targets = path.join(dir, 'full-targets');
        for (let at = 0; at < 60; at++) {
            const target = path.join(targets, `t${String(at).padStart(2, '0')}_${'p'.repeat(100)}`);
            fs.mkdirSync(target, { recursive: true });
            fs.symlinkSync(target, path.join(folder, `a${String(at).padStart(2, '0')}`), 'junction');
        }
        for (const at of ['zz1', 'zz2']) fs.symlinkSync(folder, path.join(folder, at), 'junction');
        assert.equal(step(folder, { timeout: 30000 }), 0, 'the search ends');
        assertRemoved(folder, []);
        assert.equal(fs.readdirSync(targets).length, 60, 'and the folders the links lead to stay');
    });
}

// The profiles of two old installs, slot 1 and slot 2. Releases up to 1.8.3
// kept theirs in AppData inside the install folder.
const UP_TO_1_8_3 = { version: '1.8.3', secondSlot: { version: '1.8.3' } };
const profile = (folder, text) => {
    write(path.join(folder, 'AppData', 'Local Storage', 'leveldb', '000003.log'), text);
    return folder;
};
const session = folder => read(path.join(folder, 'Local Storage', 'leveldb', '000003.log'));
const userProfile = (folder, text) => write(path.join(folder, 'Local Storage', 'leveldb', '000003.log'), text);

async function profileCases(dir, step, { oldInstall }) {
    await check('installing for all users, the current user\'s own old profile is copied too, last, and is the one in use', () => {
        const data = path.join(dir, 'profiles-data');
        const machine = profile(oldInstall('profiles-machine'), 'all users');
        const user = profile(oldInstall('profiles-user'), 'own');
        assert.equal(step(machine, { ...UP_TO_1_8_3, second: user, data }), 0);
        assert.equal(session(data), 'own');
        assert.equal(session(`${data}.old`), 'all users', 'the other one is kept aside');
    });
    await check('with no old install named, the folder being installed into fills an empty profile folder, once', () => {
        const data = path.join(dir, 'fallback-data');
        const into = profile(path.join(dir, 'fallback-into'), 'from the install folder');
        assert.equal(step(path.join(dir, 'fallback-none'), { version: '', location: '', uninstaller: '', instdir: into, data }), 0);
        assert.equal(session(data), 'from the install folder');
        assert.equal(fs.existsSync(`${data}.old`), false, 'copied once');
    });
    await check('a profile kept aside earlier in the same run stays when the second is copied', () => {
        const data = path.join(dir, 'newer-data');
        userProfile(data, 'newer build');
        const machine = profile(oldInstall('newer-machine'), 'all users');
        const user = profile(oldInstall('newer-user'), 'own');
        assert.equal(step(machine, { ...UP_TO_1_8_3, second: user, data }), 0);
        assert.equal(session(data), 'own');
        assert.equal(session(`${data}.old`), 'newer build', 'the newer build\'s profile is not deleted');
        assert.equal(session(`${data}.old2`), 'all users');
    });
    await check('a folder both old installs name has its profile copied once', () => {
        const data = path.join(dir, 'same-data');
        userProfile(`${data}.old`, 'an earlier run');
        const user = profile(oldInstall('same-user'), 'own');
        const options = { version: '', location: '', uninstaller: '', instdir: user, second: user, secondSlot: { version: '1.8.3' }, data };
        assert.equal(step(path.join(dir, 'same-none'), options), 0);
        assert.equal(session(data), 'own');
        assert.equal(session(`${data}.old`), 'an earlier run', 'nothing is moved aside');
    });
}

// 1.8.3 installed into Documents, so into the data folder, then updated to
// 1.8.6, used, and updated to 1.8.7: the 1.8.3 profile left in the install
// folder by the first update is not copied over the one in use.
async function recurrenceCases(dir, step, { withData }) {
    await check('a profile left in the install folder by an earlier update is not copied again', () => {
        const data = path.join(dir, 'recur-data');
        const folder = profile(withData('recur', '.'), '1.8.3 session');
        assert.equal(step(folder, { version: '1.8.3', data }), 0, 'the update to 1.8.6');
        assert.equal(session(data), '1.8.3 session', 'the 1.8.3 profile is copied');
        assertRemoved(folder, DATA);
        for (const file of ['TFStudio.exe', 'Uninstall TFStudio.exe']) write(path.join(folder, file), file);
        userProfile(data, '1.8.6 session');
        assert.equal(step(folder, { version: '1.8.6', data }), 0, 'the update to 1.8.7');
        assert.equal(session(data), '1.8.6 session', 'the 1.8.6 profile stays the one in use');
        assert.equal(fs.existsSync(`${data}.old`), false, 'and nothing is moved aside');
    });
    // The same 1.8.6 install uninstalled, which takes its registry entries and
    // leaves the 1.8.3 AppData, then reinstalled into that folder, twice.
    await check('a reinstall into a folder holding an old profile leaves the profile in use alone', () => {
        const data = path.join(dir, 'reinstall-data');
        const folder = profile(withData('reinstall', '.'), '1.8.3 session');
        assert.equal(step(folder, { version: '1.8.3', data }), 0, 'the update to 1.8.6');
        userProfile(data, '1.8.6 session');
        for (const reinstall of ['first', 'second']) {
            assert.equal(step(folder, { version: '', location: '', uninstaller: '', instdir: folder, data }), 0);
            assert.equal(session(data), '1.8.6 session', `the profile in use stays after the ${reinstall} reinstall`);
            assert.equal(fs.existsSync(`${data}.old`), false, 'and nothing is moved aside');
        }
    });
}

// The old apps of two old installs, slot 1 and slot 2.
async function twoInstallCases(dir, step, { withData }) {
    await check('two old installs beside data folders are both removed', () => {
        const first = withData('both-first', '.');
        const second = withData('both-second', '.');
        assert.equal(step(first, { second }), 0);
        assertRemoved(first, DATA);
        assertRemoved(second, DATA);
    });
    for (const busy of ['TFStudio.exe', 'vk_swiftshader_icd.json']) {
        await check(`a busy ${busy} in the second old install leaves the first whole too`, () => {
            const first = withData(`busy-first-${busy}`, '.');
            const second = withData(`busy-second-${busy}`, '.');
            assert.notEqual(step(first, { second, lock: path.join(second, busy) }), 0, 'the install stops');
            assertUntouched(first, DATA);
            assertUntouched(second, DATA);
        });
    }
}

async function nameCases(dir, exe, compiled) {
    await check('a junction counts as a link and a folder does not', () => {
        assertCompiled(compiled);
        const target = path.join(dir, 'link-target');
        fs.mkdirSync(target, { recursive: true });
        fs.symlinkSync(target, path.join(dir, 'link-junction'), 'junction');
        assert.equal(runVerbatim(exe, [`/ISLINK=${path.join(dir, 'link-junction')}`]), 1);
        assert.equal(runVerbatim(exe, [`/ISLINK=${target}`]), 0);
    });
    await check('the old app\'s names are those of both Electron builds, case ignored, and nothing else', () => {
        assertCompiled(compiled);
        const isApp = name => runVerbatim(exe, [`/MATCH=${name}`]) === 1;
        for (const name of [...OLD_NAMES, ...tops(PACKED)]) assert.equal(isApp(name.toUpperCase()), true, `${name} is the app's`);
        const subfolders = FOLDER_SPECS.flatMap(({ subdir }) => [subdir, subdir.toUpperCase(), subdir.toLowerCase()]);
        for (const name of [...subfolders, ...OLD_USER]) assert.equal(isApp(name), false, `${name} is not`);
    });
    await checkLanguages('the message for a file that would not move is in the installer language', exe,
        ['/FILE=C:\\Old\\TFStudio.exe'],
        'The update was stopped and nothing was removed: TFStudio could not move the old version\'s file C:\\Old\\TFStudio.exe. Close TFStudio, then run the installer again.',
        [[1049, 'Обновление остановлено, ничего не удалено'], [2052, '更新已停止，未删除任何内容'], [1040, "L'aggiornamento è stato interrotto e non è stato rimosso nulla"]]);
}

async function stepCases(dir, buildDir) {
    const { compiled, exe } = stepHarness(path.join(dir, 'harness'), buildDir);
    const data = path.join(dir, 'user-data');
    const step = (folder, options = {}) => {
        assertCompiled(compiled);
        const { second, secondSlot = {}, lock, instdir, timeout } = options;
        const args = [...slotArgs(folder, options), ...(second ? slotArgs(second, secondSlot, '2') : []),
            `/DATA=${options.data || data}`, ...(instdir ? [`/INSTDIR=${instdir}`] : []), ...(lock ? [`/LOCK=${lock}`] : [])];
        return runVerbatim(exe, args, timeout);
    };
    const installs = oldInstalls(dir);
    await oneInstallCases(dir, step, installs);
    await linkCases(dir, step, installs);
    await profileCases(dir, step, installs);
    await recurrenceCases(dir, step, installs);
    await twoInstallCases(dir, step, installs);
    await nameCases(dir, exe, compiled);
}

// ── After the step: the template's uninstallOldVersion ───────────────────────
// installSection.nsh:52-58 when installing for all users, after the real
// prepareOldInstalls or prepareOldInstallsElevated (/PATH=elevated). The two
// old installs' registry values come from the command line: the macros that
// read and delete them are swapped for ones that read and blank those values,
// and the one that removes shortcuts and file associations is left out. The
// old installs' uninstallers remove their whole folder, as the releases before
// 1.8.6 do.
const STUB_REGISTRY = [
    'Var stubMachineUninstall', 'Var stubMachineVersion', 'Var stubMachineLocation',
    'Var stubUserUninstall', 'Var stubUserVersion', 'Var stubUserLocation', 'Var stubUserDataDir', 'Var stubStateFile',
    // Push ROOT_KEY: its values into the old install being read.
    'Function stubRead',
    '  Exch $0',
    '  ${If} $0 == "HKEY_CURRENT_USER"',
    '    StrCpy $oldUninstaller $stubUserUninstall',
    '    StrCpy $oldVersion $stubUserVersion',
    '    StrCpy $oldInstallDir $stubUserLocation',
    '  ${Else}',
    '    StrCpy $oldUninstaller $stubMachineUninstall',
    '    StrCpy $oldVersion $stubMachineVersion',
    '    StrCpy $oldInstallDir $stubMachineLocation',
    '  ${EndIf}',
    '  Pop $0',
    'FunctionEnd',
    // Push ROOT_KEY: its uninstall entry deleted.
    'Function stubForget',
    '  Exch $0',
    '  ${If} $0 == "HKEY_CURRENT_USER"',
    '    StrCpy $stubUserUninstall ""',
    '    StrCpy $stubUserVersion ""',
    '  ${Else}',
    '    StrCpy $stubMachineUninstall ""',
    '    StrCpy $stubMachineVersion ""',
    '  ${EndIf}',
    '  Pop $0',
    'FunctionEnd',
    // The template's readReg: Push "ROOT_KEY NAME", where SHELL_CONTEXT is the
    // all-users hive.
    'Function stubReadReg',
    '  Exch $0',
    '  ${If} $0 == "SHELL_CONTEXT UninstallString"',
    '    StrCpy $0 $stubMachineUninstall',
    '  ${ElseIf} $0 == "SHELL_CONTEXT InstallLocation"',
    '    StrCpy $0 $stubMachineLocation',
    '  ${ElseIf} $0 == "HKEY_CURRENT_USER UninstallString"',
    '    StrCpy $0 $stubUserUninstall',
    '  ${ElseIf} $0 == "HKEY_CURRENT_USER InstallLocation"',
    '    StrCpy $0 $stubUserLocation',
    '  ${Else}',
    '    StrCpy $0 ""',
    '  ${EndIf}',
    '  Exch $0',
    'FunctionEnd',
    '!macroundef readOldInstallValues',
    '!macro readOldInstallValues ROOT_KEY',
    '  Push "${ROOT_KEY}"',
    '  Call stubRead',
    '!macroend',
    '!macroundef forgetOldInstall',
    '!macro forgetOldInstall ROOT_KEY',
    '  Push "${ROOT_KEY}"',
    '  Call stubForget',
    '!macroend',
    '!macroundef forgetCurrentUserEntry',
    '!macro forgetCurrentUserEntry',
    '  !insertmacro forgetOldInstall HKEY_CURRENT_USER',
    '  StrCpy $stubUserLocation ""',
    '!macroend',
    '!macroundef forgetCurrentUserInstall',
    '!macro forgetCurrentUserInstall',
    '  !insertmacro forgetCurrentUserEntry',
    '!macroend',
    '!macroundef findUserDataDir',
    '!macro findUserDataDir',
    '  StrCpy $userDataDir $stubUserDataDir',
    '!macroend',
];

function templateRunHarness(dir, buildDir) {
    fs.mkdirSync(dir, { recursive: true });
    const util = template(path.join('include', 'installUtil.nsh'));
    const readReg = macroText(util, 'readReg');
    assert.ok(readReg, 'the template still reads the registry through readReg');
    const exe = path.join(dir, 'harness.exe');
    const oldUninstaller = path.join(dir, 'old-uninstaller.exe');
    const fake = compile([
        'Unicode true', 'Name "old uninstaller"', `OutFile "${path.join(dir, 'write-old-uninstaller.exe')}"`,
        'RequestExecutionLevel user', 'SilentInstall silent', 'SilentUnInstall silent',
        'Section', `  WriteUninstaller "${oldUninstaller}"`, 'SectionEnd',
        'Section "un.Uninstall"', '  RMDir /r "$INSTDIR"', 'SectionEnd', '',
    ], path.join(dir, 'old-uninstaller.nsi'));
    const compiled = compile([
        ...harnessHead('uninstallOldVersion', exe, buildDir, [`!addplugindir /x86-unicode "${plugins}"`,
            '!include "StdUtils.nsh"', templateFlags(['updated', 'delete-app-data']), ...DEFINES]),
        ...LANGUAGES,
        'LangString appCannotBeClosed ${LANG_ENGLISH} "cannot be closed"',
        'LangString uninstallFailed ${LANG_ENGLISH} "uninstall failed"',
        'Var installMode', 'Var appExe',
        ...STUB_REGISTRY,
        util.replace(readReg, ['!macro readReg VAR ROOT_KEY SUB_KEY NAME', '  Push "${ROOT_KEY} ${NAME}"',
            '  Call stubReadReg', '  Pop ${VAR}', '!macroend'].join('\n')),
        '!insertmacro customHeader',
        'Section',
        '  InitPluginsDir',
        '  ${GetParameters} $0',
        '  ${GetOptions} $0 "/MACHINE=" $1',
        '  ${GetOptions} $0 "/USER=" $2',
        '  ${GetOptions} $0 "/DATA=" $stubUserDataDir',
        '  ${GetOptions} $0 "/PATH=" $3',
        '  ${GetOptions} $0 "/STATE=" $stubStateFile',
        '  StrCpy $installMode "all"',
        '  StrCpy $stubMachineUninstall \'"$1\\Uninstall TFStudio.exe" /allusers\'',
        '  StrCpy $stubMachineVersion "1.8.5"',
        '  StrCpy $stubMachineLocation $1',
        '  StrCpy $stubUserUninstall \'"$2\\Uninstall TFStudio.exe" /currentuser\'',
        '  StrCpy $stubUserVersion "1.8.5"',
        '  StrCpy $stubUserLocation $2',
        '  ${If} $3 == "elevated"',
        '    Call prepareOldInstallsElevated',
        '  ${Else}',
        '    Call prepareOldInstalls',
        '    ${If} $oldInstallFailure != ""',
        '      Abort',
        '    ${EndIf}',
        '  ${EndIf}',
        // The current user's UninstallString as the step left it.
        '  FileOpen $5 "$stubStateFile" w',
        '  FileWrite $5 "$stubUserUninstall"',
        '  FileClose $5',
        '  !insertmacro uninstallOldVersion SHELL_CONTEXT',
        '  !insertmacro handleUninstallResult SHELL_CONTEXT',
        '  !insertmacro uninstallOldVersion HKEY_CURRENT_USER',
        '  !insertmacro handleUninstallResult HKEY_CURRENT_USER',
        'SectionEnd',
        '',
    ], path.join(dir, 'harness.nsi'));
    return { fake, compiled, exe, oldUninstaller };
}

async function templateRunCases(dir, buildDir) {
    const { fake, compiled, exe, oldUninstaller } = templateRunHarness(path.join(dir, 'harness'), buildDir);
    const { oldInstall, withData } = oldInstalls(dir);
    // An all-users install without a data folder and the current user's own
    // with one, both with an uninstaller that removes the whole folder; the
    // current user's uninstaller gone when GONE. The current user's
    // UninstallString as the step left it is in `entry`.
    const run = (name, runPath, gone) => {
        assertCompiled(fake);
        assertCompiled(compiled);
        if (!fs.existsSync(oldUninstaller)) spawnSync(path.join(dir, 'harness', 'write-old-uninstaller.exe'));
        const machine = oldInstall(`${name}-machine`);
        const user = withData(`${name}-user`, '.');
        for (const folder of [machine, user]) fs.copyFileSync(oldUninstaller, path.join(folder, 'Uninstall TFStudio.exe'));
        if (gone) fs.rmSync(path.join(user, 'Uninstall TFStudio.exe'));
        return { ...runFor(machine, user, runPath, name), machine, user };
    };
    const runFor = (machine, user, runPath, name) => {
        const state = path.join(dir, `${name}-entry.txt`);
        const status = runVerbatim(exe, [`/MACHINE=${machine}`, `/USER=${user}`, `/DATA=${path.join(dir, 'data')}`,
            `/STATE=${state}`, `/PATH=${runPath}`]);
        return { status, entry: read(state) };
    };
    for (const runPath of ['outer', 'elevated']) {
        const where = runPath === 'outer' ? 'installing for all users' : 'in the elevated instance';
        await check(`${where}, the all-users uninstaller is not run on the current user's folder after its old app is removed`, () => {
            const { status, machine, user } = run(`removed-${runPath}`, runPath, false);
            assert.equal(status, 0);
            assert.equal(fs.existsSync(machine), false, 'the all-users install, without a data folder, goes with its uninstaller');
            assert.deepEqual(changed(user, [...OLD_USER, ...DATA]), [], 'the current user\'s data folder is kept');
            assert.deepEqual(appLeft(user), [], 'and its old app is gone');
        });
        await check(`${where}, nor on the current user's folder when its uninstaller is gone`, () => {
            const { status, user, entry } = run(`gone-${runPath}`, runPath, true);
            assert.equal(status, 0);
            assert.equal(entry, '', 'its uninstall entry goes');
            assert.deepEqual(changed(user, [...OLD_USER, ...DATA]), [], 'the current user\'s data folder is kept');
        });
        // A drive mapped only in the user's own session, or unplugged: the
        // install folder is not there for this process.
        await check(`${where}, an install the installer cannot reach keeps its uninstall entry`, () => {
            const machine = oldInstall(`unreachable-${runPath}-machine`);
            fs.copyFileSync(oldUninstaller, path.join(machine, 'Uninstall TFStudio.exe'));
            const drive = path.join(dir, `unreachable-${runPath}-drive`);
            for (const file of DATA) write(path.join(drive, file), file);
            const { status, entry } = runFor(machine, path.join(drive, 'TFStudio'), runPath, `unreachable-${runPath}`);
            assert.equal(status, 0);
            assert.match(entry, /Uninstall TFStudio\.exe/, 'its uninstall entry stays');
            assert.deepEqual(changed(drive, DATA), [], 'and the data folder beside it is kept');
        });
    }
}

// ── Where the steps stand ────────────────────────────────────────────────────
async function placementCases() {
    const nsh = nshText();
    await check('both old installs are checked before either moves, and moved before either is deleted', () => {
        assertInOrder(functionText(nsh, 'prepareFoundOldInstalls'), ['selectOldInstall 1', 'Push $INSTDIR',
            'Call keepOldProfile', 'selectOldInstall 2', 'Push ""', 'Call keepOldProfile', 'selectOldInstall 1',
            'Call checkOldAppRemoval', 'selectOldInstall 2', 'Call checkOldAppRemoval', 'Call removeCheckedOldApps'],
        'prepareFoundOldInstalls');
        assertInOrder(functionText(nsh, 'removeCheckedOldApps'), ['Call moveOldApp', 'Call moveOldApp',
            'deleteMovedOldApp 1', 'deleteMovedOldApp 2', '${else}', 'restoreMovedOldApp 1', 'restoreMovedOldApp 2'],
        'removeCheckedOldApps');
    });
    await check('an uninstall entry that would run the wrong uninstaller goes, so that uninstallOldVersion returns first', () => {
        assertInOrder(template(path.join('include', 'installUtil.nsh')), ['readReg $uninstallString',
            '${if} $uninstallString == ""', 'Return', 'copyFile'], 'installUtil.nsh');
        assertInOrder(macroText(nsh, 'forgetOldInstall'), ['DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"',
            'DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY_2}"'], 'forgetOldInstall');
        assertInOrder(macroText(nsh, 'forgetCurrentUserEntry'), ['forgetOldInstall HKEY_CURRENT_USER',
            'DeleteRegKey HKEY_CURRENT_USER "${INSTALL_REGISTRY_KEY}"'], 'forgetCurrentUserEntry');
        assertInOrder(macroText(nsh, 'forgetPreparedOldInstalls'), ['$oldAppRemove1 == 1', 'forgetOldInstall ${ROOT_KEY}',
            '$oldAppRemove2 == 1', 'forgetCurrentUserInstall', '${elseIf} $oldEntryStale2 == 1', 'forgetCurrentUserEntry'],
        'forgetPreparedOldInstalls');
        assertInOrder(functionText(nsh, 'prepareOldInstalls'), ['Call prepareFoundOldInstalls', '$oldInstallFailure == ""',
            'forgetPreparedOldInstalls SHELL_CONTEXT'], 'prepareOldInstalls');
        assertInOrder(functionText(nsh, 'prepareOldInstallsElevated'), ['Call prepareFoundOldInstalls',
            'forgetPreparedOldInstalls HKEY_LOCAL_MACHINE'], 'prepareOldInstallsElevated');
    });
    await check('the current user\'s removed install loses what its own uninstaller would remove', () => {
        assertInOrder(template('uninstaller.nsh'), ['WinShell::UninstAppUserModelId', 'Delete "$oldDesktopLink"',
            'Delete "$oldStartMenuLink"', 'RMDir "$SMPROGRAMS\\$R1"', 'unregisterFileAssociations',
            'DeleteRegKey SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}"', 'DeleteRegKey SHELL_CONTEXT "${INSTALL_REGISTRY_KEY}"'],
        'uninstaller.nsh');
        assertInOrder(macroText(nsh, 'forgetCurrentUserInstall'), ['Call forgetCurrentUserFiles', 'forgetCurrentUserEntry'],
            'forgetCurrentUserInstall');
        assertInOrder(functionText(nsh, 'forgetCurrentUserFiles'), ['SetShellVarContext current', 'ShortcutName',
            'MenuDirectory', 'WinShell::UninstAppUserModelId', 'Delete "$DESKTOP\\$0.lnk"', 'Delete "$SMPROGRAMS\\$1\\$0.lnk"',
            'RMDir "$SMPROGRAMS\\$1"', '!insertmacro customUnInstall', 'appFileAssociations forgetCurrentUserAssociation',
            'SetShellVarContext all'], 'forgetCurrentUserFiles');
        assertInOrder(template(path.join('include', 'FileAssociation.nsh')), ['!macro APP_UNASSOCIATE',
            '"Software\\Classes\\.${EXT}\\OpenWithProgids" "${FILECLASS}"', '`Software\\Classes\\${FILECLASS}`'],
        'FileAssociation.nsh');
        assertInOrder(macroText(nsh, 'forgetCurrentUserAssociation'), [
            'DeleteRegValue HKEY_CURRENT_USER "Software\\Classes\\.${EXT}\\OpenWithProgids" "${FILECLASS}"',
            'DeleteRegKey HKEY_CURRENT_USER "Software\\Classes\\${FILECLASS}"'], 'forgetCurrentUserAssociation');
    });
}

// ── Running the cases ────────────────────────────────────────────────────────
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-old-app-'));
try {
    await placementCases();
    if (makensis && plugins) {
        const buildDir = await writeList(sandbox);
        await stepCases(path.join(sandbox, 'step'), buildDir);
        await templateRunCases(path.join(sandbox, 'template'), buildDir);
    } else {
        console.log('installer old app: no cached makensis or NSIS plugins, installer steps not run');
    }
} finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
}

finish('Installer old app');
