/**
 * What the installer tests share: the makensis electron-builder caches,
 * harnesses that compile the real build/installer.nsh with it, and reading the
 * script and electron-builder's NSIS template. run-all.mjs runs no file whose
 * name starts with an underscore.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { afterPack } from '../tools/install-folder-entries.mjs';

const require = createRequire(import.meta.url);
export const root = process.cwd();
export const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
export const templatesDir = path.join(root, 'node_modules', 'app-builder-lib', 'templates', 'nsis');
export const template = name => fs.readFileSync(path.join(templatesDir, name), 'utf8').replace(/\r\n/g, '\n');
export const nshText = () => fs.readFileSync(path.join(root, 'build', 'installer.nsh'), 'utf8').replace(/\r\n/g, '\n');

export const write = (file, text) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
};
export const read = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);

// The cases report every failure rather than stopping at the first.
const failures = [];
export async function check(name, run) {
    try {
        await run();
    } catch (error) {
        failures.push(name);
        console.error(`FAIL ${name}\n  ${error.message.split('\n').join('\n  ')}`);
    }
}
export function finish(what) {
    if (failures.length) {
        console.error(`${failures.length} ${what} case(s) failed.`);
        process.exit(1);
    }
    console.log(`${what} rules passed.`);
    process.exit(0);
}

// The text from `start` to the first `end` after it, or '' when there is none.
export function between(text, start, end) {
    const from = text.indexOf(start);
    if (from < 0) return '';
    const to = text.indexOf(end, from + start.length);
    return to < 0 ? '' : text.slice(from, to + end.length);
}
export const macroText = (text, name) => {
    const start = text.search(new RegExp(`!macro ${name}[ \\n]`));
    return start < 0 ? '' : between(text.slice(start), '!macro', '!macroend');
};
export const functionText = (text, name) => between(text, `Function ${name}\n`, 'FunctionEnd');
// Asserts that each of `parts` appears in `text`, in that order.
export function assertInOrder(text, parts, what) {
    let at = 0;
    for (const part of parts) {
        const found = text.indexOf(part, at);
        assert.ok(found >= 0, `${what}: "${part}" is missing or out of order`);
        at = found + part.length;
    }
}

export function findCached(prefix, relative) {
    const cache = process.env.ELECTRON_BUILDER_CACHE
        || path.join(process.env.LOCALAPPDATA || '', 'electron-builder', 'Cache');
    if (process.platform !== 'win32' || !fs.existsSync(cache)) return null;
    const candidates = fs.readdirSync(cache).filter(name => name.startsWith(prefix))
        .flatMap(versionDir => fs.readdirSync(path.join(cache, versionDir))
            .map(dist => path.join(cache, versionDir, dist, relative)));
    return candidates.find(file => fs.existsSync(file)) || null;
}
export const makensis = findCached('nsis-', 'makensis.exe');
// StdUtils, WinShell and the other plugins electron-builder's template calls.
export const plugins = findCached('nsis-resources-', path.join('plugins', 'x86-unicode'));

export function compile(lines, file) {
    fs.writeFileSync(file, lines.join('\r\n'));
    return spawnSync(makensis, ['-V2', '-INPUTCHARSET', 'UTF8', file], { encoding: 'utf8' });
}
export const assertCompiled = compiled =>
    assert.equal(compiled.status, 0, `makensis failed:\n${compiled.stdout}\n${compiled.stderr}`);

// A silent installer that includes the real build/installer.nsh where
// electron-builder does, ahead of the headers the template includes, with the
// list of entries in buildDir.
export function harnessHead(name, outFile, buildDir, defines, version = pkg.version) {
    return [
        'Unicode true',
        `!addincludedir "${path.join(templatesDir, 'include')}"`,
        `!define BUILD_RESOURCES_DIR "${buildDir}"`,
        `!define VERSION "${version}"`,
        ...defines,
        `!include "${path.join(root, 'build', 'installer.nsh')}"`,
        '!include "LogicLib.nsh"',
        '!include "FileFunc.nsh"',
        `Name "${name}"`,
        `OutFile "${outFile}"`,
        'RequestExecutionLevel user',
        'SilentInstall silent',
    ];
}

// The flags electron-builder's header defines, ${isUpdated} among them.
export function templateFlags(names) {
    const { NsisScriptGenerator } = require('app-builder-lib/out/targets/nsis/nsisScriptGenerator.js');
    const flags = new NsisScriptGenerator();
    flags.flags(names);
    return flags.build();
}

// The template's functions of these names in installUtil.nsh.
export function templateFunctions(names) {
    const util = template(path.join('include', 'installUtil.nsh'));
    return names.map((name) => {
        const text = functionText(util, name);
        assert.ok(text, `the template still has ${name}`);
        return text;
    });
}

// The app's four languages and German, which the app does not have, chosen
// with /LANG=.
export const LANGUAGES = [
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
];

// A harness that writes the text in $4 to the file named by /TEXT= and quits.
export const WRITE_TEXT = [
    '    FileOpen $5 "$3" w',
    '    FileWriteUTF16LE $5 "$4"',
    '    FileClose $5',
    '    Quit',
];

// The text a harness writes with /TEXT=, in the installer language lcid.
export function message(exe, lcid, options = []) {
    const out = path.join(path.dirname(exe), `message-${lcid}.txt`);
    spawnSync(exe, [`/LANG=${lcid}`, ...options, `/TEXT=${out}`]);
    return fs.readFileSync(out, 'utf16le');
}

// The app's four languages start their messages this way; German gets English.
export async function checkLanguages(name, exe, options, english, starts) {
    await check(name, () => {
        assert.equal(message(exe, 1033, options), english);
        for (const [lcid, start] of starts) {
            assert.ok(message(exe, lcid, options).startsWith(start), `language ${lcid} gets its own text`);
        }
        assert.equal(message(exe, 1031, options), english, 'a language the app does not have gets English');
    });
}

// The packed app folder of a build, as far as the installer can tell.
export const PACKED = [
    'TFStudio.exe', 'ffmpeg.dll', 'icudtl.dat', 'LICENSES.chromium.html', 'resources.pak', 'vulkan-1.dll',
    'locales/en-US.pak', 'locales/ru.pak',
    'resources/app.asar', 'resources/app-update.yml', 'resources/elevate.exe',
    'resources/app.asar.unpacked/build/app/index.html', 'resources/help/index.html',
];
export const tops = files => [...new Set(files.map(file => file.split('/')[0]))];
export const ASSOCIATIONS = [{ ext: '.tfs', name: 'TFStudio.Design' }];
export const packContext = (appOutDir, buildResourcesDir, electronPlatformName = 'win32') => ({
    electronPlatformName,
    appOutDir,
    packager: {
        appInfo: { productFilename: 'TFStudio', version: pkg.version },
        buildResourcesDir,
        fileAssociations: ASSOCIATIONS,
    },
});

// The list every harness compiles with, written by the build hook from a
// packed folder of PACKED; the folder it is in.
export async function writeList(dir) {
    for (const file of PACKED) write(path.join(dir, 'win-unpacked', file), file);
    const buildDir = path.join(dir, 'build');
    fs.mkdirSync(buildDir, { recursive: true });
    await afterPack(packContext(path.join(dir, 'win-unpacked'), buildDir));
    return buildDir;
}
