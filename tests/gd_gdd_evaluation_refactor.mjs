import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    loadApp,
    makeLocale,
    makeSampleDesign,
    makeTheme,
    shimBrowserGlobals,
    withDesign,
} from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const {
    computeGroupDelaySpectrum,
    computeGroupDelaySpectrumAtWavelengthStep,
    tmmWithAdmittances,
    C_NM_PER_FS,
} =
    await import('../src/utils/physics/thinFilmMath.js');
const { getMaterial } = await import('../src/utils/materials/materialDatabase.js');
const { computeGdGddSpectrum, DEFAULT_GD_GDD_WAVELENGTH_STEP_NM } =
    await import('../src/components/windows/analysis/gdGddEvaluation/spectrum.js');
const { buildGdGddView } =
    await import('../src/components/windows/analysis/gdGddEvaluation/viewModel.js');
const { buildGDChartModel } =
    await import('../src/components/windows/analysis/gdGddEvaluation/chartModel.js');
const { GDGDDEvaluation } =
    await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');

function directSpectrum(design, options) {
    const material = id => getMaterial(id) || getMaterial('Air');
    const nkAt = (mat, lambda) => mat.getNK(lambda);
    const sideLayersAt = (lambda) => {
        const layers = options.side === 'back' ? (design.backLayers || []) : (design.frontLayers || []);
        const ordered = options.side === 'back' ? [...layers].reverse() : layers;
        return ordered
            .filter(layer => layer.material && layer.thickness > 0)
            .map(layer => ({ n: nkAt(material(layer.material), lambda), d: layer.thickness }));
    };
    const incidentId = options.side === 'back' ? design.exitMedium : design.incidentMedium;
    const incident = material(incidentId);
    const substrate = material(design.substrate?.material);
    // The wavelength is passed through unrounded. Quantizing it puts fixed
    // wavelength jitter into the phase samples and prevents the derivatives
    // from converging as the requested step shrinks.
    // See tests/gd_gdd_validation.mjs.
    const coefficientAt = (lambda) => {
        const result = tmmWithAdmittances(
            lambda, options.thetaDeg, options.polarization,
            nkAt(incident, lambda), nkAt(substrate, lambda), sideLayersAt(lambda),
        );
        return options.target === 'T' ? result.t : result.r;
    };
    return computeGroupDelaySpectrumAtWavelengthStep(
        coefficientAt, options.lambdaStart, options.lambdaEnd, options.lambdaStep,
    );
}

const design = {
    incidentMedium: 'Air',
    exitMedium: 'Air',
    substrate: { material: 'BK7' },
    frontLayers: [
        { material: 'TiO2', thickness: 91.25 },
        { material: 'SiO2', thickness: 127.5 },
    ],
    backLayers: [
        { material: 'MgF2', thickness: 80.75 },
        { material: 'Ta2O5', thickness: 63.5 },
    ],
};
const cases = [
    {
        side: 'front', target: 'R', polarization: 'p', thetaDeg: 17.5,
        lambdaStart: 501.234, lambdaEnd: 517.876, lambdaStep: 2.7,
    },
    {
        side: 'back', target: 'T', polarization: 's', thetaDeg: 38,
        lambdaStart: 610.111, lambdaEnd: 628.999, lambdaStep: 3.2,
    },
];

assert.equal(DEFAULT_GD_GDD_WAVELENGTH_STEP_NM, 0.2, 'default wavelength step resolves higher derivatives');

assert.throws(
    () => computeGroupDelaySpectrum(() => [1, 0], 550, 550, 5),
    /endpoints must be distinct/,
    'equal wavelength endpoints are rejected before finite differences',
);

// A cubic phase in omega has exact first, second and third derivatives. This
// checks the arbitrary-omega finite-difference weights and the physical sign on
// the same uniform-wavelength grid used by the window.
{
    const twoPiC = 2 * Math.PI * C_NM_PER_FS;
    const omega0 = twoPiC / 550;
    const a1 = 1.25, a2 = -0.75, a3 = 2.5;
    const coefficientAt = lambda => {
        const x = twoPiC / lambda - omega0;
        const physicalPhase = 0.3 + a1 * x + a2 * x * x / 2 + a3 * x * x * x / 6;
        return [Math.cos(-physicalPhase), Math.sin(-physicalPhase)];
    };
    const exact = computeGroupDelaySpectrumAtWavelengthStep(coefficientAt, 500, 600, 2.7);
    for (let i = 0; i < exact.lambda.length; i++) {
        const x = twoPiC / exact.lambda[i] - omega0;
        assert.ok(Math.abs(exact.gd[i] + a1 + a2 * x + a3 * x * x / 2) < 1e-11);
        assert.ok(Math.abs(exact.gdd[i] + a2 + a3 * x) < 1e-9);
        assert.ok(Math.abs(exact.tod[i] + a3) < 1e-7);
    }
}

for (const options of cases) {
    const actual = computeGdGddSpectrum(design, options);
    const expected = directSpectrum(design, options);
    assert.deepEqual(actual, expected, `${options.side}/${options.target} spectrum and numerical order changed`);
    assert.equal(
        actual.lambda.length,
        Math.floor(Math.abs(options.lambdaEnd - options.lambdaStart) / options.lambdaStep + 1e-12) + 1,
        'wavelength step sets the displayed point count',
    );
    for (let i = 1; i < actual.lambda.length; i++) {
        assert.ok(
            Math.abs(actual.lambda[i] - actual.lambda[i - 1] - options.lambdaStep) < 1e-10,
            `displayed wavelength interval is ${options.lambdaStep} nm`,
        );
    }
}

const c = makeTheme();
const text = makeLocale().gdgdd;
const raw = directSpectrum(design, cases[0]);
const view = buildGdGddView(raw, {
    quantity: 'phase', referenceLambda: raw.lambda[2], showReference: true,
}, text);
assert.deepEqual(view.tableColumns.map(column => column.key), ['lambda', 'gd', 'gdd', 'phase', 'tod']);
assert.deepEqual(view.tableRows[2], {
    lambda: raw.lambda[2], gd: raw.gd[2], gdd: raw.gdd[2],
    phase: raw.phaseDeg[2], tod: raw.tod[2],
});
assert.equal(view.plotData.y[2], 0, 'phase remains referenced to the nearest sampled wavelength');

const chart = buildGDChartModel({
    data: view.plotData, meta: view.meta,
    referenceLambda: raw.lambda[2], showReference: true,
    colors: { background: c.bg, paper: c.panel, grid: c.border, text: c.text },
});
assert.equal(chart.traces[0].hovertemplate, '%{y:.2f} °<br>%{x:.2f} nm<extra></extra>');
assert.deepEqual(chart.layout.margin, { l: 64, r: 16, t: 12, b: 46 });
assert.equal(chart.layout.shapes[0].x0, raw.lambda[2]);
assert.equal(chart.layout.yaxis.title.text, text.phaseAxis);

const markup = renderToStaticMarkup(withDesign(
    React.createElement(GDGDDEvaluation, { c, t: makeLocale(), theme: c }),
    makeSampleDesign(),
));
assert.match(markup, /data-gd-toolbar="primary"/, 'side and AOI have a dedicated toolbar');
assert.match(markup, /data-gd-toolbar="curves"/, 'quantity controls have a dedicated toolbar');
assert.match(markup, /data-gd-panel="axis"/, 'wavelength controls sit in an axis panel');
assert.match(markup, /data-gd-panel="footer"/, 'the selected coating summary sits in a footer');
assert.match(markup, /aria-label="Side"/, 'front/back remains an explicit local calculation switch');
assert.equal(createHash('sha256').update(markup).digest('hex').slice(0, 16), 'a77f7606a5c8f727');

console.log('PASS: gd_gdd_evaluation_refactor');
