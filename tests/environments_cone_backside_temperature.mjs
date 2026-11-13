/**
 * The cone of incidence, the other side and the temperature of an
 * environment (utils/environments/environments.js, environmentTemperature.js,
 * temperatureModel.js):
 *
 *   1. The temperature model against Takahashi, Appl. Opt. 34, 667 (1995),
 *      Eq. (19) worked by hand for the paper's parameters (N₀ = 1.70,
 *      ν = 0.08, β = 5.5e-7 /°C, dN/dT = 0.88e-5 × 1.70 /°C, P₀ = 1) on the
 *      substrates of its Table 4; and the substrate's own dn/dT and expansion.
 *   2. Environment 1, a design without environments, and an environment that
 *      sets the three to environment 1's values compute exactly as before.
 *   3. An environment's cone, other side and temperature compute as the
 *      design given that field computed apart, in the merit table; the
 *      temperature against a design whose thicknesses and tables are worked
 *      by hand from the paper's equations, k kept.
 *   4. A run's worker, given only the payload and the material tables,
 *      computes the same merit as the window's thread, bit for bit, and a
 *      material at another temperature gives its phase response scaled.
 *   5. The engine's thickness factors are the ones the environment applies.
 *   6. The Environments window has rows for the three, and under the
 *      temperature names the materials missing a constant.
 *   7. The Design Editor's Settings set environment 2's temperature, cone and
 *      other side with their tags, and environment 1's the design's own.
 *   8. The Eval and Cone badges under All read the first environment, the
 *      Cone badge the first with a cone, each environment's in the hover.
 *   9. Synthesis: a needle goes into an environment at its temperature as a
 *      layer of its material is deposited there; the analytic needle function
 *      is the sum of each environment's own; a synthesis worker reads
 *      environment 1's temperature and the constants from its tables; the
 *      analytic scan leaves to the finite-difference scan an environment that
 *      scores a one-sided design as the whole part; a run's floor reads an
 *      MNT row at target / f with the temperature's change in f.
 *  10. A check, a Monte Carlo trial, a Layer Sensitivity step and a systematic
 *      deviation in an environment at another temperature, computed on a
 *      worker's tables, against that environment's design built by hand.
 *  11. A film whose strain is not known (its material lacks β or ν, or its
 *      substrate lacks α) is unstrained; a constant counts as given only as a
 *      finite number; the listing names each material lacking one once, from
 *      the coatings the environment computes.
 *
 * Run: node tests/environments_cone_backside_temperature.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { DLSOptimizer, makeOperand, withDesignSampleCounts } = await import('../src/utils/physics/optimizer.js');
const { meritDisplay, evaluateForDisplay } = await import('../src/utils/physics/meritDisplay.js');
const {
    environmentDesign, environmentLayerFactors, oneEnvironmentDesign,
} = await import('../src/utils/environments/environments.js');
const { rowsScoredIn } = await import('../src/utils/environments/environmentMerit.js');
const { filmAtTemperature, substrateAtTemperature, materialAtTemperature, thermalMaterialId } = await import('../src/utils/environments/temperatureModel.js');
const { designMaterialLookup, designMaterialName, designMaterialShortName, designMaterialIds, embedDesignMaterials } = await import('../src/utils/materials/designMaterials.js');
const { materialOmegaResponse } = await import('../src/utils/materials/materialDispersion.js');
const { makeResolveMat } = await import('../src/utils/workers/resolveMat.js');
const { buildPayload, presampleMaterials } = await import('../src/utils/refinement/workerInputs.js');
const { threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { Environments } = await import('../src/components/windows/design/environments/Environments.js');
const { StackSettingsFields, settingsField } = await import('../src/components/windows/design/designEditor/StackGeometryPanel.js');
const { ConeAngleControl } = await import('../src/components/windows/design/designEditor/ConeAngleControl.js');
const { FieldTag } = await import('../src/components/windows/design/designEditor/EnvironmentRow.js');
const { SurfaceModeControl } = await import('../src/components/SurfaceModeBar.js');
const { Checkbox } = await import('../src/components/ui/Checkbox.js');
const { BadgeRow } = await import('../src/components/windows/analysis/chrome/badgeRow.js');
const { environmentViews } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentOf } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentMedia, environmentDeposit } = await import('../src/utils/environments/environments.js');
const {
    insertNeedle, scanNeedlesAnalytic, scanNeedlesFD, scanNeedlesPFunction,
} = await import('../src/utils/physics/optimizer.js');
const { needleScene } = await import('../src/utils/physics/optimizer/scanners/needleScene.js');
const { synthesisRows, serializableMedia } = await import('../src/components/windows/optimization/synthesisShared/synthesisMath.js');
const { synthesisMntFloor } = await import('../src/components/windows/optimization/synthesisShared/minThickness.js');
const { presampleSynthesisMaterials } = await import('../src/components/windows/optimization/synthesisShared/runGrid.js');
const { dispatchSynthesisJob } = await import('../src/utils/workers/synthesisWorker.js');
const { designDifferences } = await import('../src/api/designEdits.js');
const { environments: listEnvironments } = await import('../src/api/designEnvironments.js');
const { missingConstants } = await import('../src/components/windows/design/environments/environmentFields.js');
const { IntegralValues } = await import('../src/components/windows/analysis/integralValues/IntegralValues.js');
const { useOpticalEvaluation } = await import('../src/components/windows/analysis/opticalEvaluation/useOpticalEvaluation.js');
const { DesignEditor } = await import('../src/components/windows/design/designEditor/DesignEditor.js');
const { ControlBar, refinementEvalBadge } = await import('../src/components/windows/optimization/refinement/ControlBar.js');
const { seenIn, evaluateSpecification } = await import('../src/utils/environments/environmentSpecification.js');
const { evaluateQualifiers, makeQualifier } = await import('../src/utils/synthesis/qualifiers.js');
const { runErrorAnalysisMC, computeLayerSensitivity } = await import('../src/utils/physics/errorAnalysis.js');
const { makeShiftedMaterial } = await import('../src/utils/physics/errorAnalysis/spectrumEval.js');
const { evaluateSpectrum } = await import('../src/utils/physics/thinFilmMath.js');
const { emptyDeviation, computeDeviatedSpectrum, deviatedSpectrumIn } = await import('../src/utils/physics/systematicDeviations.js');
const { buildEvalContext, evaluateOperands, calcMF } = await import('../src/utils/physics/optimizer.js');
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');

const h = React.createElement;
const c = makeTheme();
const t = makeLocale('en');
const te = t.environments;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
const relative = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-300);
function* walk(node) {
    if (node == null || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const child of node) yield* walk(child); return; }
    yield node;
    yield* walk(node.props?.children);
}

let pass = 0;
const check = (name, fn) => { fn(); pass++; console.log(`  ok  ${name}`); };

// Takahashi, Appl. Opt. 34, 667 (1995), Eqs. (14), (15) and (18), written out
// again by hand at a change of temperature dT with P₀ = 1: the film's
// thickness factor and its index from N₀.
function byHand({ alpha, beta, nu, dNdT }, N0, dT) {
    const A = 2 * (alpha - beta) * (1 - 2 * nu) / (1 - nu) * dT;
    const B = 2 * nu * (alpha - beta) / (1 - nu) * dT;
    const PT = (1 + 3 * beta * dT) / (1 + 3 * beta * dT + A);
    return { d: 1 - B + beta * dT, n: (N0 + dNdT * dT) * PT + 1 - PT };
}

// ── 1. The model against the paper ─────────────────────────────────────────
// Table 4, linear expansion of each glass from -30 to 70 °C, 1e-7 /°C.
const TABLE_4 = { Crystron: 0, Quartz: 5, EL30: 34, LAM60: 54, BK7: 74, BAL2: 100, FPL51: 127, FPL53: 142 };
const PAPER = { beta: 5.5e-7, nu: 0.08, dNdT: 0.88e-5 * 1.70 };
const FILM = { linearExpansionPerK: PAPER.beta, poissonsRatio: PAPER.nu, dnDtPerK: PAPER.dNdT };
const N0 = 1.70;
const LAMBDA = 1550;
// TSCW = λ(n_T d_T / n₀ d₀ − 1), Eq. (19), over 1 °C, nm/°C.
const tscw = Object.fromEntries(Object.entries(TABLE_4).map(([glass, cle]) => {
    const change = filmAtTemperature(FILM, cle * 1e-7, 1);
    return [glass, LAMBDA * ((change.nScale * N0 + change.nOffset) * change.thicknessFactor / N0 - 1)];
}));
// n·d moves by parts in 1e6, so the last bit of n, in whichever order its
// terms are added, is some 1e-11 nm/°C of the shift.
check('the change of n·d over 1 °C is Eq. (19) by hand on every substrate of Table 4', () => {
    for (const [glass, cle] of Object.entries(TABLE_4)) {
        const hand = byHand({ alpha: cle * 1e-7, ...PAPER }, N0, 1);
        const expected = LAMBDA * (hand.n * hand.d / N0 - 1);
        assert.ok(Math.abs(tscw[glass] - expected) <= 1e-10, `${glass}: ${tscw[glass]} vs ${expected}`);
    }
});
check('and the worked numbers: +0.00466 nm/°C on BK7, -0.00510 on FPL53, falling with the expansion, below zero past about 1.1e-5 /°C', () => {
    assert.ok(Math.abs(tscw.BK7 - 0.00466) < 1e-5, String(tscw.BK7));
    assert.ok(Math.abs(tscw.FPL53 + 0.00510) < 1e-5, String(tscw.FPL53));
    const values = Object.values(tscw);
    assert.ok(values.every((v, i) => i === 0 || v < values[i - 1]), values.join(', '));
    assert.ok(tscw.BAL2 > 0 && tscw.FPL51 < 0, `${tscw.BAL2} ${tscw.FPL51}`);
});
// Table 5, the TSCW measured on BPF 1 deposited on each glass, nm/°C, and the
// paper's statement that a substrate of about 1.1e-5 /°C gives no shift. The
// model at the paper's parameters, at 1540 nm, lands within 0.001 nm/°C of
// every measurement.
const TABLE_5_BPF1 = { Crystron: 0.0150, Quartz: 0.0145, EL30: 0.0105, LAM60: 0.0076, BK7: 0.0052, BAL2: 0.0013, FPL51: -0.0031, FPL53: -0.0046 };
check('and against the paper\'s measurements: Table 5 within 0.001 nm/°C, no shift near 1.1e-5 /°C', () => {
    const at1540 = cle => {
        const change = filmAtTemperature(FILM, cle * 1e-7, 1);
        return 1540 * ((change.nScale * N0 + change.nOffset) * change.thicknessFactor / N0 - 1);
    };
    for (const [glass, cle] of Object.entries(TABLE_4)) {
        assert.ok(Math.abs(at1540(cle) - TABLE_5_BPF1[glass]) < 0.001, `${glass}: ${at1540(cle)} vs ${TABLE_5_BPF1[glass]}`);
    }
    const zero = 100 + 27 * at1540(100) / (at1540(100) - at1540(127));
    assert.ok(zero > 100 && zero < 120, `no shift at ${zero}e-7 /°C`);
});
check('the substrate takes its own dn/dT and expansion, 0 when not given', () => {
    assert.deepEqual(substrateAtTemperature({ linearExpansionPerK: 7.1e-6, dnDtPerK: 2e-6 }, 40), { thicknessFactor: 1 + 7.1e-6 * 40, nScale: 1, nOffset: 2e-6 * 40 });
    assert.deepEqual(substrateAtTemperature({}, 40), { thicknessFactor: 1, nScale: 1, nOffset: 0 });
});

// Eqs. (14), (15) and (18) at P₀ = 1 with every constant not given read as 0.
function zeroedFilm(film, substrateExpansion, deltaT) {
    const beta = film.linearExpansionPerK ?? 0;
    const nu = film.poissonsRatio ?? 0;
    const dnDt = film.dnDtPerK ?? 0;
    const strain = (substrateExpansion ?? 0) - beta;
    const a = 2 * strain * (1 - 2 * nu) / (1 - nu) * deltaT;
    const b = 2 * nu * strain / (1 - nu) * deltaT;
    const expanded = 1 + 3 * beta * deltaT;
    const packing = expanded / (expanded + a);
    return { thicknessFactor: 1 - b + beta * deltaT, nScale: packing, nOffset: packing * dnDt * deltaT + 1 - packing };
}
check('a film without the constants of its strain is unstrained: n₀ 2.3 on a glass of 9e-6 /K, 100 K warmer, keeps its index and thickness', () => {
    const at = film => filmAtTemperature(film, 9e-6, 100);
    const index = change => change.nScale * 2.3 + change.nOffset;
    assert.deepEqual(at({}), { thicknessFactor: 1, nScale: 1, nOffset: 0 });
    assert.ok(Math.abs(index(zeroedFilm({}, 9e-6, 100)) - 2.3) > 1e-3, 'where reading the missing constants as 0 moves it by a strain');
    assert.deepEqual(at({ dnDtPerK: 1e-5 }), { thicknessFactor: 1, nScale: 1, nOffset: 1e-5 * 100 }, 'its own dn/dT still moves it');
    assert.deepEqual(at({ linearExpansionPerK: 7e-6, dnDtPerK: 1e-5 }), { thicknessFactor: 1 + 7e-6 * 100, nScale: 1, nOffset: 1e-5 * 100 }, 'without ν: unstrained, d(1 + βΔT)');
    assert.deepEqual(at({ poissonsRatio: 0.27 }), { thicknessFactor: 1, nScale: 1, nOffset: 0 }, 'without β');
    const full = { linearExpansionPerK: 7e-6, poissonsRatio: 0.27, dnDtPerK: 1e-5 };
    assert.deepEqual(filmAtTemperature(full, undefined, 100), { thicknessFactor: 1 + 7e-6 * 100, nScale: 1, nOffset: 1e-5 * 100 }, 'on a substrate without α');
});
check('and a film with every constant, on a substrate with α, computes as before, bit for bit', () => {
    const films = [
        FILM, { linearExpansionPerK: 7e-6, poissonsRatio: 0.27, dnDtPerK: 1e-5 },
        { linearExpansionPerK: 5e-6, poissonsRatio: 0.25, dnDtPerK: 2e-5 }, { linearExpansionPerK: 0.55e-6, poissonsRatio: 0.17 },
        // A constant given as 0 is given: β = 0 or ν = 0 leaves the film strained.
        { linearExpansionPerK: 0, poissonsRatio: 0.25, dnDtPerK: 1e-5 }, { linearExpansionPerK: 7e-6, poissonsRatio: 0, dnDtPerK: 0 },
    ];
    for (const film of films) {
        for (const alpha of [0, 5.5e-7, 7.1e-6, 1.42e-5]) {
            for (const dT of [-40, 1, 60, 100]) assert.deepStrictEqual(filmAtTemperature(film, alpha, dT), zeroedFilm(film, alpha, dT));
        }
    }
});

// ── The design the temperature checks compute ──────────────────────────────
// Two films and a substrate of their own, each tabulated and carrying the
// constants the model reads.
const CONSTANTS = {
    'user_heat:H': { linearExpansionPerK: 5e-6, poissonsRatio: 0.25, dnDtPerK: 2e-5 },
    'user_heat:L': { linearExpansionPerK: 0.55e-6, poissonsRatio: 0.17, dnDtPerK: 1e-5 },
    'user_heat:S': { linearExpansionPerK: 7.1e-6, dnDtPerK: 2.5e-6 },
};
const TABLES = {
    'user_heat:H': [[400, 2.31, 0.002], [550, 2.25, 0.001], [700, 2.21, 0.0005], [900, 2.18, 0.0002]],
    'user_heat:L': [[400, 1.475, 0], [550, 1.462, 0], [700, 1.457, 0], [900, 1.452, 0]],
    'user_heat:S': [[400, 1.531, 0], [550, 1.519, 0], [700, 1.513, 0], [900, 1.509, 0]],
};
const record = (id, tabData, mechanical) => ({ id, name: id.split(':')[1], formulaNum: -1, interp: 'linear', tabData, ...(mechanical ? { mechanical } : {}) });
const MATERIALS = Object.fromEntries(Object.keys(TABLES).map(id => [id, record(id, TABLES[id], CONSTANTS[id])]));
const row = (fields, env) => ({ ...makeOperand(fields), ...(env ? { env } : {}) });
const ROWS = [
    row({ type: 'RAV', lambdaStart: 450, lambdaEnd: 650, target: 0, weight: 1 }),
    row({ type: 'R', lambdaStart: 550, aoi: 30, target: 0, weight: 1 }, 'env2'),
    row({ type: 'T', lambdaStart: 600, target: 1, weight: 1 }),
];
const PLAIN = {
    id: 'hot', name: 'Hot AR', incidentMedium: 'Air', exitMedium: 'Air',
    substrate: { material: 'user_heat:S', thickness: 2 }, referenceWavelength: 550,
    surfaceMode: 'front_only', mfEvalMode: 'side',
    frontLayers: [[60, 'H'], [95, 'L'], [40, 'H'], [110, 'L']].map(([thickness, m], i) => ({ id: `l${i}`, material: `user_heat:${m}`, thickness, locked: false })),
    backLayers: [], materials: MATERIALS, meritOperands: ROWS,
};
const withEnv2 = fields => ({ ...PLAIN, environments: [{ id: 'base' }, { id: 'env2', name: 'Two', ...fields }] });
const DT = 60;

// The design environment 2 at environment 1's temperature plus DT computes,
// built by hand: each table moved by the paper's equations, k kept, each
// layer and the substrate thickened.
function heatedByHand(dT) {
    const sub = CONSTANTS['user_heat:S'];
    const film = id => ({ alpha: sub.linearExpansionPerK, beta: CONSTANTS[id].linearExpansionPerK, nu: CONSTANTS[id].poissonsRatio, dNdT: CONSTANTS[id].dnDtPerK });
    const heated = {
        'user_heat:Hh': record('user_heat:Hh', TABLES['user_heat:H'].map(([l, n, k]) => [l, byHand(film('user_heat:H'), n, dT).n, k])),
        'user_heat:Lh': record('user_heat:Lh', TABLES['user_heat:L'].map(([l, n, k]) => [l, byHand(film('user_heat:L'), n, dT).n, k])),
        'user_heat:Sh': record('user_heat:Sh', TABLES['user_heat:S'].map(([l, n, k]) => [l, n + sub.dnDtPerK * dT, k])),
    };
    return {
        ...PLAIN, materials: { ...MATERIALS, ...heated },
        substrate: { material: 'user_heat:Sh', thickness: 2 * (1 + sub.linearExpansionPerK * dT) },
        frontLayers: PLAIN.frontLayers.map(layer => ({
            ...layer, material: `${layer.material}h`, thickness: layer.thickness * byHand(film(layer.material), 2, dT).d,
        })),
    };
}

// ── 2. Exactly as before ───────────────────────────────────────────────────
check('environment 1, and a design without environments, compute the object given, while environment 2 computes its own', () => {
    const lit = withEnv2({ cone: { enabled: true, halfAngleDeg: 8 }, mfEvalMode: 'total', temperatureC: 80 });
    assert.equal(environmentDesign(lit, 'base'), lit);
    const second = environmentDesign(lit, 'env2');
    assert.deepEqual([second.cone, second.mfEvalMode, second.temperatureC], [{ enabled: true, halfAngleDeg: 8 }, 'total', 80]);
    assert.equal(environmentDesign(PLAIN), PLAIN);
    assert.equal(oneEnvironmentDesign(PLAIN), PLAIN);
});
check('an environment that sets the three to environment 1\'s computes as one that sets none, bit for bit', () => {
    const cone = { enabled: true, halfAngleDeg: 5, gridPoints: 3 };
    const none = { ...withEnv2({ incidentMedium: 'H2O' }), cone };
    const same = { ...withEnv2({ incidentMedium: 'H2O', temperatureC: 20, mfEvalMode: 'side', cone: { halfAngleDeg: 5 } }), cone };
    // eslint-disable-next-line no-unused-vars
    const seen = design => { const { environments, ...rest } = environmentDesign(design, 'env2'); return rest; };
    assert.deepEqual(seen(same), seen(none));
    assert.equal(seen(same).frontLayers, none.frontLayers, 'the layer list itself, no layer copied');
    assert.equal(JSON.stringify(evaluateForDisplay(same, ROWS)), JSON.stringify(evaluateForDisplay(none, ROWS)));
});

// ── 3. The merit ───────────────────────────────────────────────────────────
const env2Merit = design => meritDisplay(design, ROWS).environments.find(group => group.id === 'env2');
const apartMerit = given => meritDisplay(given, rowsScoredIn(ROWS, 'env2').map(op => ({ ...op, env: undefined })));
check('environment 2\'s cone computes as the design given that cone', () => {
    const cone = { enabled: true, halfAngleDeg: 10, gridPoints: 3 };
    const got = env2Merit(withEnv2({ cone }));
    const given = apartMerit({ ...PLAIN, cone });
    assert.equal(got.mf, given.mf);
    assert.notEqual(got.mf, env2Merit(withEnv2({})).mf);
});
check('environment 2\'s other side computes as the design given it', () => {
    const got = env2Merit(withEnv2({ mfEvalMode: 'total' }));
    assert.equal(got.mf, apartMerit({ ...PLAIN, mfEvalMode: 'total' }).mf);
    assert.notEqual(got.mf, env2Merit(withEnv2({})).mf);
});
check('environment 2\'s temperature computes as the design worked by hand from the paper\'s equations', () => {
    const got = env2Merit(withEnv2({ temperatureC: 20 + DT }));
    const hand = apartMerit(heatedByHand(DT));
    assert.ok(relative(got.mf, hand.mf) <= 1e-10, `${got.mf} vs ${hand.mf}`);
    assert.ok(relative(got.mf, env2Merit(withEnv2({})).mf) > 1e-6, 'and differs from environment 1\'s');
    const cooler = { ...withEnv2({ temperatureC: 20 + DT }), temperatureC: 20 + DT };
    assert.equal(env2Merit(cooler).mf, env2Merit(withEnv2({})).mf, 'the change is from environment 1\'s temperature, the design\'s own');
});
check('k is kept, and the media are not changed', () => {
    const seen = environmentDesign(withEnv2({ temperatureC: 20 + DT }), 'env2');
    const lookup = designMaterialLookup(seen);
    const [, k] = lookup(seen.frontLayers[0].material).getNK(550);
    assert.equal(k, 0.001);
    assert.equal(seen.incidentMedium, 'Air');
    assert.ok(designMaterialIds(seen).every(id => !id.startsWith('thermal:')), 'and the materials it lists are those the design names');
});

check('a stress row of environment 2 reads the films\' stress at the design\'s stress temperature moved by environment 2\'s change', () => {
    const stiff = Object.fromEntries(Object.entries(MATERIALS).map(([id, rec]) => [id, {
        ...rec, mechanical: { ...rec.mechanical, youngsModulusGPa: 100, intrinsicStressMPa: -200 },
    }]));
    const str = row({ type: 'STR', target: 0, weight: 1 }, 'env2');
    const run = { temperatureC: 25, depositionTemperatureC: 200 };
    const design = { ...withEnv2({ temperatureC: 20 + DT }), materials: stiff, stress: run, meritOperands: [str] };
    const got = meritDisplay(design, [str]).environments.find(group => group.id === 'env2').mf;
    const apart = stressAt => meritDisplay({ ...oneEnvironmentDesign(design, 'env2'), stress: { ...run, temperatureC: stressAt } }, [{ ...str, env: undefined }]).mf;
    assert.equal(got, apart(25 + DT));
    assert.ok(relative(got, apart(25)) > 1e-3, `${got} vs ${apart(25)}: the temperature moves the stress`);
    assert.equal(environmentDesign({ ...design, stress: undefined }, 'env2').stress, undefined, 'and a design that states no stress temperatures has none');
});

check('designDifferences tells two designs apart by environment 1\'s temperature', () => {
    const warm = withEnv2({ temperatureC: 80 });
    const found = designDifferences(warm, { ...warm, temperatureC: 40 });
    assert.equal(found.same, false);
    assert.deepEqual(found.setup, [{ setting: 'temperatureC', before: 20, after: 40 }]);
    assert.equal(designDifferences(warm, { ...warm, temperatureC: 20 }).same, true, '20 °C is what a design that states none is at');
});

check('a Herpin layer saved without its material resolves in an environment at another temperature', () => {
    const herpin = { id: 'hp', material: 'herpin-1', thickness: 80, locked: false, herpin: { version: 1, equivalentIndex: 1.9, referenceWavelength: 550 } };
    const seen = environmentDesign({ ...withEnv2({ temperatureC: 20 + DT }), frontLayers: [herpin, ...PLAIN.frontLayers] }, 'env2');
    assert.equal(seen.frontLayers[0].material, 'herpin-1', 'carrying no constant, it is unstrained and keeps its index');
    const id = thermalMaterialId('herpin-1', { nScale: 0.999, nOffset: 0.0012 });
    const warm = { ...seen, frontLayers: [{ ...seen.frontLayers[0], material: id }, ...seen.frontLayers.slice(1)] };
    assert.doesNotThrow(() => designMaterialLookup(warm)(id), 'and its material at another temperature resolves');
});

// ── 4. The worker ──────────────────────────────────────────────────────────
check('a worker given the payload and the tables computes the window thread\'s merit, bit for bit', () => {
    const design = withEnv2({ temperatureC: 20 + DT, cone: { enabled: true, halfAngleDeg: 6, gridPoints: 2 }, mfEvalMode: 'total' });
    const rows = withDesignSampleCounts(ROWS, design, designMaterialLookup(design));
    const here = new DLSOptimizer(rows, design, designMaterialLookup(design));
    const worker = new DLSOptimizer(rows, buildPayload(design), makeResolveMat(presampleMaterials(design, rows), 'test', () => {}));
    assert.equal(worker.mf, here.mf);
    assert.ok(relative(here.mf, meritDisplay(design, rows).mf) <= 1e-12, `${here.mf} vs ${meritDisplay(design, rows).mf}`);
});
check('the worker reads the design\'s own temperature from the payload', () => {
    const design = { ...withEnv2({ temperatureC: 20 + DT }), temperatureC: 35 };
    assert.equal(buildPayload(design).temperatureC, 35);
    const rows = withDesignSampleCounts(ROWS, design, designMaterialLookup(design));
    const worker = new DLSOptimizer(rows, buildPayload(design), makeResolveMat(presampleMaterials(design, rows), 'test', () => {}));
    assert.equal(worker.mf, new DLSOptimizer(rows, design, designMaterialLookup(design)).mf);
});
check('a material at another temperature gives its phase response with n scaled and offset, k kept', () => {
    const base = designMaterialLookup(PLAIN)('user_heat:H');
    const id = thermalMaterialId('user_heat:H', { nScale: 0.999, nOffset: 0.0012 });
    const warm = materialAtTemperature(base, id);
    const [b, w] = [materialOmegaResponse(base, 600), materialOmegaResponse(warm, 600)];
    assert.ok(relative(w.nk[0], 0.999 * b.nk[0] + 0.0012) <= 1e-15 && w.nk[1] === b.nk[1]);
    assert.ok(w.derivatives.every((d, i) => relative(d[0], 0.999 * b.derivatives[i][0]) <= 1e-15 && d[1] === b.derivatives[i][1]));
    assert.deepEqual(warm.getNK(600), [0.999 * base.getNK(600)[0] + 0.0012, base.getNK(600)[1]]);
    const saved = embedDesignMaterials({ ...PLAIN, frontLayers: [{ ...PLAIN.frontLayers[0], material: id }] });
    assert.ok(!Object.keys(saved.materials).some(key => key.startsWith('thermal:')), 'and a save embeds the material it is made from');
});

// ── 5. The engine's factors ────────────────────────────────────────────────
check('the engine scales each layer as the environment does', () => {
    const design = withEnv2({ temperatureC: 20 + DT, thicknessFactors: { 'user_heat:H': 0.97 } });
    const seen = environmentDesign(design, 'env2');
    const factors = environmentLayerFactors(design, 'env2', design.frontLayers);
    assert.deepEqual(seen.frontLayers.map(layer => layer.thickness), design.frontLayers.map((layer, i) => layer.thickness * factors[i]));
    assert.ok(Math.abs(factors[0] / 0.97 - byHand({ alpha: 7.1e-6, beta: 5e-6, nu: 0.25, dNdT: 0 }, 2, DT).d) < 1e-15);
});

// ── 6. The Environments window ─────────────────────────────────────────────
const render = design => renderToStaticMarkup(withDesign(h(Environments, { c, t }), design));
const rowOf = (html, label) => html.slice(html.indexOf(`title="${esc(label)}"`)).split('</tr>')[0];
check('the window has rows for the cone, the other side and the temperature, environment 2\'s dim until set', () => {
    const three = threeEnvironmentDesign();
    const html = render({ ...three, environments: three.environments.map(env => (env.id === 'env2' ? { ...env, temperatureC: 60 } : env)) });
    for (const label of [te.cone, te.backSide, te.temperature, te.constantsMissing]) assert.ok(html.includes(`title="${esc(label)}"`), label);
    assert.ok(rowOf(html, te.cone).includes(esc(te.followsCellTip)), 'environment 2 follows environment 1\'s cone');
    assert.ok(rowOf(html, te.backSide).includes(`>${esc(te.backSideIgnored)}<`), 'the other side in words');
});
check('under the temperature it names each material lacking a constant, in the environments at another temperature', () => {
    const three = threeEnvironmentDesign();
    const hot = { ...three, environments: three.environments.map(env => (env.id === 'env2' ? { ...env, temperatureC: 60 } : env)) };
    const cells = rowOf(render(hot), te.constantsMissing);
    for (const id of ['builtin:TiO2', 'builtin:MgF2', 'builtin:Al2O3']) assert.ok(cells.includes(esc(designMaterialShortName(hot, id))), id);
    assert.ok(cells.includes(esc(t.materialEditor.mechanicalFields.poissonsRatio)), 'the hover names the constants');
    assert.ok(!cells.includes(esc(designMaterialShortName(hot, 'builtin:BK7'))), 'environment 1\'s substrate is not environment 2\'s');
    const level = { ...three, environments: three.environments.map(env => (env.id === 'env2' ? { ...env, temperatureC: 20 } : env)) };
    assert.ok(!rowOf(render(level), te.constantsMissing).includes(esc(designMaterialShortName(hot, 'builtin:TiO2'))), 'none at environment 1\'s temperature');
    const own = withEnv2({ temperatureC: 80 });
    assert.deepEqual(missingConstants(own, 'env2'), [], 'none for materials that carry every constant');
    assert.ok(!rowOf(render(own), te.constantsMissing).includes('>H<'));
    const bare = { ...own, materials: { ...MATERIALS, 'user_heat:H': { ...MATERIALS['user_heat:H'], mechanical: { linearExpansionPerK: 5e-6 } } } };
    assert.deepEqual(missingConstants(bare, 'env2'), [{ id: 'user_heat:H', missing: ['poissonsRatio', 'dnDtPerK'] }]);
    assert.ok(rowOf(render(bare), te.constantsMissing).includes('>H<'), 'and a film lacking two is named');
});

// ── 7. The Design Editor's Settings ────────────────────────────────────────
check('under the temperature it names the materials lacking a constant, so a temperature that changes nothing says why', () => {
    const three = threeEnvironmentDesign();
    const hot = { ...three, environments: three.environments.map(env => (env.id === 'env2' ? { ...env, temperatureC: 60 } : env)) };
    const noteOf = id => {
        const fields = StackSettingsFields({
            design: hot, media: environmentMedia(hot, id), current: currentEnvironmentOf(hot, id),
            updateDesign: () => {}, refLambda: 550, c, t,
        });
        const row = [...walk(fields)].find(node => node.type?.name === 'TemperatureRow');
        return [...walk(row.type(row.props))].find(node => node.props?.title?.startsWith(te.constantsMissingTip));
    };
    const note = noteOf('env2');
    assert.ok(note && String(note.props.children).includes(designMaterialShortName(hot, 'builtin:TiO2')), 'environment 2 at 60 °C names TiO2');
    assert.ok(note.props.title.includes(t.materialEditor.mechanicalFields.poissonsRatio), 'and its hover the constants it lacks');
    assert.equal(noteOf('base'), undefined, 'environment 1 has none: its temperature is the one the others change from');
});
check('in environment 2 the temperature, the cone and Ignore other side set its own, with the tag and its cross', () => {
    const design = threeEnvironmentDesign();
    const edits = [];
    const props = currentId => ({
        design, media: environmentMedia(design, currentId), current: currentEnvironmentOf(design, currentId),
        updateDesign: patch => edits.push(patch), refLambda: 550, c, t,
    });
    const apply = patch => ({ ...design, ...patch });
    const temperatureRow = tree => [...walk(tree)].find(node => node.type?.name === 'TemperatureRow');

    const second = StackSettingsFields(props('env2'));
    const temperature = temperatureRow(second).props.field;
    assert.equal(temperature.value, 20);
    assert.equal(temperature.tag.type, FieldTag);
    temperature.set(60);
    const hot = apply(edits.pop());
    assert.deepEqual([hot.environments[1].temperatureC, hot.temperatureC], [60, undefined], 'environment 2 sets its own temperature');
    temperatureRow(StackSettingsFields({ ...props('env2'), design: hot })).props.field.tag.props.onReset();
    assert.equal(apply(edits.pop()).environments[1].temperatureC, undefined, 'the cross gives it back');
    temperatureRow(StackSettingsFields(props('base'))).props.field.set(35);
    assert.deepEqual(edits.pop(), { temperatureC: 35 }, 'in environment 1 the design\'s own');

    const coneField = [...walk(second)].find(node => node.type === ConeAngleControl).props.field;
    const checkbox = [...walk(ConeAngleControl({ design, updateDesign: () => {}, c, t, field: coneField }))].find(node => node.type === Checkbox);
    checkbox.props.onChange({ target: { checked: true } });
    assert.deepEqual(apply(edits.pop()).environments[1].cone, { enabled: true, halfAngleDeg: 7.5, distribution: 'uniform', gridPoints: 15 },
        'the cone it computes with is the one the control shows');
    assert.equal([...walk(StackSettingsFields(props('base')))].find(node => node.type === ConeAngleControl).props.field, null,
        'environment 1\'s cone is the design\'s own, as before');

    const backSide = settingsField(props('env2'), 'mfEvalMode');
    const ignore = [...walk(SurfaceModeControl({ design, updateDesign: () => {}, c, t, backSide }))]
        .find(node => node.props?.text === t.modeBar.ignoreLabel);
    ignore.props.onChange({ target: { checked: false } });
    assert.deepEqual([apply(edits.pop()).environments[1].mfEvalMode, design.mfEvalMode], ['total', 'side'], 'Ignore other side is environment 2\'s');
});

check('the back tab stays editable while any environment scores the whole part, whichever is current', () => {
    const editor = (design, current) => {
        currentEnvironmentSession.write(design, { current });
        return renderToStaticMarkup(withDesign(h(DesignEditor, { c, t }), design));
    };
    const ignored = esc(t.modeBar.tabDisabledIgnored);
    const whole = { ...withEnv2({ mfEvalMode: 'side' }), mfEvalMode: 'total' };
    assert.ok(!editor(whole, 'env2').includes(ignored), 'environment 1 scores the back layers');
    assert.ok(editor(withEnv2({}), 'env2').includes(ignored), 'and with every environment on its coated side the back tab is dormant');
    currentEnvironmentSession.write(whole, { current: 'base' });
});

// ── 8. The badges ──────────────────────────────────────────────────────────
check('under All the badges read the first environment, the Cone badge the first with a cone, each environment\'s in the hover', () => {
    const three = threeEnvironmentDesign();
    const lit = { ...three, environments: three.environments.map(env => (env.id === 'env2' ? { ...env, cone: { enabled: true, halfAngleDeg: 9 }, mfEvalMode: 'total' } : env)) };
    const views = environmentViews(lit, 'all', 'base');
    const environment = { shown: true, design: lit, overlay: true, choice: 'all', setChoice() {}, currentNumber: 1, every: true, views };
    const html = renderToStaticMarkup(h(BadgeRow, { c, t, design: lit, environment, cone: true }));
    assert.ok(html.includes(`${t.modeBar.evalBadgeLabel}: ${t.modeBar.evalBadge.front}`), 'Eval reads environment 1');
    assert.ok(html.includes('1 · BK7: FRONT') && html.includes('2 · Sapphire: TOTAL'), 'each environment\'s mode in its hover');
    assert.ok(html.includes(`${t.designEditor.cone.badge} ±9°`), 'the Cone badge shows environment 2\'s cone');
    assert.ok(html.includes(`1 · BK7: ${te.noCone}`), 'and environment 1 has none');
    const one = renderToStaticMarkup(h(BadgeRow, { c, t, design: three, environment: { ...environment, every: false, views: environmentViews(three, 'all', 'base').slice(0, 1) }, cone: true }));
    assert.ok(!one.includes(`${t.designEditor.cone.badge} ±`), 'with environment 1 alone shown and no cone, no Cone badge');
});

check('Integral Values draws an environment whose own side has layers, though environment 1\'s has none', () => {
    const backOnly = { ...PLAIN, frontLayers: [], backLayers: PLAIN.frontLayers, environments: [{ id: 'base' }, { id: 'env2', name: 'Two', mfEvalMode: 'total' }] };
    const shown = current => {
        currentEnvironmentSession.write(backOnly, { current });
        environmentChoiceSession.write(backOnly, { choice: 'current' });
        return renderToStaticMarkup(withDesign(h(IntegralValues, { c, t, theme: c }), backOnly));
    };
    assert.ok(shown('base').includes(esc(t.analysisChrome.noFrontLayers)), 'environment 1 scores its bare front alone');
    assert.ok(!shown('env2').includes(esc(t.analysisChrome.noFrontLayers)), 'environment 2 scores the whole part');
});
check('and Optical Evaluation\'s empty state, while the worker computes under a cone, reads the environment shown', () => {
    const backOnly = {
        ...PLAIN, frontLayers: [], backLayers: PLAIN.frontLayers, cone: { enabled: true, halfAngleDeg: 6, gridPoints: 2 },
        environments: [{ id: 'base' }, { id: 'env2', name: 'Two', mfEvalMode: 'total' }],
    };
    let state = null;
    const Probe = () => { state = useOpticalEvaluation(); return null; };
    const showEmpty = (current) => {
        currentEnvironmentSession.write(backOnly, { current });
        environmentChoiceSession.write(backOnly, { choice: 'current' });
        renderToStaticMarkup(withDesign(h(Probe), backOnly));
        return [state.data, state.showEmpty];
    };
    assert.deepEqual(showEmpty('base'), [null, true], 'environment 1 computes its bare front alone');
    assert.deepEqual(showEmpty('env2'), [null, false], 'environment 2 the whole part');
});

check('Refinement\'s Eval badge reads the first environment a run scores, and names each one\'s in its hover', () => {
    const noop = () => {};
    const bar = design => renderToStaticMarkup(withDesign(h(ControlBar, {
        running: false, iter: 0, mf: 0.1, mfBest: 0.1, mfInitial: 0.1, canReset: false, method: 'dls', nRestarts: 1, perturbPct: 10,
        restartIdx: 0, maxIter: 50, stopReason: null, surfaceMode: 'front_only', ...refinementEvalBadge(design, t),
        onRun: noop, onStop: noop, onReset: noop, onBest: noop, onMethod: noop, onNRestarts: noop, onPerturbPct: noop, onMaxIter: noop, t, c,
    }), design));
    const html = bar(withEnv2({ mfEvalMode: 'total' }));
    assert.ok(html.includes(`>${esc(t.modeBar.evalBadgeLabel)}: ${esc(t.modeBar.evalBadge.front)}<`), 'environment 1 on its coated side');
    assert.ok(html.includes(`1: ${esc(t.modeBar.evalBadge.front)}`) && html.includes(`2 · Two: ${esc(t.modeBar.evalBadge.total)}`), 'each environment\'s in the hover');
    const second = bar({ ...withEnv2({ mfEvalMode: 'total' }), environments: [{ id: 'base', enabled: false }, { id: 'env2', name: 'Two', mfEvalMode: 'total' }] });
    assert.ok(second.includes(`>${esc(t.modeBar.evalBadgeLabel)}: ${esc(t.modeBar.evalBadge.total)}<`), 'with environment 1 off, environment 2\'s');
    assert.deepEqual(refinementEvalBadge(PLAIN, t), { mfEvalMode: 'side', evalDetail: null }, 'a design without environments as before');
});

// ── 9. Synthesis ───────────────────────────────────────────────────────────
// Single-wavelength rows, so a scan's grid and the merit tables' are the same.
const SYNTHESIS_ROWS = [
    row({ type: 'R', lambdaStart: 480, aoi: 0, target: 0, weight: 1 }),
    row({ type: 'R', lambdaStart: 560, aoi: 20, target: 0, weight: 2 }),
    row({ type: 'T', lambdaStart: 520, aoi: 0, target: 0.99, weight: 1 }, 'env2'),
    row({ type: 'R', lambdaStart: 640, aoi: 0, target: 0, weight: 1 }, 'base'),
];
const HOT = { temperatureC: 20 + DT, thicknessFactors: { 'user_heat:H': 0.97 }, materialSwaps: { 'user_heat:L': 'builtin:MgF2' } };
const hotDesign = (fields = HOT, own = {}) => ({ ...withEnv2(fields), ...own, meritOperands: SYNTHESIS_ROWS });
const synthesisLookup = designMaterialLookup(hotDesign());
const POOL = ['user_heat:H', 'user_heat:L', 'builtin:MgF2'].map(id => ({ id, name: id, mat: synthesisLookup(id) }));
const scanArgs = design => ({
    operands: synthesisRows(design, design.meritOperands), design, resolveMat: designMaterialLookup(design),
    candidateMats: POOL, deltaNm: 0.5, nIntra: 3, side: 'front',
});
const tableOmf = design => evaluateForDisplay(design, synthesisRows(design, design.meritOperands)).omf;

check('a needle goes into environment 2 at its temperature as a layer of its material is deposited there', () => {
    const design = hotDesign();
    const scene = needleScene(scanArgs(design));
    for (const [id, nm] of [['user_heat:H', 9], ['user_heat:L', 7]]) {
        const put = tableOmf(insertNeedle(design, 2, id, nm, 'front'));
        const scanned = scene.gap(2, id, synthesisLookup(id), nm);
        assert.ok(relative(scanned, put) <= 1e-12, `${id}: ${scanned} vs the tables' ${put}`);
    }
});
check('the analytic needle function is Σ f·OMF_k·P_k / (N·OMF), each environment scanned on its own with the needle as it deposits it', () => {
    const design = hotDesign();
    const args = scanArgs(design);
    const total = scanNeedlesAnalytic(args);
    const each = ['base', 'env2'].map((id) => {
        const deposit = environmentDeposit(design, id);
        const own = oneEnvironmentDesign(design, id);
        const deposited = POOL.map(p => ({ ...p, mat: synthesisLookup(deposit(p.id).material) }));
        return { deposit, scan: scanNeedlesAnalytic({ ...args, operands: rowsScoredIn(args.operands, id), design: own, candidateMats: deposited }) };
    });
    for (const c of total.candidates.filter(candidate => !candidate.intra)) {
        const sum = each.reduce((acc, { deposit, scan }) => {
            const mine = scan.candidates.find(o => !o.intra && o.pos === c.pos && o.materialId === c.materialId);
            return acc + deposit(c.materialId).factor * scan.mf0 * mine.grad;
        }, 0);
        const expected = sum / (each.length * total.mf0);
        assert.ok(relative(c.grad, expected) <= 1e-9, `${c.materialId} at ${c.pos}: ${c.grad} vs ${expected}`);
    }
});
check('with environment 2\'s own cone as well, the analytic slope is the finite-difference scan\'s', () => {
    const design = hotDesign({ ...HOT, cone: { enabled: true, halfAngleDeg: 9, gridPoints: 3 } });
    const args = scanArgs(design);
    const analytic = scanNeedlesAnalytic(args);
    const fd = scanNeedlesFD({ ...args, deltaNm: 1e-5 });
    assert.ok(relative(analytic.mf0, tableOmf(design)) <= 1e-12, `${analytic.mf0} vs ${tableOmf(design)}`);
    const scale = Math.max(...analytic.candidates.map(c => Math.abs(c.grad)));
    analytic.candidates.forEach((c, i) => assert.ok(Math.abs(c.grad - fd.candidates[i].grad) <= 1e-4 * scale,
        `${c.materialId} at ${c.pos}: ${c.grad} vs ${fd.candidates[i].grad}`));
});
check('a scan in the synthesis worker reads environment 1\'s temperature and the constants from its tables', () => {
    const design = hotDesign(HOT, { temperatureC: 35 });
    assert.equal(serializableMedia(design).temperatureC, 35);
    assert.equal('temperatureC' in serializableMedia({ ...PLAIN, temperatureC: 35 }), false, 'not for a design without environments');
    const rows = synthesisRows(design, design.meritOperands);
    const posted = { ...serializableMedia(design), frontLayers: design.frontLayers, backLayers: [] };
    const job = { type: 'scan', operands: rows, design: posted, poolSlice: POOL.map(({ id, name }) => ({ id, name })), deltaNm: 0.5, side: 'front', dMin: 1, nIntra: 3 };
    let answer = null;
    dispatchSynthesisJob(job, makeResolveMat(presampleSynthesisMaterials(design, rows, POOL), 'test', () => {}), (m) => { if (m.type === 'result') answer = m; });
    assert.ok(relative(answer.mf0, tableOmf(design)) <= 1e-12, `${answer.mf0} vs the tables' ${tableOmf(design)}`);
});
check('the analytic scan leaves to the finite-difference scan an environment that scores the one-sided design as the whole part', () => {
    const design = hotDesign({ mfEvalMode: 'total' });
    const args = scanArgs(design);
    assert.equal(scanNeedlesAnalytic(args), null);
    assert.deepEqual(scanNeedlesPFunction(args), scanNeedlesFD(args));
});
check('and scans analytically when the whole part is scored only in environment 1, which is off', () => {
    const design = hotDesign({ ...HOT, mfEvalMode: 'side' }, { mfEvalMode: 'total' });
    design.environments = [{ id: 'base', enabled: false }, ...design.environments.slice(1)];
    const args = scanArgs(design);
    const analytic = scanNeedlesAnalytic(args);
    assert.ok(analytic, 'the analytic scan runs');
    const fd = scanNeedlesFD({ ...args, deltaNm: 1e-5 });
    const scale = Math.max(...analytic.candidates.map(c => Math.abs(c.grad)));
    analytic.candidates.forEach((c, i) => assert.ok(Math.abs(c.grad - fd.candidates[i].grad) <= 1e-4 * scale,
        `${c.materialId} at ${c.pos}: ${c.grad} vs ${fd.candidates[i].grad}`));
});
check('a run\'s floor reads an MNT row at target / f, f with the change environment 2\'s temperature makes', () => {
    const mnt = row({ type: 'MNT', lambdaStart: 1, lambdaEnd: 4, target: 20, weight: 1 });
    const design = { ...withEnv2({ temperatureC: 20 + DT }), meritOperands: [SYNTHESIS_ROWS[0], mnt] };
    const factors = ['user_heat:H', 'user_heat:L'].map(id => environmentDeposit(design, 'env2')(id).factor);
    assert.ok(factors[1] < 1 && factors[0] > 1, factors.join(', '));
    assert.ok(Math.abs(factors[1] - byHand({ alpha: 7.1e-6, beta: 0.55e-6, nu: 0.17, dNdT: 0 }, 2, DT).d) < 1e-15);
    assert.equal(synthesisMntFloor(design), 20 / factors[1]);
    assert.equal(synthesisMntFloor({ ...withEnv2({}), meritOperands: design.meritOperands }), 20, 'at environment 1\'s temperature');
});

// ── 10. The specification and the tolerance windows ────────────────────────
// Computed as a worker computes them: the design without the materials it
// carries, every material and constant read from the worker's tables. Each is
// compared with environment 2's design worked by hand from the paper's
// equations (heatedByHand), the step or the errors made on the recipe.
const HEATED = withEnv2({ temperatureC: 20 + DT });
const HAND = heatedByHand(DT);
const handLookup = designMaterialLookup(HAND);
// eslint-disable-next-line no-unused-vars
const { materials: carried, ...inWorker } = HEATED;
const workerTables = makeResolveMat(presampleMaterials(HEATED, withDesignSampleCounts(ROWS, HEATED, designMaterialLookup(HEATED))), 'test', () => {});
const SUBSTRATE = CONSTANTS['user_heat:S'];
const thickened = id => byHand({ alpha: SUBSTRATE.linearExpansionPerK, beta: CONSTANTS[id].linearExpansionPerK, nu: CONSTANTS[id].poissonsRatio, dNdT: 0 }, 2, DT).d;
const TOLERANCE_PARAMS = { lambdaStart: 420, lambdaEnd: 680, lambdaStep: 20, theta: 0, polarization: 'avg' };
const closeAll = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 1e-12);

check('a check of environment 2 at another temperature, judged with a worker\'s tables, is the check on its design built by hand', () => {
    const q = makeQualifier({ kind: 'R_AT', channel: 'R', cmp: 'le', target: 0.05, lambda: 550, env: 'env2' });
    const [judged] = evaluateSpecification([q], inWorker, {}, id => seenIn(inWorker, id, workerTables));
    const [hand] = evaluateQualifiers([{ ...q, env: undefined }], HAND, handLookup);
    assert.ok(relative(judged.environments[0].result.value, hand.value) <= 1e-10, `${judged.environments[0].result.value} vs ${hand.value}`);
});
const trialRun = await runErrorAnalysisMC(inWorker, TOLERANCE_PARAMS, workerTables, {
    char: 'R', evalMode: 'front', nTrials: 1, seed: 777, rmsRelPct: 3, rmsAbsNm: 0.5, rmsReN: 0.01, rmsImN: 0.002,
    recordTrials: true, environments: ['env2'],
});
check('a Monte Carlo trial in environment 2, run on a worker\'s tables, is the trial coating built by hand there', () => {
    const run = trialRun;
    const [{ dThkF, dnF, dkF }] = run.trials;
    const layers = PLAIN.frontLayers.map((layer, i) => ({
        material: makeShiftedMaterial(handLookup(HAND.frontLayers[i].material), dnF[i], dkF[i]),
        thickness: thickened(layer.material) * Math.max(0, layer.thickness + dThkF[i]),
    }));
    const hand = evaluateSpectrum(TOLERANCE_PARAMS, handLookup('Air'), handLookup(HAND.substrate.material), layers);
    assert.ok(closeAll(run.mean, Array.from(hand.R)), 'the trial\'s spectrum');
});
check('a Layer Sensitivity step in environment 2, on a worker\'s tables, is the step seen on its design built by hand', () => {
    const rows = SYNTHESIS_ROWS;
    const { rows: ranked } = computeLayerSensitivity({ ...inWorker, meritOperands: rows }, rows, workerTables, { env: 'env2', mode: 'absolute', absDeltaNm: 2 });
    const own = rowsScoredIn(rows, 'env2').map(op => ({ ...op, env: undefined }));
    const mfWith = layers => calcMF(own, evaluateOperands(own, buildEvalContext({ ...HAND, frontLayers: layers }, handLookup)), { skipConstraints: true });
    const mf0 = mfWith(HAND.frontLayers);
    for (const row of ranked) {
        const at = d => mfWith(HAND.frontLayers.map((layer, j) => (j === row.layerIndex ? { ...layer, thickness: thickened(PLAIN.frontLayers[j].material) * d } : layer)));
        const d = PLAIN.frontLayers[row.layerIndex].thickness;
        const hand = (Math.abs(at(d + 2) - mf0) + Math.abs(at(d - 2) - mf0)) / 2;
        assert.ok(relative(row.deltaMFAbs, hand) <= 1e-9, `layer ${row.layerIndex}: ${row.deltaMFAbs} vs ${hand}`);
    }
});
check('a systematic deviation in environment 2, on a worker\'s tables, is the deviation on its design built by hand, the substrate\'s own shift included', () => {
    const deviation = { ...emptyDeviation(), globalDeltaN: 0.01, globalThicknessScale: 1.02, perMaterial: { 'user_heat:S': { dn: 0.03, dk: 0 } } };
    const got = deviatedSpectrumIn({ design: inWorker, params: TOLERANCE_PARAMS, deviation, evalMode: 'front', resolveMat: workerTables, envId: 'env2' });
    const handDeviation = { ...deviation, perMaterial: { [HAND.substrate.material]: { dn: 0.03, dk: 0 } } };
    const hand = computeDeviatedSpectrum(HAND, TOLERANCE_PARAMS, handDeviation, 'front', handLookup);
    assert.ok(closeAll(Array.from(got.R), Array.from(hand.R)), 'the deviated spectrum');
});

// ── 11. A film whose strain is not known ───────────────────────────────────
check('100 K warmer on a glass of 9e-6 /K, a film carrying no constant keeps its index and thickness, and the listing names what each material lacks', () => {
    const design = {
        ...withEnv2({ temperatureC: 120 }),
        substrate: { material: 'user_heat:G', thickness: 2 },
        materials: { ...MATERIALS, 'user_heat:G': record('user_heat:G', TABLES['user_heat:S'], { linearExpansionPerK: 9e-6 }) },
        frontLayers: [{ id: 'ti', material: 'builtin:TiO2', thickness: 80, locked: false }, ...PLAIN.frontLayers],
    };
    const seen = environmentDesign(design, 'env2');
    assert.deepEqual([seen.frontLayers[0].material, seen.frontLayers[0].thickness], ['builtin:TiO2', 80], 'TiO2, which carries no constant, is as it was');
    assert.ok(seen.frontLayers[1].material.startsWith('thermal:'), 'a film with every constant still changes');
    const [first, second] = listEnvironments(design);
    assert.deepEqual(first.constantsMissing, [], 'environment 1 lists none');
    assert.deepEqual(second.constantsMissing.map(m => [m.material, m.fields]),
        [['builtin:TiO2', ['linearExpansionPerK', 'poissonsRatio', 'dnDtPerK']], ['user_heat:G', ['dnDtPerK']]]);
    assert.equal(second.constantsMissing[0].name, designMaterialName(design, 'builtin:TiO2'), 'by the name the material is shown by');
    assert.deepEqual(listEnvironments(withEnv2({ temperatureC: 20 }))[1].constantsMissing, [], 'and none at environment 1\'s temperature');
});
check('on a substrate without α, a film with every constant is unstrained: d(1 + βΔT) and n + (dN/dT)ΔT, and the substrate is named', () => {
    const design = {
        ...withEnv2({ temperatureC: 20 + DT }),
        substrate: { material: 'user_heat:N', thickness: 2 },
        materials: { ...MATERIALS, 'user_heat:N': record('user_heat:N', TABLES['user_heat:S'], { dnDtPerK: 2.5e-6 }) },
    };
    const seen = environmentDesign(design, 'env2');
    PLAIN.frontLayers.forEach((layer, i) => {
        const own = CONSTANTS[layer.material];
        assert.ok(relative(seen.frontLayers[i].thickness, layer.thickness * (1 + own.linearExpansionPerK * DT)) <= 1e-15, `layer ${i}: ${seen.frontLayers[i].thickness}`);
        assert.equal(seen.frontLayers[i].material, thermalMaterialId(layer.material, { nScale: 1, nOffset: own.dnDtPerK * DT }), `layer ${i}`);
    });
    assert.deepEqual(listEnvironments(design)[1].constantsMissing.map(m => [m.material, m.fields]), [['user_heat:N', ['linearExpansionPerK']]]);
});
check('a constant counts as given only as a finite number: text or NaN is missing to the model and the listing alike', () => {
    const at = film => filmAtTemperature(film, 9e-6, 100);
    assert.deepEqual(at({ linearExpansionPerK: '5e-6', poissonsRatio: 0.25, dnDtPerK: '2e-5' }), { thicknessFactor: 1, nScale: 1, nOffset: 0 }, 'text');
    assert.deepEqual(at({ linearExpansionPerK: NaN, poissonsRatio: 0.25, dnDtPerK: 1e-5 }), { thicknessFactor: 1, nScale: 1, nOffset: 1e-5 * 100 }, 'NaN β');
    assert.deepEqual(at({ linearExpansionPerK: 7e-6, poissonsRatio: null, dnDtPerK: Infinity }), { thicknessFactor: 1 + 7e-6 * 100, nScale: 1, nOffset: 0 }, 'null ν, infinite dN/dT');
    assert.deepEqual(substrateAtTemperature({ linearExpansionPerK: '9e-6', dnDtPerK: NaN }, 100), { thicknessFactor: 1, nScale: 1, nOffset: 0 }, 'the substrate');
    const design = {
        ...withEnv2({ temperatureC: 120 }),
        substrate: { material: 'user_heat:G', thickness: 2 },
        materials: {
            ...MATERIALS,
            'user_heat:G': record('user_heat:G', TABLES['user_heat:S'], { linearExpansionPerK: '9e-6', dnDtPerK: 2.5e-6 }),
            'user_heat:T': record('user_heat:T', TABLES['user_heat:H'], { linearExpansionPerK: 7e-6, poissonsRatio: NaN, dnDtPerK: '1e-5' }),
        },
        frontLayers: [{ id: 't', material: 'user_heat:T', thickness: 80, locked: false }],
    };
    const seen = environmentDesign(design, 'env2');
    assert.deepEqual([seen.frontLayers[0].material, seen.frontLayers[0].thickness, seen.substrate.thickness], ['user_heat:T', 80 * (1 + 7e-6 * 100), 2]);
    assert.deepEqual(listEnvironments(design)[1].constantsMissing.map(m => [m.material, m.fields]),
        [['user_heat:T', ['poissonsRatio', 'dnDtPerK']], ['user_heat:G', ['linearExpansionPerK']]]);
});
check('the listing names a material once whichever way its id is spelled, under the spelling the films use first', () => {
    const design = {
        ...withEnv2({ temperatureC: 120 }),
        substrate: { material: 'SiO2', thickness: 2 },
        frontLayers: [['TiO2', 50], ['builtin:SiO2', 90], ['builtin:TiO2', 50]].map(([material, thickness], i) => ({ id: `s${i}`, material, thickness, locked: false })),
    };
    assert.deepEqual(listEnvironments(design)[1].constantsMissing.map(m => [m.material, m.fields]), [
        ['TiO2', ['linearExpansionPerK', 'poissonsRatio', 'dnDtPerK']], ['builtin:SiO2', ['linearExpansionPerK', 'poissonsRatio', 'dnDtPerK']],
    ]);
});
check('and names the films of the coatings the environment computes: a fixed back coating only when it scores the whole part', () => {
    const back = [{ id: 'b0', material: 'builtin:Ta2O5', thickness: 100, locked: false }];
    const lacking = (fields, design) => listEnvironments({ ...withEnv2({ temperatureC: 120, ...fields }), ...design })[1].constantsMissing.map(m => m.material);
    assert.deepEqual(lacking({}, { backLayers: back }), [], 'front only, scored on its side');
    assert.deepEqual(lacking({ mfEvalMode: 'total' }, { backLayers: back }), ['builtin:Ta2O5'], 'front only, scored as the whole part');
    const frontLacking = [{ id: 'f0', material: 'builtin:Nb2O5', thickness: 100, locked: false }];
    assert.deepEqual(lacking({}, { surfaceMode: 'back_only', frontLayers: frontLacking, backLayers: back }), ['builtin:Ta2O5'], 'back only, scored on its side');
    assert.deepEqual(lacking({}, { surfaceMode: 'both_independent', frontLayers: frontLacking, backLayers: back }), ['builtin:Nb2O5', 'builtin:Ta2O5'], 'both sides');
});

console.log(`PASS environments_cone_backside_temperature (${pass} checks)`);
