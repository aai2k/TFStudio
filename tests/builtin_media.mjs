/**
 * The built-in media other than air: water, NOA 61 optical adhesive and EVA.
 *
 * Each comes from a refractiveindex.info page through builtinRiiData.js: water
 * and EVA as tables of n and k, NOA 61 as the Cauchy formula its page gives.
 * They sit in the Ambient group beside Air, so the incident and exit medium
 * pickers offer them without an import.
 *
 *   - each resolves as a built-in with its range and a finite n over it;
 *   - a table returns its own row at a row's wavelength;
 *   - water at the sodium D line reads the handbook index, and absorbs more in
 *     its 1450 nm band than in the visible;
 *   - NOA 61 is the Cauchy sum of the page's coefficients;
 *   - a bare BK7 surface under water reflects the Fresnel value.
 *
 * Run: node tests/builtin_media.mjs
 */

import './_kernel.mjs';
import assert from 'node:assert/strict';
import { rta } from 'tmmcore';
import { pointStack } from '../src/utils/physics/kernelStack.js';
import { MATERIALS, MATERIAL_MAP, getMaterial } from '../src/utils/materials/materialDatabase.js';
import { BUILTIN_RII_DATA } from '../src/utils/materials/builtinRiiData.js';
import { buildBuiltinCatalog } from '../src/utils/materials/catalogManager/builtinCatalog.js';
import { isBuiltinId } from '../src/utils/materials/designMaterials.js';

const MEDIA = ['H2O', 'NOA61', 'EVA'];

// ── They are built-in, in the Ambient group, right after Air ─────────────────

assert.deepEqual(MATERIALS.slice(0, 4).map(m => m.id), ['Air', ...MEDIA], 'the media follow Air in catalog order');
const catalog = buildBuiltinCatalog().materials;
for (const id of MEDIA) {
    assert.equal(MATERIAL_MAP[id].group, 'Ambient', `${id} is in the Ambient group`);
    assert.ok(isBuiltinId(id) && isBuiltinId(`builtin:${id}`), `${id} is a built-in id, bare or prefixed`);
    assert.equal(catalog[id].comment, BUILTIN_RII_DATA[id].description, `${id} shows its page's comment and reference`);
    assert.ok(catalog[id].rangeDeclared, `${id} states its range`);
}

// ── Ranges, and a finite index across each ───────────────────────────────────

const rangeNm = id => getMaterial(id).getNK.rangeNm;
const tableEnds = id => { const rows = BUILTIN_RII_DATA[id].rows; return [rows[0][0], rows[rows.length - 1][0]]; };
assert.deepEqual(rangeNm('H2O'), tableEnds('H2O'), "water's range is its table's extent");
assert.ok(rangeNm('H2O')[0] >= 200 && rangeNm('H2O')[1] <= 2500, `water is kept inside 200 to 2500 nm: ${rangeNm('H2O')}`);
assert.deepEqual(rangeNm('EVA'), [250, 2500], "EVA keeps its page's whole span");
assert.deepEqual(rangeNm('NOA61'), [450, 1550], 'NOA 61 covers the range its page states');
for (const id of MEDIA) {
    const [lo, hi] = rangeNm(id);
    for (let i = 0; i <= 40; i++) {
        const [n, k] = getMaterial(id).getNK(lo + (hi - lo) * i / 40);
        assert.ok(Number.isFinite(n) && n > 1 && Number.isFinite(k) && k >= 0, `${id} has a real index above 1 across its range`);
    }
}

// ── A table returns its own rows ─────────────────────────────────────────────

for (const id of ['H2O', 'EVA']) {
    const rows = BUILTIN_RII_DATA[id].rows;
    for (const [lam, n, k] of [rows[0], rows[Math.floor(rows.length / 2)], rows[rows.length - 1]]) {
        const [gotN, gotK] = getMaterial(id).getNK(lam);
        assert.ok(Math.abs(gotN - n) < 1e-12 && Math.abs(gotK - k) < 1e-15, `${id} at ${lam} nm is its row: ${gotN}, ${gotK}`);
    }
}

// ── Water ────────────────────────────────────────────────────────────────────
//
// n_D of water is 1.3330 at 20 °C and falls about 1e-4 per kelvin; the page is
// for 25 °C. Its first strong near-infrared band sits near 1450 nm.

const water = getMaterial('H2O').getNK;
assert.ok(water(589.3)[0] > 1.332 && water(589.3)[0] < 1.334, `water at 589.3 nm: ${water(589.3)[0]}`);
assert.ok(water(1450)[1] > 100 * water(550)[1], `water absorbs far more at 1450 nm (${water(1450)[1]}) than at 550 nm (${water(550)[1]})`);

// ── NOA 61: n = C1 + C2·λ^C3 + C4·λ^C5, λ in µm ──────────────────────────────

const { formulaNum, coefficients } = BUILTIN_RII_DATA.NOA61.formula;
assert.equal(formulaNum, 205, 'the page is database formula 5, catalog formula 205');
const [c1, c2, c3, c4, c5] = coefficients;
for (const lam of [450, 589.3, 1064, 1550]) {
    const um = lam / 1000;
    const expected = c1 + c2 * um ** c3 + c4 * um ** c5;
    const [n, k] = getMaterial('NOA61').getNK(lam);
    assert.ok(Math.abs(n - expected) < 1e-12 && k === 0, `NOA 61 at ${lam} nm: ${n} against ${expected}`);
}
assert.ok(Math.abs(getMaterial('NOA61').getNK(589.3)[0] - 1.5596) < 1e-4, 'NOA 61 at the D line is 1.5596');

// ── A bare BK7 surface under water ───────────────────────────────────────────
//
// Normal incidence from a transparent medium: R = |(ns − n0) / (ns + n0)|².
// Water's k at 550 nm is of order 1e-9 and BK7's of order 1e-8, so the real
// indices give R to far better than the tolerance.

{
    const lam = 550;
    const n0 = water(lam), ns = getMaterial('BK7').getNK(lam);
    const { R } = rta(pointStack(n0, ns, []), lam, { pol: 's' });
    const fresnel = ((ns[0] - n0[0]) / (ns[0] + n0[0])) ** 2;
    assert.ok(Math.abs(R - fresnel) < 1e-9, `BK7 under water reflects ${R}, Fresnel ${fresnel}`);
    assert.ok(R < 0.006, `about a tenth of what it reflects in air: ${R}`);
}

// ── Synthesis does not offer them as films ───────────────────────────────────
//
// A needle run draws its candidate layer materials from the selected catalogs.
// Water, a cement and an encapsulant are not deposited layers, whether they
// reach the pool from the built-in catalog or as a medium of the design.

{
    const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
    const { getPoolMaterials } = await import('../src/components/windows/optimization/synthesisShared/catalogPool.js');
    initCatalogs({});
    const bare = id => id.slice(id.indexOf(':') + 1);
    const builtinPool = getPoolMaterials(new Set(['builtin'])).map(entry => bare(entry.id));
    assert.ok(builtinPool.includes('SiO2') && builtinPool.includes('TiO2'), 'the built-in pool still offers the film materials');
    for (const id of ['Air', ...MEDIA]) assert.ok(!builtinPool.includes(id), `${id} is not a candidate film`);

    const underwater = {
        incidentMedium: 'builtin:H2O', substrate: { material: 'builtin:BK7', thickness: 1 }, exitMedium: 'builtin:NOA61',
        frontLayers: [{ id: 'l1', material: 'builtin:TiO2', thickness: 50 }], backLayers: [],
    };
    const designPool = getPoolMaterials(new Set(['design']), { design: underwater }).map(entry => bare(entry.id));
    assert.ok(designPool.includes('TiO2'), "the design's own layer material is offered");
    assert.ok(!designPool.includes('H2O') && !designPool.includes('NOA61'), "the design's media are not");
}

console.log('builtin_media: passed');
