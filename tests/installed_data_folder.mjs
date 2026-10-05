/**
 * Where an installed build keeps its data, and the installer step that carries
 * an older install's data there.
 *
 * userData holds the Chromium profile, whose localStorage is the session of
 * unsaved designs, and settings.json. An installer update runs the previous
 * version's uninstaller, which deletes the install folder, so an installed
 * build must keep userData outside it. Releases up to 1.8.3 kept it in AppData
 * inside the install folder; build/installer.nsh copies that folder to the new
 * place before the old uninstaller runs.
 *
 * The installer part compiles the real build/installer.nsh with the makensis
 * electron-builder caches and runs the copy step on throwaway folders. Where
 * that makensis is not present (not Windows, no installer built yet) the part
 * is left out and said so.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveUserDataDir } = require('../src/main/userDataDir.js');
const root = process.cwd();

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

// The installer copies into the folder the app reads.
const nsh = fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8');
assert.ok(nsh.includes(`!insertmacro keepInstallData "$oldInstallDir" "$APPDATA\\${path.basename(installed)}"`),
    'build/installer.nsh copies the old AppData into the folder resolveUserDataDir names');

// ── The installer step ───────────────────────────────────────────────────────
function findMakensis() {
    if (process.platform !== 'win32') return null;
    const cache = process.env.ELECTRON_BUILDER_CACHE
        || path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
    if (!fs.existsSync(cache)) return null;
    for (const versionDir of fs.readdirSync(cache).filter(name => name.startsWith('nsis-'))) {
        const versionPath = path.join(cache, versionDir);
        for (const dist of fs.readdirSync(versionPath)) {
            const exe = path.join(versionPath, dist, 'makensis.exe');
            if (fs.existsSync(exe)) return exe;
        }
    }
    return null;
}

const makensis = findMakensis();
if (!makensis) {
    console.log('installed data folder: no cached makensis, installer step not run');
    console.log('Installed data folder rules passed.');
    process.exit(0);
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'tfs-installer-'));
try {
    const harness = path.join(sandbox, 'harness.nsi');
    const exe = path.join(sandbox, 'harness.exe');
    const includeDir = path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis', 'include');
    fs.writeFileSync(harness, [
        'Unicode true',
        `!addincludedir "${includeDir}"`,
        '!include "LogicLib.nsh"',
        '!include "FileFunc.nsh"',
        '!define INSTALL_REGISTRY_KEY "Software\\TFStudio installer test"',
        `!include "${path.join(root, 'build', 'installer.nsh')}"`,
        'Name "keepInstallData"',
        `OutFile "${exe}"`,
        'RequestExecutionLevel user',
        'SilentInstall silent',
        'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\English.nlf"',
        'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\Russian.nlf"',
        'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\SimpChinese.nlf"',
        'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\Italian.nlf"',
        'LoadLanguageFile "${NSISDIR}\\Contrib\\Language files\\German.nlf"',
        'Function .onInit',
        '  ${GetParameters} $0',
        '  ClearErrors',
        '  ${GetOptions} $0 "/LANG=" $1',
        '  ${IfNot} ${Errors}',
        '    StrCpy $LANGUAGE $1',
        '  ${EndIf}',
        'FunctionEnd',
        'Section',
        '  ${GetParameters} $0',
        '  ClearErrors',
        '  ${GetOptions} $0 "/TEXT=" $3',
        '  ${IfNot} ${Errors}',
        '    !insertmacro keepDataFailedText $4',
        '    FileOpen $5 "$3" w',
        '    FileWriteUTF16LE $5 "$4"',
        '    FileClose $5',
        '    Quit',
        '  ${EndIf}',
        '  ${GetOptions} $0 "/OLD=" $1',
        '  ${GetOptions} $0 "/DATA=" $2',
        // The installer reaches the step with the error flag set when the
        // registry has no InstallLocation; the step must not read it as a failure.
        '  SetErrors',
        '  !insertmacro keepInstallData "$1" "$2"',
        'SectionEnd',
        '',
    ].join('\r\n'));
    const compiled = spawnSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', harness], { encoding: 'utf8' });
    assert.equal(compiled.status, 0, `makensis failed:\n${compiled.stdout}\n${compiled.stderr}`);

    const write = (file, text) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, text);
    };
    const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
    const run = (oldDir, dataDir) =>
        spawnSync(exe, [`/OLD=${oldDir}`, `/DATA=${dataDir}`], { encoding: 'utf8' }).status;
    const log = (dir, name = '000003.log') => path.join(dir, 'Local Storage', 'leveldb', name);
    const oldInstall = (name) => {
        const dir = path.join(sandbox, name, 'install');
        write(log(path.join(dir, 'AppData')), 'session of the old version');
        write(path.join(dir, 'AppData', 'settings.json'), '{"folders":{"root":"E:\\\\Coatings"}}');
        return dir;
    };

    {
        const oldDir = oldInstall('fresh');
        const dataDir = path.join(sandbox, 'fresh', 'Roaming', 'TFStudio');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'session of the old version', 'the session is copied');
        assert.equal(read(path.join(dataDir, 'settings.json')), '{"folders":{"root":"E:\\\\Coatings"}}',
            'settings.json, with the chosen data folder, is copied');
        assert.equal(read(log(path.join(oldDir, 'AppData'))), 'session of the old version',
            'the old folder is left for the old uninstaller, not moved');
    }
    {
        const oldDir = oldInstall('downgraded');
        const dataDir = path.join(sandbox, 'downgraded', 'Roaming', 'TFStudio');
        write(log(dataDir, '000005.log'), 'profile of a newer build');
        write(log(`${dataDir}.old`, '000001.log'), 'two updates ago');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'session of the old version', 'the old install, used last, wins');
        assert.equal(read(log(dataDir, '000005.log')), null, 'the two profiles are not mixed');
        assert.equal(read(log(`${dataDir}.old`, '000005.log')), 'profile of a newer build',
            'the profile that was there is kept aside');
        assert.equal(read(log(`${dataDir}.old`, '000001.log')), null, 'only the latest profile is kept aside');
    }
    {
        const oldDir = path.join(sandbox, 'unused', 'install');
        write(path.join(oldDir, 'AppData', 'settings.json'), '{}');
        const dataDir = path.join(sandbox, 'unused', 'Roaming', 'TFStudio');
        write(log(dataDir), 'profile in use');
        assert.equal(run(oldDir, dataDir), 0);
        assert.equal(read(log(dataDir)), 'profile in use',
            'an old AppData the old version never ran from (no Local Storage) changes nothing');
        assert.equal(fs.existsSync(`${dataDir}.old`), false);
    }
    {
        const oldDir = oldInstall('partial');
        const dataDir = path.join(sandbox, 'partial', 'Roaming', 'TFStudio');
        write(path.join(dataDir, 'Crashpad', 'settings.dat'), 'crash reporter state');
        assert.equal(run(oldDir, dataDir), 0, 'a data folder that exists without a profile takes the copy');
        assert.equal(read(log(dataDir)), 'session of the old version');
    }
    {
        const oldDir = oldInstall('blocked');
        const blocker = path.join(sandbox, 'blocked', 'Roaming');
        write(blocker, 'a file where the folder should be');
        assert.notEqual(run(oldDir, path.join(blocker, 'TFStudio')), 0,
            'a copy that cannot be made stops the install before the old uninstaller runs');
        assert.equal(read(log(path.join(oldDir, 'AppData'))), 'session of the old version');
    }

    // The message for a stopped install, in the installer's language.
    const message = (lcid) => {
        const out = path.join(sandbox, `message-${lcid}.txt`);
        spawnSync(exe, [`/LANG=${lcid}`, `/TEXT=${out}`]);
        return fs.readFileSync(out, 'utf16le');
    };
    const english = message(1033);
    assert.match(english, /^The update was stopped and nothing was removed/);
    for (const [lcid, start] of [[1049, 'Обновление остановлено'], [2052, '更新已停止'], [1040, "L'aggiornamento"]]) {
        assert.ok(message(lcid).startsWith(start), `language ${lcid} gets its own text`);
    }
    assert.equal(message(1031), english, 'a language the app does not have gets English, not an empty box');
} finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
}

console.log('Installed data folder rules passed.');
