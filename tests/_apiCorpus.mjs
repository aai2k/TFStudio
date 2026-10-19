/**
 * Test helper for api_corpus.mjs: the design-file corpus (tests/fixtures/
 * designs/, design_file_corpus.golden.json) and what the headless API shows
 * for a fixture, in the golden file's shape.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = await import('../src/api/index.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, 'fixtures', 'designs');
export const golden = JSON.parse(fs.readFileSync(path.join(HERE, 'design_file_corpus.golden.json'), 'utf8')).cases;
export const manifest = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'));

/** The .tfs file of fixture `name`. */
export function fixtureFile(name) {
    const dir = path.join(FIXTURES, name);
    return path.join(dir, fs.readdirSync(dir).find(file => file.endsWith('.tfs')));
}

/** The name `file` holds, or its base name when it holds none, as File > Open names a design. */
export function ownName(file) {
    const held = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\u0000/g, '') || '{}').name;
    return (held && String(held).trim()) || path.basename(file, '.tfs');
}

// A number as the golden file stores it.
const num = x => (typeof x !== 'number' ? x ?? null : Number.isFinite(x) ? Number(x.toPrecision(12)) : String(x));

function spectrumOf(design, fixture) {
    const [from, to, step] = fixture.spectrum;
    const s = api.spectrum(design, { from, to, step, angles: fixture.angles });
    const angles = {};
    for (const [angle, series] of Object.entries(s.angles)) {
        angles[angle] = Object.fromEntries(Object.entries(series).map(([q, values]) => [q, values.map(num)]));
    }
    return { evalMode: s.evalMode, spectrum: { lambda: s.lambda.map(num), angles } };
}

function meritOf(design) {
    if (!(design.meritOperands || []).length) return null;
    const m = api.merit(design);
    return {
        rows: m.rows.map(r => ({ type: r.type, value: num(r.value), ...(r.error ? { error: r.error } : {}) })),
        mf: num(m.total), omf: num(m.optical),
    };
}

/**
 * What the API shows for `design`, in the golden entry `expected`'s shape. A
 * spectrum the app blocks on materials that resolve to nothing is taken from
 * the golden entry; api_corpus.mjs checks the API refuses it.
 */
export function apiValues(design, fixture, expected) {
    const materials = {};
    for (const [id, entry] of Object.entries(expected.materials)) {
        if (entry.status === 'missing') continue;
        materials[id] = api.materialNK(id, fixture.nk, design).nk.map(({ wavelength, n, k }) => [wavelength, num(n), num(k)]);
    }
    const blocked = expected.spectrum.blocked;
    const shown = blocked ? { evalMode: expected.design.evalMode, spectrum: expected.spectrum } : spectrumOf(design, fixture);
    return {
        design: {
            evalMode: shown.evalMode, surfaceMode: design.surfaceMode ?? null,
            frontLayers: design.frontLayers.length, backLayers: design.backLayers.length, operands: (design.meritOperands || []).length,
        },
        materials, spectrum: shown.spectrum, merit: meritOf(design),
    };
}

/**
 * The part of golden entry `entry` the API shows. The app names a design in its
 * Projects tree after the file it sits in; File > Open, and the API, keep the
 * name the design holds, so the name and id are left out.
 */
export function expectedValues(entry) {
    const design = Object.fromEntries(Object.entries(entry.design).filter(([key]) => key !== 'name' && key !== 'id'));
    const materials = Object.fromEntries(Object.entries(entry.materials).filter(([, m]) => m.status !== 'missing').map(([key, m]) => [key, m.nk]));
    return { design, materials, spectrum: entry.spectrum, merit: entry.merit };
}
