/**
 * Rules that keep the portable build cheap to launch.
 *
 * The portable executable is a self-extracting archive. Its stub unpacks the
 * entire payload into a temporary directory, runs the app from there, and
 * deletes the directory again on exit. Everything shipped is therefore written
 * to disk on every single launch, so payload size and file count are startup
 * cost, not just download size, and nothing written beside the running
 * executable survives the session.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules, createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveExeDir } = require('../src/main/paths.js');
const root = process.cwd();
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

// ── Where the app keeps its data ─────────────────────────────────────────────
assert.equal(
    resolveExeDir({
        portableDir: '/media/usb/tfstudio', isPackaged: true,
        execPath: '/tmp/unpacked/TFStudio.exe', appPath: '/tmp/unpacked/resources/app.asar',
    }),
    '/media/usb/tfstudio',
    'a portable launch keeps its data beside the real executable, not in the temp copy that is deleted on exit');
assert.equal(
    resolveExeDir({
        portableDir: undefined, isPackaged: true,
        execPath: '/opt/TFStudio/TFStudio.exe', appPath: '/opt/TFStudio/resources/app.asar',
    }),
    '/opt/TFStudio',
    'an installed build keeps its data beside its executable');
assert.equal(
    resolveExeDir({
        portableDir: '', isPackaged: false,
        execPath: '/usr/bin/node', appPath: '/repo/TFStudio',
    }),
    '/repo/TFStudio',
    'a dev run keeps its data in the project directory');

// ── Nothing ships that the packaged app never loads ──────────────────────────
// electron-builder copies every production dependency into app.asar, and
// getNodeModuleFileMatcher ignores positive patterns in build.files, so the only
// way to keep a package out is to not declare it a production dependency (or to
// exclude it with a "!" pattern). The renderer's libraries are bundled into
// build/app/ by tools/build-renderer.mjs and are build inputs, not runtime
// dependencies: declaring them under "dependencies" shipped a second, unused
// copy of each and inflated app.asar roughly tenfold.
function mainProcessSources(dir, found = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) mainProcessSources(full, found);
        else if (entry.name.endsWith('.js')) found.push(full);
    }
    return found;
}

// Exactly the sources build.files ships for the main process.
const packagedSources = [
    path.join(root, 'src', 'main.js'),
    path.join(root, 'src', 'preload.js'),
    ...mainProcessSources(path.join(root, 'src', 'main')),
];
const builtins = new Set(builtinModules);
const requiredAtRuntime = new Set();
for (const file of packagedSources) {
    for (const [, id] of fs.readFileSync(file, 'utf8').matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
        if (id.startsWith('.') || id === 'electron') continue;
        if (builtins.has(id.replace(/^node:/, ''))) continue;
        requiredAtRuntime.add(id.split('/')[0]);
    }
}

const excludedFromAsar = new Set(
    (pkg.build.files || [])
        .filter(pattern => typeof pattern === 'string' && pattern.startsWith('!node_modules/'))
        .map(pattern => pattern.slice('!node_modules/'.length).split('/')[0]));

for (const dep of Object.keys(pkg.dependencies || {})) {
    assert.ok(requiredAtRuntime.has(dep) || excludedFromAsar.has(dep),
        `"${dep}" is a production dependency the packaged main process never requires, so it is ` +
        'copied into app.asar unused. Move it to devDependencies if it is a build input, or ' +
        'exclude it with "!node_modules/<name>/**/*" in build.files.');
}
for (const dep of requiredAtRuntime) {
    assert.ok(pkg.dependencies?.[dep],
        `"${dep}" is required by the packaged main process, so it must stay a production ` +
        'dependency; as a devDependency it is not packaged and the app fails at runtime.');
}
assert.ok(requiredAtRuntime.has('js-yaml'), 'the RII handler still parses YAML in the main process');

// ── Chromium locale packs ────────────────────────────────────────────────────
// Electron ships 55 of them, 27 MB, and the app has three languages.
assert.deepEqual(pkg.build.electronLanguages, ['en-US', 'ru', 'zh-CN'],
    'only the locales the app actually offers are packaged');

// ── The splash ───────────────────────────────────────────────────────────────
// The stub splash is what appears the instant the exe starts, so the launch is
// never silent. It comes at a price the stock template does not pay for:
// splashImage takes the stub out of silent mode, and its installer dialog then
// flashes at launch and reappears as "Setup: Completed" while the payload is
// deleted after the app exits (seen on hardware, 2026-08-30). The forked
// template parks that dialog off-screen, and the fork only takes effect
// because the build runner installs it over the stock one — electron-builder
// has no custom-script option for the portable target. All three pieces have
// to be present together.
assert.equal(pkg.build.portable?.splashImage, 'build/splash.bmp',
    'the stub shows a splash the moment the exe starts');
assert.ok(fs.existsSync(path.join(root, 'assets', 'splash.png')),
    'assets/splash.png is the artwork the splashes are rendered from');

const fork = fs.readFileSync(path.join(root, 'build', 'portable.nsi'), 'utf8');
assert.match(fork, /SetWindowPos\(p \$HWNDPARENT, p 0, i -32000, i -32000/,
    'the forked template parks the stub dialog off-screen');
assert.match(fork, /AddBrandingImage top \$\{ART_H\}/,
    'the artwork rides in a branding strip inside the dialog itself');
assert.match(fork, /SetBrandingImage \/RESIZETOFIT/, 'the artwork is fitted to the strip');

// SetBrandingImage resamples with a plain StretchBlt, which visibly softens the
// artwork. It only stays sharp because the card is sized to the bitmap exactly,
// making the blit 1:1 — so the stub's geometry and the generator's output size
// have to agree.
const defineOf = name => Number(fork.match(new RegExp(`!define ${name}\\s+(\\d+)`))?.[1]);
const cardW = defineOf('CARD_W');
const artH = defineOf('ART_H');
assert.ok(cardW > 0 && artH > 0, 'the card geometry is defined in pixels');
const splashSource = fs.readFileSync(path.join(root, 'tools', 'gen-splash.mjs'), 'utf8');
assert.equal(Number(splashSource.match(/const BMP_W = (\d+)/)?.[1]), cardW,
    'the generated BMP is exactly as wide as the card, so it blits 1:1');
assert.equal(Math.round(cardW / 1.5), artH,
    'the artwork area keeps the 3:2 of the source, so nothing is stretched');
assert.match(fork, /InstProgressFlags smooth/,
    'extraction progress is the dialog’s own byte-accurate bar, drawn smooth');
assert.match(fork, /ManifestDPIAware true/,
    'without a DPI-aware manifest the splash is bitmap-stretched blurry on scaled displays');
assert.ok(fork.indexOf('HideWindow') < fork.indexOf('ExecWait') && fork.includes('HideWindow'),
    'the dialog is hidden before the app starts, so its Completed state is never seen');

const { installPortableTemplate } = await import('../tools/run-electron-builder.mjs');
{
    const writes = [];
    const result = installPortableTemplate({
        readFileSync: p => (String(p).includes('portable.nsi') && !String(p).startsWith(root) ? 'STOCK' : fork),
        writeFileSync: (p, content) => writes.push({ p, content }),
        source: path.join(root, 'build', 'portable.nsi'),
        target: '/fake/app-builder-lib/templates/nsis/portable.nsi',
    });
    assert.equal(result.updated, true, 'a stock template is replaced');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].content, fork, 'the runner installs the fork verbatim');
}
{
    const result = installPortableTemplate({
        readFileSync: () => fork,
        writeFileSync: () => { throw new Error('must not rewrite an up-to-date template'); },
        source: path.join(root, 'build', 'portable.nsi'),
        target: '/fake/app-builder-lib/templates/nsis/portable.nsi',
    });
    assert.equal(result.updated, false, 'an already-installed fork is left alone');
}
const runner = fs.readFileSync(path.join(root, 'tools', 'run-electron-builder.mjs'), 'utf8');
assert.match(runner, /installPortableTemplate\(\);/,
    'every build goes through the template install');

if (fs.existsSync(path.join(root, 'build', 'splash.bmp'))) {
    // NSIS BgImage accepts only an uncompressed 24-bit BMP.
    const bmp = fs.readFileSync(path.join(root, 'build', 'splash.bmp'));
    assert.equal(bmp.toString('ascii', 0, 2), 'BM', 'the stub splash is a BMP');
    assert.equal(bmp.readUInt16LE(28), 24, 'the stub splash is 24-bit');
    assert.equal(bmp.readUInt32LE(30), 0, 'the stub splash is uncompressed');
    assert.equal(bmp.readUInt32LE(2), bmp.length, 'the stub splash header length matches the file');
    assert.equal(bmp.readInt32LE(18), cardW, 'the stub splash is exactly the card width');
    assert.equal(bmp.readInt32LE(22), artH, 'the stub splash is exactly the artwork height');
}

// The card is assembled from NSIS dialog controls addressed by numeric id, and
// GetDlgItem returns 0 for an id that is not there rather than failing: a wrong
// id is a silent no-op that ships a mislaid splash. 1033 is the branding image
// and 1004 the progress bar, both confirmed by enumerating the dialog.
assert.match(fork, /GetDlgItem \$1 \$HWNDPARENT 1033/,
    'the artwork is placed into the branding image control (id 1033, not 1046)');
assert.match(fork, /GetDlgItem \$2 \$0 1004/, 'the bar is the page dialog’s progress control');

// NSIS lays the page out after .onGUIInit returns, undoing anything positioned
// there, so the card has to be assembled in the page callback.
assert.ok(fork.indexOf('Function layoutSplash') < fork.indexOf('GetDlgItem $1 $HWNDPARENT 1033'),
    'the artwork is placed in the page callback, not in .onGUIInit');

// The card is sized by measuring the window-vs-client difference, which is only
// the real frame once SWP_FRAMECHANGED (0x0020) has been applied after the
// style strip. Measuring first sizes against the frame the window no longer has.
const frameChanged = fork.indexOf('i 0x0037)');
const firstMeasure = fork.indexOf('GetWindowRect(p $HWNDPARENT');
assert.ok(frameChanged > 0 && frameChanged < firstMeasure,
    'the frame is recalculated before it is measured');

console.log('Portable build rules passed.');
