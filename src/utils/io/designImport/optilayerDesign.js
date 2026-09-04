/**
 * optilayerDesign.js: OptiLayer design (.dsg) reader.
 *
 * A .dsg file is JSON:
 *   { VERSION, name, comment, controlW, matchAngle, matchMedium,
 *     layers: [{ abbr, qwot_thickness, status, zn_re, zn_im, … }] }
 * Layer 1 is next to the substrate. qwot_thickness is the layer's thickness
 * in quarter waves of the control wavelength, defined at the match angle in
 * the match medium; zn_re and zn_im are the layer material's n and −k at the
 * control wavelength. The physical thickness is therefore in the file:
 *   d = qwot λc / (4 n cos θ),   sin θ = n_match sin(matchAngle) / n,   n = zn_re
 * Checked against the program's own numbers: the total optical thickness it
 * writes into the design comment (Σ qwot λc/4 at normal incidence and
 * Σ qwot λc/(4 cos θ) at 45°), and the 0.7 nm NiCr and 11 and 15 nm silver
 * layers its help states for the low-E example. A layer whose index is below
 * n_match sin(matchAngle) carries an evanescent wave at the match angle and
 * has no real cos θ; such a layer is converted at normal incidence and the
 * design's notes say so.
 *
 * Materials are named by abbreviation only; the problem folder supplies the
 * rest. OptiLayer.olproj, an INI file, names the incident and exit medium,
 * sometimes the substrate and the abbreviation map (Abbr2Material). The
 * folder's .lm and .sub files are the materials themselves. An abbreviation
 * the map does not cover is matched to a .lm file of that name, else
 * identified by its index: the .lm whose n,k at the control wavelength equal
 * the stored pair (OptiLayer holds the end value past a table's range, so
 * that case matches too). Media and the substrate are matched to .sub files
 * by name. Identified files are handed over as `embedded` entries so the
 * design carries the definitions it was computed with.
 *
 * The back surface of the substrate is an option in OptiLayer (Back Side
 * Options in its help) that the project file does not record, so the
 * substrate is imported semi-infinite, the program's default; the exit
 * medium is kept for the design's total mode.
 *
 * A few tutorial designs store no index at all (zn_re null); their layers
 * keep the quarter-wave value, with the match angle, and take their
 * thickness from whichever material the user assigns.
 *
 * Rugate (graded-index) layers have no equivalent in TFStudio; a design that
 * contains one is refused.
 */

import { parseOptiLayerFile } from '../../materials/optilayerParser.js';
import { makeGetNK } from '../../materials/catalogManager/dispersion.js';

// Relative distance in n (plus absolute distance in k) within which a folder
// material counts as the one a layer was computed with. The stored pair is
// the program's own interpolation; TFStudio's differs in the last digits
// between grid points.
const INDEX_TOLERANCE = 2e-3;

const num = v => (v == null || v === '') ? NaN : Number(v);

/**
 * Physical thickness in nm of a layer given in quarter waves at the match
 * angle: d = qwot λ / (4 n cos θ) with sin θ = n_match sin(angle) / n.
 * Null when the wave is evanescent in the layer at that angle (n below
 * n_match sin(angle)), which leaves no real thickness to compute.
 */
export function qwotToNm(qwot, lambdaNm, n, angleDeg = 0, matchMedium = 1) {
    if (!(n > 0)) return null;
    const s = (matchMedium || 1) * Math.sin((angleDeg || 0) * Math.PI / 180) / n;
    const cos2 = 1 - s * s;
    if (!(cos2 > 0)) return null;
    return qwot * lambdaNm / (4 * n * Math.sqrt(cos2));
}

// ── OptiLayer.olproj ──────────────────────────────────────────────────────────

// An INI value written as "…" carries \" \n \\ escapes.
function unquote(value) {
    const v = value.trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
        return v.slice(1, -1).replace(/\\(["\\n])/g, (m, ch) => ch === 'n' ? '\n' : ch);
    }
    return v;
}

/** Sections of an OptiLayer project file as { section: { key: value } }; values unquoted. */
export function parseOptiLayerProject(text) {
    const sections = Object.create(null);
    let current = sections[''] = Object.create(null);
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith(';') || line.startsWith('#')) continue;
        const section = /^\[(.+)\]$/.exec(line);
        if (section) { current = sections[section[1]] = sections[section[1]] || Object.create(null); continue; }
        const eq = line.indexOf('=');
        if (eq > 0) current[line.slice(0, eq).trim()] = unquote(line.slice(eq + 1));
    }
    return sections;
}

function projectValue(project, key) {
    for (const section of Object.values(project)) if (section[key] != null && section[key] !== '') return section[key];
    return null;
}

function jsonValue(text) {
    try { return JSON.parse(text); } catch (_) { return null; }
}

// ── Folder materials ──────────────────────────────────────────────────────────

function readSiblings(siblings) {
    const out = [];
    for (const file of siblings || []) {
        const ext = String(file.ext || '').toLowerCase();
        if (ext !== 'lm' && ext !== 'sub') continue;
        try {
            const entry = parseOptiLayerFile(file.text, `${file.name}.${ext}`);
            out.push({ name: file.name, ext, entry, getNK: makeGetNK(entry) });
        } catch (_) { /* a file the material reader refuses is not offered */ }
    }
    return out;
}

function findByName(files, name, ext) {
    const q = String(name || '').trim().toLowerCase();
    if (!q) return null;
    return files.find(f => (!ext || f.ext === ext) && (f.name.toLowerCase() === q || String(f.entry.name || '').toLowerCase() === q)) || null;
}

// The .lm whose n,k at the control wavelength are the layer's stored pair.
function findByIndex(files, n, k, lambdaNm) {
    let best = null;
    for (const f of files) {
        if (f.ext !== 'lm') continue;
        const [fn, fk] = f.getNK(lambdaNm);
        const score = Math.abs(fn - n) / n + Math.abs(fk - k) / (1 + k);
        if (score < INDEX_TOLERANCE && (!best || score < best.score)) best = { file: f, score };
    }
    return best ? best.file : null;
}

const fmt = v => String(Number(v.toPrecision(7)));

function rangeOf(values) {
    let lo = Infinity, hi = -Infinity;
    for (const v of values) { if (v < lo) lo = v; if (v > hi) hi = v; }
    return [lo, hi];
}

/**
 * @param {string} text      .dsg content
 * @param {string} fileName  used for the design name and messages
 * @param {{ projectText?: string, siblings?: Array<{ name, ext, text }> }} [opts]
 *        the folder's OptiLayer.olproj and its .lm / .sub files
 * @returns {object} imported-design description (see designFileImport.js)
 */
export function parseOptiLayerDesign(text, fileName, opts = {}) {
    let dsg;
    try { dsg = JSON.parse(text); } catch (e) { throw new Error(`"${fileName}" is not an OptiLayer design file`); }
    if (!dsg || !Array.isArray(dsg.layers) || !(num(dsg.controlW) > 0)) throw new Error(`"${fileName}" is not an OptiLayer design file`);
    if (dsg.layers.length === 0) throw new Error(`"${fileName}" has no layers`);
    if (dsg.layers.some(l => l && l.rugate_parametrization)) {
        throw new Error(`"${fileName}" contains a rugate (graded-index) layer, which TFStudio does not model`);
    }

    const lambdaNm = num(dsg.controlW);
    const matchAngle = num(dsg.matchAngle) || 0;
    const matchMedium = num(dsg.matchMedium) > 0 ? num(dsg.matchMedium) : 1;
    const project = parseOptiLayerProject(opts.projectText);
    const files = readSiblings(opts.siblings);
    const notes = [];
    const embedded = Object.create(null);
    const constants = Object.create(null);

    // Abbreviation → material name: the project's map, else a folder file of
    // that name, else the folder file with the layer's index, else a constant
    // at the control wavelength, else the abbreviation itself.
    const abbrMap = jsonValue(projectValue(project, 'Abbr2Material') || '') || {};
    const nameOf = new Map();
    const materialFor = (layer) => {
        const abbr = String(layer.abbr ?? '');
        const n = num(layer.zn_re), k = -num(layer.zn_im) || 0;
        const key = `${abbr}|${n}|${k}`;
        if (nameOf.has(key)) return nameOf.get(key);
        let name = null;
        const mapped = Object.hasOwn(abbrMap, abbr) ? (Array.isArray(abbrMap[abbr]) ? abbrMap[abbr][0] : abbrMap[abbr]) : null;
        if (typeof mapped === 'string' && mapped) {
            name = mapped;
            const file = findByName(files, mapped, 'lm');
            if (file) embedded[name] = file.entry;
        } else {
            const file = findByName(files, abbr, 'lm') || (n > 0 ? findByIndex(files, n, k, lambdaNm) : null);
            if (file) { name = file.name; embedded[name] = file.entry; }
        }
        if (!name && n > 0) {
            name = `${abbr || 'layer'} (n = ${fmt(n)}${k ? `, k = ${fmt(k)}` : ''} at ${lambdaNm} nm)`;
            constants[name] = { n, k };
        }
        if (!name) name = abbr || 'layer';
        nameOf.set(key, name);
        return name;
    };

    // Quarter waves at the match angle in the match medium → physical nm. A
    // layer without a stored index keeps its quarter waves for the build step.
    let unindexed = 0, atNormal = 0;
    const layers = dsg.layers.map((layer, i) => {
        const n = num(layer.zn_re);
        const qwot = num(layer.qwot_thickness);
        if (!Number.isFinite(qwot)) throw new Error(`"${fileName}": layer ${i + 1} has no thickness`);
        let thicknessNm = null;
        if (n > 0) {
            thicknessNm = qwotToNm(qwot, lambdaNm, n, matchAngle, matchMedium);
            if (thicknessNm == null) { thicknessNm = qwotToNm(qwot, lambdaNm, n); atNormal++; }
        } else {
            unindexed++;
        }
        return {
            material: materialFor(layer),
            thicknessNm,
            optical: { kind: 'qwot', value: qwot, angleDeg: matchAngle, matchMedium },
            locked: String(layer.status || '').toUpperCase() === 'F',
        };
    });
    if (matchAngle) notes.push({ code: 'matchAngle', angleDeg: fmt(matchAngle), medium: fmt(matchMedium) });
    if (atNormal) notes.push({ code: 'obliqueNotApplied', count: atNormal });
    if (unindexed) notes.push({ code: 'unindexed', count: unindexed });

    // Media and substrate: the project, then the folder's substrate files.
    const mediumName = (key, which, fallback) => {
        const value = projectValue(project, key);
        if (value) return value;
        notes.push({ code: 'noMedium', which, assumed: fallback });
        return fallback;
    };
    const incidentMedium = mediumName('IncidentMedium', 'incident', 'Air');
    const exitMedium = mediumName('ExitMedium', 'exit', 'Air');
    let substrate = projectValue(project, 'Substrate');
    if (!substrate) {
        const media = new Set([incidentMedium, exitMedium].map(s => s.toLowerCase()));
        const candidates = files.filter(f => f.ext === 'sub' && !media.has(f.name.toLowerCase()) && !media.has(String(f.entry.name || '').toLowerCase()));
        if (candidates.length === 1) {
            substrate = candidates[0].name;
            notes.push({ code: 'substrateFromFolder', name: substrate });
        } else {
            substrate = 'Substrate';
            notes.push({ code: 'noSubstrate' });
        }
    }
    for (const name of [incidentMedium, exitMedium, substrate]) {
        const file = findByName(files, name, 'sub') || findByName(files, name, null);
        if (file && !Object.hasOwn(embedded, name)) embedded[name] = file.entry;
    }

    const source = jsonValue(projectValue(project, 'LightSource') || '');
    const grid = Array.isArray(source?.wavelength) ? source.wavelength.filter(Number.isFinite) : [];
    const [fromNm, toNm] = rangeOf(grid);
    const spectrum = grid.length > 1 && toNm > fromNm ? { fromNm, toNm } : null;

    return {
        name: String(dsg.name || '').trim() || fileName.replace(/\.[^.]*$/, ''),
        program: 'optilayer',
        file: fileName,
        referenceWavelengthNm: lambdaNm,
        incidentMedium,
        substrate,
        substrateThicknessMm: null,
        exitMedium,
        backSurface: false,
        front: layers.slice().reverse(),
        back: [],
        angleDeg: 0,
        matchAngleDeg: matchAngle,
        matchMedium,
        formula: null,
        symbols: {},
        constants,
        embedded,
        comments: [String(dsg.comment || '').trim()].filter(Boolean),
        notes,
        spectrum,
    };
}
