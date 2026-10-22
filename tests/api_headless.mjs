/**
 * The headless API (src/api/) building designs in plain Node, with no browser
 * globals: a new design; a quarter-wave stack from a stack formula, whose
 * reflectance at its reference wavelength is Macleod's (Thin-Film Optical
 * Filters, 5th ed., eqs. 6.10 and 6.11); formulas read as the Stack Formula
 * dialog reads them, on either side; setup changes; layer edits, which leave
 * their argument as it was and keep to the sides the Design Editor lets the
 * user edit; merit rows as the editor makes them; the materials whose data
 * stop inside a range.
 *
 * The corpus is in api_corpus.mjs, runs, Stop and tolerancing in api_runs.mjs,
 * refusals in api_refusals.mjs.
 *
 * Run: node tests/api_headless.mjs
 */
const api = await import('../src/api/index.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const throws = (fn, pattern) => { try { fn(); return false; } catch (err) { return pattern.test(err.message); } };

const started = await api.init();
ok('init loads the WASM kernel', started.wasm === true);

// ── A design built through the API ───────────────────────────────────────
const blank = api.newDesign();
{
    const bare = { substrate: blank.substrate, media: [blank.incidentMedium, blank.exitMedium], layers: blank.frontLayers.length, mode: blank.surfaceMode };
    ok('a new design is a bare BK7 substrate in air', JSON.stringify(bare)
        === JSON.stringify({ substrate: { material: 'BK7', thickness: 1 }, media: ['Air', 'Air'], layers: 0, mode: 'front_only' }), JSON.stringify(bare));
}
const P = 3;
const qw = api.stackFromFormula(blank, { formula: `(HL)^${P} H`, symbols: { H: 'Al2O3', L: 'MgF2' }, referenceWavelength: 550 });
const nAt = (id, wavelength, design = qw) => api.materialNK(id, [wavelength], design).nk[0].n;
ok('a stack formula builds quarter waves at its reference wavelength', qw.frontLayers.length === 2 * P + 1
    && qw.frontLayers.every(l => Math.abs(l.thickness * nAt(l.material, 550) - 550 / 4) < 1e-9) && blank.frontLayers.length === 0);
{
    // Macleod eq. 6.10: Y = yH^(2p+2) / (yL^(2p) ym) for (HL)^p H, eq. 6.11: R = ((y0 - Y) / (y0 + Y))^2.
    const Y = nAt('Al2O3', 550) ** (2 * P + 2) / (nAt('MgF2', 550) ** (2 * P) * nAt('BK7', 550));
    const R = api.spectrum(qw, { from: 550, to: 551, step: 1 }).angles[0].R[0];
    ok('its reflectance at 550 nm is Macleod\'s eq. 6.11', Math.abs(R - ((1 - Y) / (1 + Y)) ** 2) < 1e-9, `${R}`);
}
{
    // R, T and A come for s and p too: the same at normal incidence, and
    // unpolarized light is the mean of the two at any angle.
    const s = api.spectrum(qw, { from: 450, to: 650, step: 50, angles: [0, 45] });
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
    const mean = (a, b) => a.map((v, i) => (v + b[i]) / 2);
    const [normal, oblique] = [s.angles[0], s.angles[45]];
    ok('a spectrum gives R, T and A for s and p', ['R', 'T', 'A'].every(q => normal[`${q}s`]?.length === s.lambda.length && normal[`${q}p`]?.length === s.lambda.length));
    ok('at normal incidence s and p are the same', ['R', 'T', 'A'].every(q => near(normal[`${q}s`], normal[`${q}p`])));
    ok('at 45 degrees s and p differ, and unpolarized light is their mean', !near(oblique.Rs, oblique.Rp)
        && ['R', 'T', 'A'].every(q => near(oblique[q], mean(oblique[`${q}s`], oblique[`${q}p`]))));
    ok('summarize covers them too', ['Ts', 'Tp', 'As', 'Ap'].every(q => api.summarize(s)[45][0][q]?.mean >= 0));
}
{
    // The dialog reads a formula from the substrate outward by default: the
    // first letter is the layer on the substrate, which the front stores last
    // and the back first.
    const names = layers => layers.map(l => l.material.replace(/^builtin:/, ''));
    const two = api.newDesign({ surfaceMode: 'both_independent' });
    const front = api.stackFromFormula(two, { formula: 'H L L' });
    const back = api.stackFromFormula(two, { side: 'back', formula: 'H L L' });
    const ambientFirst = api.stackFromFormula(two, { formula: 'H L L', startFromSubstrate: false });
    ok('a formula is read from the substrate outward, as the dialog reads it', JSON.stringify(names(front.frontLayers)) === '["SiO2","SiO2","TiO2"]'
        && JSON.stringify(names(back.backLayers)) === '["TiO2","SiO2","SiO2"]', `${names(front.frontLayers)} / ${names(back.backLayers)}`);
    ok('or from the incident medium inward', JSON.stringify(names(ambientFirst.frontLayers)) === '["TiO2","SiO2","SiO2"]');
    const ir = api.stackFromFormula(api.newDesign({ referenceWavelength: 1064 }), { formula: 'H' });
    ok('a formula is built at the design\'s reference wavelength', Math.abs(ir.frontLayers[0].thickness * nAt('TiO2', 1064, ir) - 1064 / 4) < 1e-9
        && ir.referenceWavelength === 1064 && ir.stackFormula === 'H');
    const onBack = api.stackFromFormula(blank, { side: 'back', formula: 'H L' });
    ok('filling the side a one-sided design does not evaluate makes it that side\'s design, as the dialog does', onBack.surfaceMode === 'back_only'
        && onBack.backLayers.length === 2 && onBack.exitMedium === blank.exitMedium, onBack.surfaceMode);
    const sym = api.stackFromFormula(api.newDesign({ surfaceMode: 'symmetric' }), { formula: 'H L L' });
    ok('on a symmetric design the formula fills the front and the back mirrors it', JSON.stringify(names(sym.frontLayers)) === '["SiO2","SiO2","TiO2"]'
        && JSON.stringify(names(sym.backLayers)) === '["TiO2","SiO2","SiO2"]');
}
{
    const changed = api.setDesignSetup(blank, { substrate: 'SiO2', substrateThicknessMm: 3, exitMedium: 'SiO2', name: 'Fused silica' });
    const setup = d => JSON.stringify([d.name, d.substrate.material, d.substrate.thickness, d.exitMedium]);
    ok('setDesignSetup changes the substrate and media and leaves its argument', setup(changed) === '["Fused silica","SiO2",3,"SiO2"]'
        && blank.substrate.material === 'BK7', setup(changed));
    const front = api.insertLayer(api.insertLayer(blank, { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
    const symmetric = api.setDesignSetup(front, { surfaceMode: 'symmetric' });
    ok('a design made symmetric takes the mirror of its front as its back', JSON.stringify(symmetric.backLayers.map(l => l.material)) === '["SiO2","TiO2"]');
    const quarter = api.stackFromFormula(blank, { formula: 'H L' });
    const moved = api.setDesignSetup(quarter, { referenceWavelength: 1064 });
    const qwot = (d, i) => 4 * d.frontLayers[i].thickness * nAt(d.frontLayers[i].material, d.referenceWavelength, d) / d.referenceWavelength;
    ok('a new reference wavelength keeps every layer a quarter wave, as the Design Editor\'s field does', moved.referenceWavelength === 1064
        && Math.abs(qwot(moved, 0) - 1) < 1e-9 && Math.abs(qwot(moved, 1) - 1) < 1e-9, `${qwot(moved, 0)}, ${qwot(moved, 1)}`);
    const whole = api.setDesignSetup(front, { mfEvalMode: 'total' });
    ok('scored as the whole part, a one-sided design takes back layers', api.insertLayer(whole, { side: 'back', material: 'SiO2', thickness: 10 }).backLayers.length === 1);
}
{
    const two = api.insertLayer(api.insertLayer(blank, { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 50 });
    const edited = api.setLayer(two, { index: 0, thickness: 35, locked: true });
    const cut = api.deleteLayer(edited, { index: 1 });
    const shape = d => d.frontLayers.map(l => [l.material, l.thickness, l.locked]);
    const shapes = JSON.stringify([shape(two), shape(edited), shape(cut)]);
    ok('layer edits return a new design and leave their argument', shapes === JSON.stringify([
        [['TiO2', 30, false], ['SiO2', 50, false]], [['TiO2', 35, true], ['SiO2', 50, false]], [['TiO2', 35, true]],
    ]), shapes);
    ok('each inserted layer gets an id of its own', new Set(two.frontLayers.map(l => l.id)).size === 2);
    const front = api.insertLayer({ ...blank, surfaceMode: 'symmetric' }, { material: 'TiO2', thickness: 30 });
    const mirrored = api.insertLayer(front, { index: 0, material: 'SiO2', thickness: 50 });
    ok('in symmetric mode the back mirrors the front', JSON.stringify(mirrored.backLayers.map(l => l.material)) === '["TiO2","SiO2"]');
    ok('in symmetric mode the back is not edited on its own', throws(() => api.deleteLayer(mirrored, { side: 'back', index: 0 }), /mirrors the front/));
    ok('a side the design does not evaluate is not edited', throws(() => api.insertLayer(blank, { side: 'back', material: 'TiO2', thickness: 30 }), /does not evaluate the back; to edit it, .*setDesignSetup/)
        && throws(() => api.insertLayer(api.newDesign({ surfaceMode: 'back_only' }), { material: 'TiO2', thickness: 30 }), /does not evaluate the front; to edit it/));
    const scoredWhole = api.insertLayer({ ...blank, mfEvalMode: 'total' }, { side: 'back', material: 'TiO2', thickness: 30 });
    ok('a one-sided design scored as the whole part takes layers on both sides', scoredWhole.backLayers.length === 1);
}
{
    const rated = api.setMerit(qw, [{ type: 'RAV', lambdaStart: 540, lambdaEnd: 560, target: 0.5, weight: 1 }]);
    const m = api.merit(rated);
    ok('a merit of one row is that row\'s distance from its target', Math.abs(m.total - Math.abs(m.rows[0].value - 0.5)) < 1e-12
        && m.rows[0].enabled && m.rows[0].error === null && !('meritOperands' in qw));
    // A thickness row added as in the editor covers layers 1 to 1000.
    const thin = api.insertLayer(api.insertLayer(blank, { material: 'TiO2', thickness: 30 }), { material: 'SiO2', thickness: 5 });
    const bounds = api.setMerit(thin, [{ type: 'MNT', target: 25 }, { type: 'MXT' }]);
    const [mnt, mxt] = bounds.meritOperands;
    ok('MNT and MXT rows start as the editor\'s do', mnt.lambdaStart === 1 && mnt.lambdaEnd === 1000 && mxt.target === 1000
        && Number.isFinite(api.merit(bounds).rows[0].value), JSON.stringify([mnt, mxt]));
    const kept = api.setMerit(qw, [{ type: 'ODMN', target: 0.99 }, { type: 'TT', target: 0.99 }]).meritOperands;
    ok('a target given as 0.99 is kept, not read as the editor\'s placeholder', kept.every(op => op.target === 0.99), JSON.stringify(kept.map(op => op.target)));
    const single = api.setMerit(qw, [{ type: 'R', lambdaStart: 800, lambdaEnd: 650, target: 0.5 }]);
    ok('a single-wavelength row keeps an unread band end the editor left', single.meritOperands.length === 1);
    const others = api.merit(api.setMerit(qw, [
        { type: 'TS', lambdaStart: 550, pol: 'p' }, { type: 'PSI', lambdaStart: 600, aoi: 70 },
        { type: 'MCURVE', quantity: 'R', aoi: 8, pol: 's', sampleLambdas: [500, 550, 600], sampleTargets: [0.1, 0.1, 0.1] },
        { type: 'MCURVE', quantity: 'PSI', aoi: 70, pol: 's', sampleLambdas: [500, 600], sampleTargets: [30, 30] },
        { type: 'DPR', lambdaStart: 550, pol: 'p' },
    ])).rows;
    const scopes = [m.rows[0], api.merit(single).rows[0], api.merit(bounds).rows[0], ...others]
        .map(({ lambdaStart, lambdaEnd, aoi, pol, cmp }) => JSON.stringify({ lambdaStart, lambdaEnd, aoi, pol, cmp }));
    ok('each merit row says the band, wavelength or layer range it scores', scopes.join() === [
        '{"lambdaStart":540,"lambdaEnd":560,"aoi":0,"pol":"avg"}', '{"lambdaStart":800,"aoi":0,"pol":"avg"}', '{"lambdaStart":1,"lambdaEnd":1000}',
        '{"lambdaStart":550,"aoi":0,"pol":"s"}', '{"lambdaStart":600,"aoi":70}', '{"lambdaStart":500,"lambdaEnd":600,"aoi":8,"pol":"s"}',
        '{"lambdaStart":500,"lambdaEnd":600,"aoi":70}', '{"lambdaStart":550,"aoi":0}',
    ].join(), scopes.join(' '));
    const capped = row => api.merit(api.setMerit(qw, [{ type: 'TT', target: 100000, ...row }]));
    ok('a TT row scores its comparison and says it', capped({ cmp: 'le' }).total === 0 && capped({ cmp: 'le' }).rows[0].cmp === 'le'
        && capped({}).total > 0 && capped({}).rows[0].cmp === 'eq', `${capped({ cmp: 'le' }).total} ${capped({}).total}`);
}
{
    const wide = api.spectrum(api.insertLayer(blank, { material: 'TiO2', thickness: 60 }), { from: 350, to: 900, step: 10 });
    ok('a spectrum names the materials whose data stop inside its range', wide.outOfRange.some(m => m.id.endsWith('TiO2') && m.rangeNm[0] > 350)
        && api.spectrum(qw, { from: 500, to: 600 }).outOfRange.length === 0, JSON.stringify(wide.outOfRange));
    const nk = api.materialNK('SiO2', [10, 550]);
    ok('n,k says where a material has no data', nk.nk[0].outside === true && !nk.nk[1].outside && nk.rangeNm[0] > 10, JSON.stringify(nk));
}

console.log(`\n${pass} passed, ${fail} failed`);
// The process ends once its event loop drains: process.exit() right after the
// checks aborted this short test on Windows with a libuv assertion.
process.exitCode = fail ? 1 : 0;
