/**
 * Interpolation rule per tabulated material.
 *
 *  1. The linear interpolator: exact secants, end values held, derivatives of
 *     the piece a point is on, a knot belonging to the piece on its right.
 *  2. `interp` decides how a record is sampled: a table, a formula's k table,
 *     the Material Editor preview, and an embedded design material all follow
 *     the rule the record names, and PCHIP stays the default when it names none.
 *  3. The rule survives every place that used to reset it: catalog load, a
 *     user-catalog copy, a design's embedded block, the editor round trip.
 *  4. Materials read from Essential Macleod and TFCalc carry the linear rule,
 *     which is how those programs evaluate a table; a table sampled from a
 *     formula keeps PCHIP.
 *  5. Phase: a linear table reports itself as C0, its omega derivatives agree
 *     with a stencil inside a piece, and a design breaks its curve at a knot.
 *  6. Maintainer-only: AR 2-1 4-Layer with Essential Macleod's own materials
 *     against the performance table the program wrote for it.
 *
 * Run: node tests/tabulated_interpolation.mjs
 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {
    createLinearInterpolator, createTabulatedNKSampler, interpolationRuleOf,
    LINEAR_INTERPOLATION, TABULATED_INTERPOLATION,
} from '../src/utils/materials/pchip.js';
import { interpK, makeGetNK } from '../src/utils/materials/catalogManager/dispersion.js';
import { normalizeCatalogMaterials } from '../src/utils/materials/catalogManager/persistence.js';
import { initCatalogs, createUserCatalog, copyMaterialToCatalog } from '../src/utils/materials/catalogManager.js';
import { resolveDesignMaterial, designMaterialLookup } from '../src/utils/materials/designMaterials.js';
import { dispersionFingerprint } from '../src/utils/materials/designCatalog.js';
import { parseMacleodFile } from '../src/utils/materials/macleodParser.js';
import { parseTFCalcFile } from '../src/utils/materials/tfcalcParser.js';
import { buildNKFromDraft, draftToMaterial, materialToDraft } from '../src/components/windows/design/materialEditor/materialDraft.js';
import { materialOmegaResponse, C_NM_PER_FS } from '../src/utils/materials/materialDispersion.js';
import { evaluateDesignPhaseDispersion } from '../src/utils/physics/phaseDispersion.js';
import { computeDesignSpectrum } from '../src/utils/io/designSpectrum.js';

const near = (actual, expected, tolerance, message) => assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${message}: got ${actual}, expected ${expected}, tolerance ${tolerance}`);

// A user catalog persists through the preload bridge on every change; nothing
// to receive it here.
globalThis.window = { electronAPI: null };
initCatalogs({});

// ── 1. The linear interpolator ────────────────────────────────────────────────
const linear = createLinearInterpolator([[0, 1], [0.7, 2.4], [1.9, 2.1], [3, 4], [5.5, 3.7]]);
assert.equal(linear.interp, LINEAR_INTERPOLATION);
near(linear(0.35), 1.7, 1e-15, 'midpoint of the first piece');
near(linear(1.3), 2.25, 1e-15, 'midpoint of a falling piece');
near(linear(4.25), 3.85, 1e-15, 'midpoint of the last piece');
assert.equal(linear(0.7), 2.4, 'a knot reproduces its value');
assert.equal(linear(-3), 1, 'below the table the first value is held');
assert.equal(linear(9), 3.7, 'above the table the last value is held');
{
    const inside = linear.derivativesAt(1.3);
    assert.deepEqual(inside.derivatives, [(2.1 - 2.4) / 1.2, 0, 0], 'the derivatives are the secant and nothing else');
    assert.equal(inside.inRange, true);
    assert.equal(inside.segment, 1);
    const knot = linear.derivativesAt(1.9);
    assert.equal(knot.segment, 2, 'a knot belongs to the piece on its right');
    near(knot.derivatives[0], (4 - 2.1) / 1.1, 1e-15, 'and carries that piece\'s slope');
    assert.equal(linear.derivativesAt(5.5).segment, 3, 'the last knot belongs to the last piece');
    assert.equal(linear.derivativesAt(-1).inRange, false, 'below the table is out of range');
    assert.deepEqual(linear.derivativesAt(-1).derivatives, [0, 0, 0], 'a held end value has no slope');
    assert.equal(linear.derivativesAt(9).inRange, false);
}
const single = createLinearInterpolator([[500, 1.5]]);
assert.equal(single(400), 1.5);
assert.deepEqual(single.derivativesAt(500).derivatives, [0, 0, 0], 'one point is a constant');
assert.equal(createLinearInterpolator([]), null, 'no points give no interpolator');

// ── 2. The rule decides the sampling ─────────────────────────────────────────
const rows = [[400, 1.5, 0], [500, 1.8, 0.04], [650, 1.65, 0.01], [800, 1.7, 0.02]];
const pchipNK = createTabulatedNKSampler(rows);
const linearNK = createTabulatedNKSampler(rows, LINEAR_INTERPOLATION);
assert.equal(pchipNK.interp, TABULATED_INTERPOLATION, 'no rule means PCHIP');
assert.equal(linearNK.interp, LINEAR_INTERPOLATION);
assert.deepEqual(linearNK(450), [1.65, 0.02], 'a linear table at a midpoint');
assert.deepEqual(linearNK(500), [1.8, 0.04], 'both rules reproduce a knot');
assert.deepEqual(pchipNK(500), [1.8, 0.04]);
assert.notEqual(pchipNK(450)[0], linearNK(450)[0], 'and differ between knots');

const record = { id: 'lab', name: 'Lab', formulaNum: -1, tabData: rows, coefficients: [], kTable: [] };
assert.equal(interpolationRuleOf(record), TABULATED_INTERPOLATION, 'a record with no rule reads as PCHIP');
assert.equal(interpolationRuleOf({ ...record, interp: 'linear' }), LINEAR_INTERPOLATION);
assert.equal(interpolationRuleOf({ ...record, interp: 'spline' }), TABULATED_INTERPOLATION, 'an unknown rule falls back to the default');
assert.deepEqual(makeGetNK({ ...record, interp: 'linear' })(450), [1.65, 0.02], 'makeGetNK follows the record\'s rule');
assert.equal(makeGetNK({ ...record, interp: 'linear' }).interp, LINEAR_INTERPOLATION);
assert.deepEqual(makeGetNK(record)(450), pchipNK(450), 'and defaults to PCHIP');

const kTable = [{ lam_um: 0.4, k: 0.001 }, { lam_um: 1.0, k: 0.0002 }, { lam_um: 1.6, k: 0.0005 }];
const formula = { id: 'f', name: 'F', formulaNum: 102, coefficients: [1.5, 0.01, 0.001], kTable };
near(makeGetNK({ ...formula, interp: 'linear' })(700)[1], 0.0006, 1e-15, 'a formula material\'s k table follows the rule');
near(interpK(kTable, 0.7, 'linear'), 0.0006, 1e-15, 'interpK takes the rule');
assert.notEqual(makeGetNK(formula)(700)[1], 0.0006, 'and is PCHIP without one');
assert.equal(makeGetNK({ ...formula, interp: 'linear' }).interp, LINEAR_INTERPOLATION);

// The editor's preview samples the same way the catalog does, under either rule.
for (const interp of [TABULATED_INTERPOLATION, LINEAR_INTERPOLATION]) {
    const draft = materialToDraft('user_lab', { ...record, interp });
    assert.equal(draft.interp, interp, `the draft carries the ${interp} rule`);
    const preview = buildNKFromDraft(draft);
    const catalog = makeGetNK({ ...record, interp });
    for (const wavelength of [425, 550, 700]) {
        assert.deepEqual(preview(wavelength), catalog(wavelength), `editor and catalog agree at ${wavelength} nm under ${interp}`);
    }
    assert.equal(draftToMaterial(draft).interp, interp, `the draft writes the ${interp} rule back`);
    const formulaDraft = materialToDraft('user_lab', { ...formula, interp });
    assert.equal(draftToMaterial(formulaDraft).interp, interp, `a formula draft writes its k rule back (${interp})`);
    near(buildNKFromDraft(formulaDraft)(700)[1], makeGetNK({ ...formula, interp })(700)[1], 1e-15, `formula preview k under ${interp}`);
}

// ── 3. The rule survives ──────────────────────────────────────────────────────
const loaded = normalizeCatalogMaterials({ id: 'legacy', source: 'user', materials: {
    plain: { ...record }, ruled: { ...record, interp: 'linear' }, fk: { ...formula, interp: 'linear' },
} });
assert.equal(loaded.materials.plain.interp, TABULATED_INTERPOLATION, 'a catalog saved without the field loads as PCHIP');
assert.equal(loaded.materials.ruled.interp, LINEAR_INTERPOLATION, 'a saved linear rule survives loading');
assert.equal(loaded.materials.fk.interp, LINEAR_INTERPOLATION, 'on a formula\'s k table too');

const target = createUserCatalog('Rule test');
const copied = copyMaterialToCatalog({ ...record, interp: 'linear' }, target.id);
assert.equal(copied.interp, LINEAR_INTERPOLATION, 'a copy into a user catalog keeps the rule');
assert.equal(copyMaterialToCatalog({ ...record }, target.id).interp, TABULATED_INTERPOLATION, 'and a copy with none gets PCHIP');

const design = {
    id: 'd', name: 'D', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [{ id: 'l1', material: 'user_lab:lab', thickness: 100 }],
    backLayers: [],
    materials: { 'user_lab:lab': { ...record, interp: 'linear' } },
};
const embedded = resolveDesignMaterial(design, 'user_lab:lab');
assert.equal(embedded.status, 'embedded');
assert.equal(embedded.material.interp, LINEAR_INTERPOLATION, 'an embedded record keeps its rule');
assert.deepEqual(embedded.material.getNK(450), [1.65, 0.02], 'and is sampled by it');
assert.notEqual(dispersionFingerprint({ ...record, interp: 'linear' }), dispersionFingerprint(record),
    'the same table under two rules is two different materials');

// ── 4. What the importers stamp ──────────────────────────────────────────────
const macleodTable = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="Glass" NType="1" KType="1" TType="-1"><NKPoints><NKPoint W="700" n="1.513" k="0"/><NKPoint W="300" n="1.553" k="0"/><NKPoint W="500" n="1.521" k="0"/></NKPoints><Cauchy Max="0" Min="0"><Parameter N="0" A="1"/></Cauchy><Sellmeier Max="0" Min="0"><Parameter N="0" A="0" B="0"/></Sellmeier><KPoints><KPoint W="100" k="0"/><KPoint W="1000" k="0"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><Notes></Notes></EssentialMacleodMaterial>\r\n';
const macleodSellmeier = '<?xml version="1.0"?>\r\n<EssentialMacleodMaterial Name="S" NType="2" KType="1" TType="-1"><NKPoints><NKPoint W="100" n="1" k="0"/></NKPoints><Cauchy Max="0" Min="0"><Parameter N="0" A="1"/></Cauchy><Sellmeier Max="2500" Min="300"><Parameter N="0" A="1.03961212" B="6000.69867"/><Parameter N="1" A="0.231792344" B="20017.9144"/><Parameter N="2" A="1.01046945" B="103560653"/></Sellmeier><KPoints><KPoint W="400" k="0.001"/><KPoint W="1000" k="0.0002"/></KPoints><KCauchy><Parameter N="0" A="0"/></KCauchy><KExp><Parameter A="0" B="0"/></KExp><Notes></Notes></EssentialMacleodMaterial>\r\n';
const macleodExpK = macleodSellmeier.replace('KType="1"', 'KType="2"').replace('<KExp><Parameter A="0" B="0"/></KExp>', '<KExp><Parameter A="1e-4" B="300"/></KExp>');
{
    const g = parseMacleodFile(macleodTable, 'M1.tfx');
    assert.equal(g.interp, LINEAR_INTERPOLATION, 'an Essential Macleod table is read linearly');
    near(makeGetNK(g)(400)[0], 1.537, 1e-15, 'and samples the way the program does');
    const s = parseMacleodFile(macleodSellmeier, 'M2.tfx');
    assert.equal(s.formulaNum, 101);
    assert.equal(s.interp, LINEAR_INTERPOLATION, 'a k table the file holds is read linearly');
    near(makeGetNK(s)(700)[1], 0.0006, 1e-15, 'k at 700 nm as a straight line between the two points');
    const e = parseMacleodFile(macleodExpK, 'M3.tfx');
    assert.equal(e.interp, TABULATED_INTERPOLATION, 'a k table sampled from a formula stays PCHIP');
}
{
    const t = parseTFCalcFile('VERSION*1*\nFORMAT*1*\nPOINTS*3*\nDATA1*1*550.0*2.385*0.0*\nDATA1*2*450.0*2.469*0.01*\nDATA1*3*650.0*2.337*0.0*\nEOF*\n', 'TIO2.MAT');
    assert.equal(t.interp, LINEAR_INTERPOLATION, 'a TFCalc table is read linearly');
    near(makeGetNK(t)(500)[0], 2.427, 1e-12, 'and samples n the way the program does');
    near(makeGetNK(t)(500)[1], 0.005, 1e-12, 'and k');
    const formulaFile = (nCode, kCode, slots) => {
        const s = slots.slice(); while (s.length < 9) s.push(0);
        return `VERSION*1*\nFORMAT*2*${nCode}*${kCode}*400.0*800.0*\nDATA2*1*${s[0]}*${s[1]}*${s[2]}*\nDATA2*2*${s[3]}*${s[4]}*${s[5]}*\nDATA2*3*${s[6]}*${s[7]}*${s[8]}*\nEOF*\n`;
    };
    const c = parseTFCalcFile(formulaFile(5, 3, [2.2, 0.02, 0.001, 0, 0, 0, 1e-4, 0.3]), 'C.MAT');
    assert.equal(c.interp, TABULATED_INTERPOLATION, 'a TFCalc k formula sampled to a table stays PCHIP');
    const h = parseTFCalcFile(formulaFile(6, 1, [1.4, 0.05, 0.1]), 'H1.MAT');
    assert.equal(h.formulaNum, -1);
    assert.equal(h.interp, TABULATED_INTERPOLATION, 'a TFCalc formula sampled to a table stays PCHIP');
}

// ── 5. Phase under a linear table ────────────────────────────────────────────
{
    const material = { ...record, interp: 'linear', getNK: makeGetNK({ ...record, interp: 'linear' }) };
    const response = materialOmegaResponse(material, 560);
    assert.equal(response.model, 'Table (linear)');
    assert.equal(response.continuousOrder, 0, 'a linear table is C0');
    assert.equal(response.phaseContinuousOrder, 0);
    assert.equal(response.maxOrder, 3, 'and still supplies three derivatives');
    // Inside a piece n is linear in wavelength, not in omega; the reported
    // omega derivatives must match a stencil on the sampler itself.
    const omega = 2 * Math.PI * C_NM_PER_FS / 560;
    const step = omega * 1e-3;
    const sampled = [];
    for (let offset = -3; offset <= 3; offset++) sampled.push(material.getNK(2 * Math.PI * C_NM_PER_FS / (omega + offset * step))[0]);
    const [m3, m2, m1, , p1, p2, p3] = sampled;
    const stencil = [
        (-m3 + 9 * m2 - 45 * m1 + 45 * p1 - 9 * p2 + p3) / (60 * step),
        (2 * m3 - 27 * m2 + 270 * m1 - 490 * sampled[3] + 270 * p1 - 27 * p2 + 2 * p3) / (180 * step * step),
        (m3 - 8 * m2 + 13 * m1 - 13 * p1 + 8 * p2 - p3) / (8 * step ** 3),
    ];
    near(response.derivatives[0][0], stencil[0], 1e-9 * Math.abs(stencil[0]), 'first omega derivative of a linear piece');
    near(response.derivatives[1][0], stencil[1], 1e-6 * Math.abs(stencil[1]), 'second omega derivative of a linear piece');
    near(response.derivatives[2][0], stencil[2], 1e-4 * Math.abs(stencil[2]), 'third omega derivative of a linear piece');
    assert.equal(materialOmegaResponse({ ...record, getNK: makeGetNK(record) }, 560).model, 'Table (PCHIP)', 'the PCHIP name is unchanged');

    const at = wavelengthNm => evaluateDesignPhaseDispersion(design, { wavelengthNm, side: 'front', target: 'R' });
    const left = at(500 - 1e-6), right = at(500 + 1e-6);
    assert.ok(left.valid && right.valid, 'a linear table computes phase quantities');
    assert.equal(left.phaseContinuousOrder, 0, 'the design reports the lowest continuity among its materials');
    assert.notEqual(left.knotSignature, right.knotSignature, 'the knot signature changes across a table point');
    assert.ok(Math.abs(left.gdFs - right.gdFs) > 1e-6, 'and GD jumps there, which is what the signature is for');
    // 625 and 640 nm sit on one piece of the layer's table and on one piece of
    // the substrate's k table alike.
    assert.equal(at(625).knotSignature, at(640).knotSignature, 'and holds inside a piece');
}

// ── 6. Maintainer-only: Essential Macleod's own numbers ──────────────────────
const TFS = 'C:\\Users\\color\\Documents\\TFStudio\\Projects\\My Designs\\AR 2-1 4-Layer.tfs';
const TBL = 'X:\\TFStudio Dev\\reference\\AR 2-1 4-Layer - Performance.tbl';
const TBL_PHASE = 'X:\\TFStudio Dev\\reference\\AR 2-1 4-Layer - Performance1.tbl';
if (fs.existsSync(TFS) && fs.existsSync(TBL) && fs.existsSync(TBL_PHASE)) {
    const table = file => fs.readFileSync(file, 'utf8')
        .replace(/[\s\S]*<Table>/, '').replace(/<\/Table>[\s\S]*/, '').trim().split(/\r?\n/)
        .map(line => line.split(',').map(v => Number(v.trim()))).filter(r => r.every(Number.isFinite));
    const dispersion = table(TBL);
    const phase = new Map(table(TBL_PHASE).map(r => [r[0], r[4]]));
    const stored = JSON.parse(fs.readFileSync(TFS, 'utf8'));
    // The design as the Macleod reader will produce it: every table linear,
    // and each layer's full waves converted with the index that rule gives at
    // the reference wavelength.
    const ar = structuredClone(stored);
    for (const m of Object.values(ar.materials)) if (m.formulaNum === -1) m.interp = 'linear';
    const ruled = designMaterialLookup(ar), asStored = designMaterialLookup(stored);
    ar.frontLayers = ar.frontLayers.map(layer => ({
        ...layer, thickness: layer.thickness * asStored(layer.material).getNK(510)[0] / ruled(layer.material).getNK(510)[0],
    }));
    const knots = Object.values(ar.materials).flatMap(m => m.tabData.map(r => r[0]));
    const onKnot = lam => knots.some(x => Math.abs(x - lam) < 0.05);
    const inRange = lam => Object.values(ar.materials).every(m => lam >= m.tabData[0][0] && lam <= m.tabData.at(-1)[0]);

    const lam0 = dispersion[0][0], lamN = dispersion.at(-1)[0], step = dispersion[1][0] - lam0;
    const spectrum = computeDesignSpectrum(ar, { lambdaStart: lam0, lambdaEnd: lamN, lambdaStep: step, thetas: [0] }, 'front');
    let checked = 0, skipped = 0;
    dispersion.forEach(([lam, R, gd, gdd, tod], i) => {
        near(spectrum.series[0].R[i] * 100, R, 1e-10, `reflectance at ${lam} nm`);
        if (!inRange(lam)) return;
        const p = evaluateDesignPhaseDispersion(ar, { wavelengthNm: lam, side: 'front', target: 'R' });
        assert.ok(p.valid, `phase at ${lam} nm is computed: ${p.reason || ''}`);
        const dPhase = ((p.phaseRad * 180 / Math.PI - phase.get(lam)) % 360 + 540) % 360 - 180;
        near(dPhase, 0, 1e-8, `reflection phase at ${lam} nm`);
        // The program differentiates numerically; on a table point its stencil
        // straddles the kink and reports a mean of the two sides, which is not
        // a derivative of either piece. Those points are not compared.
        if (onKnot(lam)) { skipped++; return; }
        near(p.gdFs, gd, 1e-4, `GD at ${lam} nm`);
        near(p.gddFs2, gdd, 1e-3, `GDD at ${lam} nm`);
        near(p.todFs3, tod, 5e-2, `TOD at ${lam} nm`);
        checked++;
    });
    // The glass table has 10 nm spacing, so ten of the 25 covered wavelengths sit on a knot.
    assert.ok(checked >= 12 && skipped >= 3, `compared ${checked} wavelengths, ${skipped} on a table point`);
    console.log(`maintainer: AR 2-1 4-Layer matches Essential Macleod at ${checked} wavelengths (${skipped} on a knot compared for R and phase only)`);
} else {
    console.log('(maintainer section not run: Essential Macleod reference files not present)');
}

console.log('PASS: tabulated_interpolation');
