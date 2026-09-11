/**
 * A .tfs that parses but cannot be drawn must be refused, not handed over.
 *
 * The renderer reads design.substrate.material and maps design.frontLayers
 * without guarding either, so a design missing them throws during render and
 * takes the window white with nothing reported. Both readers are covered: the
 * picker and the file-manager double-click return the reason, and the tree
 * loader logs and skips so one bad file cannot take the workspace down.
 *
 * Run: node tests/design_shape_validation.mjs
 */
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const projects = require('../src/main/ipc/projects.js');

let passed = 0;
function ok(condition, message) {
    if (!condition) throw new Error(message);
    passed++;
}

const GOOD = { id: 'd1', name: 'AR', substrate: { material: 'BK7', thickness: 1 }, frontLayers: [], backLayers: [] };
const files = new Map();
const dirs = new Map();
const stats = new Map();
const logs = [];
const ctx = {
    path: path.posix,
    projectsDir: '/p',
    fs: {
        readFileSync(f) { if (!files.has(f)) throw new Error(`ENOENT: ${f}`); return files.get(f); },
        readdirSync(d, opts) {
            const names = dirs.get(d) || [];
            if (!opts || !opts.withFileTypes) return names;
            return names.map(n => ({
                name: n,
                isFile: () => !dirs.has(`${d}/${n}`),
                isDirectory: () => dirs.has(`${d}/${n}`),
                isSymbolicLink: () => false,
            }));
        },
        statSync(f) { return { mtimeMs: stats.get(f) ?? 1 }; },
        existsSync(p) { return dirs.has(p) || files.has(p); },
    },
    log(m) { logs.push(m); },
};
const handlers = new Map();
projects.register({ handle(c, h) { handlers.set(c, h); } }, ctx);
const open = (f) => handlers.get('open-tfs-path')(null, f);

// -- What the open path accepts and refuses ----------------------------------
const put = (name, obj) => { files.set(`/out/${name}.tfs`, JSON.stringify(obj)); return `/out/${name}.tfs`; };

{
    const res = await open(put('good', GOOD));
    ok(res.success === true, 'a complete design opens');
}
{
    // The exact file that caused the white screen: written by hand, no substrate.
    const res = await open(put('stub', { id: 'x', name: 'icon test' }));
    ok(res.success === false && /substrate material/i.test(res.error),
        'a design with no substrate is refused, naming the substrate as the reason');
}
{
    for (const [label, substrate] of [
        ['null', null],
        ['a string', 'BK7'],
        ['an array', ['BK7']],
        ['an object with no material', { thickness: 1 }],
        ['a non-string material', { material: 42 }],
        ['a blank material', { material: '   ' }],
    ]) {
        const res = await open(put(`sub-${label.replace(/\W/g, '')}`, { ...GOOD, substrate }));
        ok(res.success === false, `a substrate that is ${label} is refused`);
    }
}
{
    const res = await open(put('strlayers', { ...GOOD, frontLayers: 'SiO2' }));
    ok(res.success === false && /frontLayers/.test(res.error),
        'a layer list that is not a list is refused, naming the side');
    const back = await open(put('numlayers', { ...GOOD, backLayers: 7 }));
    ok(back.success === false && /backLayers/.test(back.error), 'the back side is checked too');
    const inner = await open(put('badlayer', { ...GOOD, frontLayers: [{ material: 'SiO2' }, 'SiO2'] }));
    ok(inner.success === false && /not a layer/.test(inner.error),
        'a layer entry that is not an object is refused');
}
{
    // A bare substrate is written with empty arrays, so absent ones are filled
    // in rather than refused: nothing is being guessed.
    const res = await open(put('bare', { id: 'd2', name: 'Bare', substrate: { material: 'BK7' } }));
    ok(res.success === true, 'a design with no layer arrays still opens');
    ok(Array.isArray(res.design.frontLayers) && res.design.frontLayers.length === 0,
        'the missing front layers are filled in as empty');
    ok(Array.isArray(res.design.backLayers) && res.design.backLayers.length === 0,
        'the missing back layers are filled in as empty');
}
{
    const res = await open(put('arr', []));
    ok(res.success === false && /not a valid TFStudio design/.test(res.error),
        'a JSON array is still refused ahead of the shape checks');
}

// -- What the tree loader does with the same file ----------------------------
{
    dirs.set('/p', ['My Designs']);
    dirs.set('/p/My Designs', ['good.tfs', 'stub.tfs', 'nolayers.tfs']);
    files.set('/p/My Designs/good.tfs', JSON.stringify(GOOD));
    files.set('/p/My Designs/stub.tfs', JSON.stringify({ id: 'x', name: 'icon test' }));
    files.set('/p/My Designs/nolayers.tfs', JSON.stringify({ id: 'd3', name: 'Bare', substrate: { material: 'BK7' } }));

    logs.length = 0;
    const res = await handlers.get('load-folders')();
    ok(res.success === true, 'the tree still loads');
    const folder = res.folders.find(f => f.id === 'My Designs');
    const names = folder.items.map(i => i.name).sort();
    ok(names.join() === 'AR,Bare',
        'the good design and the bare substrate are in the tree, the stub is not');
    ok(logs.some(m => /stub\.tfs/.test(m) && /substrate/i.test(m)),
        'the skipped file is logged with its reason rather than dropped silently');
    ok(folder.items.every(i => Array.isArray(i.design.frontLayers)),
        'every design that reaches the tree has layer arrays the renderer can map');
}

console.log(`design_shape_validation: ${passed} passed`);
