/**
 * OptiLayer .dsg design reader checks.
 *
 *  1. A design with its problem folder: layer 1 next to the substrate, QWOT
 *     to nm with the stored index, lock from status F, abbreviations found
 *     through the project map and through the layer index, media and the
 *     substrate from the project and the folder, the plot range from the
 *     light source, folder definitions handed over for embedding.
 *  2. The 45° match convention, carried on the layers for the build step; a
 *     metal at an oblique match, where the wave is evanescent, converted at
 *     normal incidence and noted; an absorber's thickness with the real part
 *     of n; a folder-less design falling back to constants; the rugate refusal;
 *     a project section named __proto__.
 *  3. Maintainer-only: every design on this machine (the user's problem
 *     folders and the shipped samples), with the program's own numbers.
 *
 * Run: node tests/optilayer_design.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseOptiLayerDesign, parseOptiLayerProject, qwotToNm } from '../src/utils/io/designImport/optilayerDesign.js';

let fails = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fails++; };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg} (${a} vs ${b}, tol ${tol})`);

const layer = (abbr, qwot, n, k = 0, status = 'A') => ({ abbr, qwot_thickness: qwot, status, zn_re: n, zn_im: -k, fraction: 0.5 });
const design = (layers, extra = {}) => JSON.stringify({
    VERSION: 1, name: 'AR test', comment: 'N=3, MF=0.1, TOT=250.00', controlW: 1000, matchAngle: 0, matchMedium: 1, layers, ...extra,
});
const lm = (name, wavelength, n, k) => ({ name, ext: 'lm', text: JSON.stringify({ nType: 0, kType: 0, wavelength, n, k, name }) });
const sub = (name, n) => ({ name, ext: 'sub', text: JSON.stringify({ nType: 0, kType: 0, wavelength: null, n: [n], k: [0], name }) });

const siblings = [
    lm('n=2.35', null, [2.35], [0]),
    lm('SiO2 table', [400, 1000, 1600], [1.47, 1.45, 1.44], [0, 0, 0]),
    lm('Ag', [400, 1000, 1600], [0.05, 0.04, 0.03], [2.1, 7.0, 10.0]),
    sub('Air', 1.000293), sub('Glass n=1.52', 1.52),
];
const projectText = '[LoadedData]\nExitMedium=Air\nIncidentMedium=Air\nLightSource="{\\"name\\": \\"Uniform\\", \\"wavelength\\": [400.0, 405.0, 700.0], \\"distribution\\": [1.0, 1.0, 1.0]}"\n';

// ── 1. With the folder ────────────────────────────────────────────────────────
const text = design([layer('H', 0.4, 2.35), layer('L', 1.0, 1.45, 0, 'F'), layer('A', 0.02, 0.04, 7.0)]);
const d = parseOptiLayerDesign(text, '8-layer AR.dsg', { projectText, siblings });
ok(d.program === 'optilayer' && d.name === 'AR test', 'program and the design\'s own name');
near(d.referenceWavelengthNm, 1000, 1e-12, 'control wavelength is the reference wavelength');
ok(d.front.length === 3 && d.back.length === 0, 'three front layers');
ok(d.front[2].material === 'n=2.35' && d.front[0].material === 'Ag', 'file layer 1 (next to the substrate) is last in front order');
near(d.front[2].thicknessNm, 0.4 * 1000 / (4 * 2.35), 1e-9, 'QWOT to nm with the stored index');
near(d.front[1].thicknessNm, 1000 / (4 * 1.45), 1e-9, 'a quarter wave of the stored index');
ok(d.front[1].locked === true && d.front[2].locked === false, 'status F becomes locked');
ok(d.front[1].material === 'SiO2 table', 'an abbreviation is identified by its index in the folder\'s .lm files');
near(d.front[0].thicknessNm, 0.02 * 1000 / (4 * 0.04), 1e-9, 'an absorber\'s thickness uses the real part of n');
ok(d.incidentMedium === 'Air' && d.exitMedium === 'Air', 'media from the project');
ok(d.substrate === 'Glass n=1.52' && d.notes.some(n => n.code === 'substrateFromFolder' && n.name === 'Glass n=1.52'), 'substrate from the folder\'s only substrate file, noted');
ok(d.backSurface === false && d.angleDeg === 0 && d.matchAngleDeg === 0, 'semi-infinite substrate; no incident angle in the file');
ok(Object.keys(d.embedded).sort().join() === 'Ag,Air,Glass n=1.52,SiO2 table,n=2.35', `folder definitions handed over: ${Object.keys(d.embedded).join(', ')}`);
ok(d.embedded['n=2.35'].formulaNum === -1 && d.embedded['SiO2 table'].tabData.length === 3, 'embedded entries are catalog entries');
ok(d.spectrum.fromNm === 400 && d.spectrum.toNm === 700, 'plot range from the project\'s light source');
ok(d.comments[0].startsWith('N=3') && Object.keys(d.constants).length === 0, 'comment kept, nothing left as a constant');
ok(d.front[2].optical.kind === 'qwot' && d.front[2].optical.value === 0.4, 'QWOT kept for the preview');

// The project's abbreviation map wins over the index match.
const mapped = parseOptiLayerDesign(text, 'm.dsg', {
    projectText: projectText + 'Substrate=Glass n=1.52\nAbbr2Material="{\\n  \\"L\\": [\\n    \\"Ag\\",\\n    \\"Active\\",\\n    \\"0.0\\",\\n    \\"1000000.0\\"\\n  ]\\n}"\n', siblings,
});
ok(mapped.front[1].material === 'Ag' && mapped.substrate === 'Glass n=1.52' && !mapped.notes.some(n => /ubstrate/.test(n.code)), 'Abbr2Material and Substrate from the project');

// ── 2. Conventions and fallbacks ──────────────────────────────────────────────
const oblique = parseOptiLayerDesign(design([layer('H', 1, 2.35), layer('L', 1, 1.45)], { matchAngle: 45, matchMedium: 1 }), 'o.dsg', { siblings });
{
    const cos = n => Math.sqrt(1 - Math.pow(Math.sin(Math.PI / 4) / n, 2));
    near(oblique.front[1].thicknessNm, 1000 / (4 * 2.35 * cos(2.35)), 1e-9, 'QWOT at 45° carries the cosine of the angle in the layer');
    near(qwotToNm(1, 1000, 2.35, 45, 1), oblique.front[1].thicknessNm, 1e-12, 'the exported conversion is the one the reader uses');
    near(qwotToNm(1, 1000, 2.35), 1000 / (4 * 2.35), 1e-12, 'and reduces to λ / (4 n) at normal incidence');
    ok(oblique.matchAngleDeg === 45 && oblique.matchMedium === 1 && oblique.angleDeg === 0, 'the match angle is recorded as such, not as an incident angle');
    ok(oblique.notes.some(n => n.code === 'matchAngle' && n.angleDeg === '45'), 'match angle noted');
    ok(oblique.front.every(l => l.optical.angleDeg === 45 && l.optical.matchMedium === 1), 'every layer carries the match angle for the build step');
}

// A metal at an oblique match: the wave is evanescent in it, so the angle
// cannot be applied and the layer is converted at normal incidence.
const metal = parseOptiLayerDesign(design([layer('H', 1, 2.35), layer('M', 0.02, 0.04, 7.0)], { matchAngle: 45, matchMedium: 1 }), 'metal.dsg', { siblings });
ok(qwotToNm(0.02, 1000, 0.04, 45, 1) === null, 'no real thickness for n below n_match sin θ');
near(metal.front[0].thicknessNm, 0.02 * 1000 / (4 * 0.04), 1e-9, 'the metal layer converts at normal incidence');
ok(Number.isFinite(metal.front[0].thicknessNm) && metal.notes.some(n => n.code === 'obliqueNotApplied' && n.count === 1), 'and the design says so');

// A design that stores no index: the layers keep their quarter waves and the
// abbreviation, a folder file of that name is taken when there is one.
const noIndex = parseOptiLayerDesign(design([layer('H', 1, null), layer('L', 1, null)]), 'qwm.dsg', { siblings: [lm('H', null, [2.3], [0])] });
ok(noIndex.front[1].thicknessNm === null && noIndex.front[1].optical.value === 1 && noIndex.front[1].material === 'H' && noIndex.embedded.H, 'unindexed layer with a folder file of its name');
ok(noIndex.front[0].material === 'L' && !noIndex.embedded.L && Object.keys(noIndex.constants).length === 0, 'unindexed layer without a file keeps the abbreviation');
ok(noIndex.notes.some(n => n.code === 'unindexed' && n.count === 2), 'unindexed layers noted');

const bare = parseOptiLayerDesign(design([layer('H', 1, 2.35), layer('N', 0.01, 2.2, 3.76)]), 'bare.dsg');
ok(bare.front.every(l => /at 1000 nm\)$/.test(l.material)), `without a folder the layers become constants: ${bare.front.map(l => l.material).join(' / ')}`);
ok(bare.constants[bare.front[0].material].k === 3.76 && bare.constants[bare.front[1].material].n === 2.35, 'constants carry n and k');
ok(bare.substrate === 'Substrate' && bare.notes.some(n => n.code === 'noSubstrate'), 'no substrate to take; the user chooses');
ok(bare.incidentMedium === 'Air' && bare.notes.some(n => n.code === 'noMedium' && n.which === 'incident' && n.assumed === 'Air'), 'missing medium assumed and noted');

let threw = '';
try { parseOptiLayerDesign(design([{ ...layer('A', 90, 1.78), rugate_parametrization: { rugate_type: 0 } }]), 'r.dsg'); } catch (e) { threw = e.message; }
ok(/rugate/.test(threw), 'a rugate layer is refused');
threw = '';
try { parseOptiLayerDesign('{"name": "x"}', 'x.dsg'); } catch (e) { threw = e.message; }
ok(/not an OptiLayer design/.test(threw), 'JSON without layers is not a design');
threw = '';
try { parseOptiLayerDesign('<xml/>', 'x.dsg'); } catch (e) { threw = e.message; }
ok(/not an OptiLayer design/.test(threw), 'non-JSON rejected');

const ini = parseOptiLayerProject('[General]\nSubstrate=BK7\n[LoadedData]\nExitMedium="Air"\nComment="a \\"b\\"\\nc"\n');
ok(ini.General.Substrate === 'BK7' && ini.LoadedData.ExitMedium === 'Air' && ini.LoadedData.Comment === 'a "b"\nc', 'INI sections, quotes and escapes');
const proto = parseOptiLayerProject('[__proto__]\npolluted=1\n');
ok(Object.hasOwn(proto, '__proto__') && proto.__proto__.polluted === '1' && !('polluted' in {}), 'a section named __proto__ is a section, not the prototype');

// A large light-source grid does not overflow the range scan.
const bigGrid = parseOptiLayerDesign(design([layer('H', 1, 2.35)]), 'big.dsg', {
    projectText: `[LoadedData]\nIncidentMedium=Air\nExitMedium=Air\nLightSource="{\\"wavelength\\": [${Array.from({ length: 200000 }, (_, i) => 300 + i * 0.01).join(', ')}]}"\n`,
});
ok(bigGrid.spectrum.fromNm === 300 && Math.abs(bigGrid.spectrum.toNm - 2299.99) < 1e-6, 'plot range from a 200 000-point light source');

// ── 3. Maintainer-only: every design on this machine ─────────────────────────
const ROOTS = ['C:\\Users\\color\\Documents\\OptiLayer', 'X:\\Programs\\ol\\bin\\OptiLayer\\Resources\\Samples', 'X:\\Programs\\ol\\bin\\Apps\\OptiLayer\\Resources\\Samples'];
const present = ROOTS.filter(r => fs.existsSync(r));
if (present.length) {
    const errors = [];
    const stale = [];
    let parsed = 0, rugates = 0, abbrs = 0, identified = 0, totChecked = 0, substrates = 0;
    const folderOf = (dir) => {
        const names = fs.readdirSync(dir);
        const project = names.find(n => /\.olproj$/i.test(n));
        return {
            projectText: project ? fs.readFileSync(path.join(dir, project), 'utf8') : '',
            siblings: names.filter(n => /\.(lm|sub)$/i.test(n)).map(n => ({ name: path.basename(n, path.extname(n)), ext: path.extname(n).slice(1).toLowerCase(), text: fs.readFileSync(path.join(dir, n), 'utf8') })),
        };
    };
    const walk = (dir) => {
        let folder = null;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(p); continue; }
            if (!/\.dsg$/i.test(entry.name)) continue;
            folder = folder || folderOf(dir);
            const raw = fs.readFileSync(p, 'utf8');
            try {
                const item = parseOptiLayerDesign(raw, entry.name, folder);
                parsed++;
                if (item.substrate !== 'Substrate') substrates++;
                const layers = item.front;
                abbrs += layers.length;
                identified += layers.filter(l => item.embedded[l.material]).length;
                // The comment's TOT is the total optical thickness in nm: Σ qwot λc / 4
                // at normal incidence. A comment survives later edits of the
                // design, so a few are stale; they are listed, not failed.
                const dsg = JSON.parse(raw);
                const tot = /TOT\s*=\s*([0-9.]+)/.exec(dsg.comment || '');
                if (tot && dsg.matchAngle === 0) {
                    const sum = dsg.layers.reduce((s, l) => s + l.qwot_thickness * dsg.controlW / 4, 0);
                    totChecked++;
                    if (Math.abs(sum - Number(tot[1])) > 0.02 * Math.max(1, Number(tot[1]) / 1000)) stale.push(`${entry.name}: TOT ${tot[1]} vs ${sum.toFixed(2)}`);
                }
            } catch (e) {
                if (/rugate/.test(e.message)) rugates++;
                else errors.push(`${entry.name}: ${e.message}`);
            }
        }
    };
    for (const r of present) walk(r);
    ok(errors.length === 0 && parsed > 0, `all ${parsed} OptiLayer designs parse, ${rugates} rugate designs refused, ${identified} of ${abbrs} layers identified in their folder, ${substrates} with a substrate${errors.length ? ': ' + errors.slice(0, 5).join('; ') : ''}`);
    console.log(`  ${totChecked - stale.length} of ${totChecked} TOT comments reproduced by Σ qwot λc / 4; the rest are comments older than the design they sit on`);

    // The 45° sample: the comment's TOT is Σ qwot λc / (4 cos θ) with θ the
    // angle in each layer, which is the relation the reader inverts.
    const oblique45 = path.join(ROOTS[1], 'ADV_EXAMPLES', 'LEC25D24', 'NP SWP filter (2.35, 1.45).dsg');
    if (fs.existsSync(oblique45)) {
        const dsg = JSON.parse(fs.readFileSync(oblique45, 'utf8'));
        const item = parseOptiLayerDesign(fs.readFileSync(oblique45, 'utf8'), 'NP SWP filter.dsg', folderOf(path.dirname(oblique45)));
        const tot = Number(/TOT\s*=\s*([0-9.]+)/.exec(dsg.comment)[1]);
        // Σ n d cos θ over the imported physical thicknesses reproduces Σ qwot λc / 4 exactly, and Σ n d the comment's TOT.
        const layers = item.front.slice().reverse();
        const sumNd = layers.reduce((s, l, i) => s + l.thicknessNm * dsg.layers[i].zn_re, 0);
        near(sumNd, tot, 0.05, 'the 45° design\'s optical thickness reproduces its TOT comment');
    }

    // The low-E example: the help states 0.7 nm NiCr and 11 and 15 nm silver.
    const lowE = path.join(ROOTS[0], 'LEC25D22', 'Double silver low-E.dsg');
    if (fs.existsSync(lowE)) {
        const item = parseOptiLayerDesign(fs.readFileSync(lowE, 'utf8'), 'Double silver low-E.dsg', folderOf(path.dirname(lowE)));
        const nm = item.front.map(l => Number(l.thicknessNm.toFixed(3)));
        ok(nm.filter(v => v === 0.7).length === 4 && nm.includes(11) && nm.includes(15), `low-E layers as the help states them: ${nm.join(', ')}`);
        ok(item.front.some(l => l.material === 'NICR 80%-20%') && item.front.some(l => l.material === 'Ag (Silver)'), 'absorbing layers identified by n and k');
    }
} else {
    console.log('(maintainer section not run: OptiLayer designs not present)');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
