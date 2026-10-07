/**
 * With no design open, the status monitors and the two monitoring wizards show
 * nothing of the placeholder design the provider hands out meanwhile.
 *
 * The monitors under the workspace read nothing, and the strip leaves out the
 * side a design is evaluated on. The Broadband and Monochromatic wizards are
 * modals, so the window gate in ToolContent never sees them: each asks for a
 * design rather than reporting that the placeholder, a bare substrate, has no
 * layers to simulate, and its header carries no evaluation badge.
 *
 * Run: node tests/no_design_monitors_and_wizards.mjs
 */
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeDesignCtx, makeLocale, makeSampleDesign, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
const { DesignContext } = await loadApp();

const [{ SpectralMonitor, monitorValues }, { BBMWizard }, { MonoWizard }, { EvalModeBadge }, { makeDefaultDesign }] = await Promise.all([
    import('../src/components/SpectralMonitor.js'),
    import('../src/components/windows/simulation/bbmWizard/BBMWizard.js'),
    import('../src/components/windows/simulation/monoWizard/MonoWizard.js'),
    import('../src/components/SurfaceModeBar.js'),
    import('../src/state/DesignContext.js'),
]);

const c = makeTheme();
const t = makeLocale();
const h = React.createElement;
const OPEN_STATES = [false, true];
const placeholder = makeDefaultDesign();

const inContext = (element, design, hasActiveDesign) =>
    h(DesignContext.Provider, { value: { ...makeDesignCtx(design), hasActiveDesign } }, element);

// ── Status monitors ──────────────────────────────────────────────────────────
{
    const design = makeSampleDesign();
    const monitors = [
        { id: 'count', type: 'fact', fact: 'layerCount' },
        { id: 'reflectance', qty: 'R', type: 'avg', lambdaStart: 400, lambdaEnd: 700, aoi: 0, pol: 'avg' },
    ];
    const read = hasActiveDesign => monitorValues({
        monitors, design, hasActiveDesign, missingMaterialIds: [], coneActive: false,
    });
    const [count, reflectance] = read(true);
    assert.equal(count, design.frontLayers.length, 'a design open: the monitors read it');
    assert.ok(Number.isFinite(reflectance), `and its band-average R (${reflectance})`);
    assert.deepEqual(read(false), [null, null], 'no design open: they read nothing');

    for (const hasActiveDesign of OPEN_STATES) {
        const html = renderToStaticMarkup(inContext(h(SpectralMonitor, { c, t }), placeholder, hasActiveDesign));
        assert.equal(html.includes(`>${t.statusMonitors.evalFront}<`), hasActiveDesign,
            `the side evaluated on is shown only with a design open (design open: ${hasActiveDesign})`);
    }
}

// ── Monitoring wizards ───────────────────────────────────────────────────────
const badge = renderToStaticMarkup(h(EvalModeBadge, { design: placeholder, c, t }));
for (const [name, Wizard, B] of [['BBMWizard', BBMWizard, t.bbmSim], ['MonoWizard', MonoWizard, t.monoSim]]) {
    const draw = (design, hasActiveDesign) => renderToStaticMarkup(
        inContext(h(Wizard, { c, t, onClose: () => {} }), design, hasActiveDesign));

    const closed = draw(placeholder, false);
    assert.ok(closed.includes(B.noDesign), `${name}: no design open, the wizard asks for one`);
    assert.ok(!closed.includes(B.noLayers), `${name}: rather than saying the placeholder has no layers`);
    assert.ok(!closed.includes(badge), `${name}: and its header has no evaluation badge`);

    const bare = draw(placeholder, true);
    assert.ok(bare.includes(B.noLayers) && bare.includes(badge), `${name}: the same bare substrate, opened, has no layers`);

    const open = draw(makeSampleDesign(), true);
    assert.ok(open.includes(B.p1Title) && !open.includes(B.noDesign), `${name}: a design with layers opens on page 1`);
}

console.log('no_design_monitors_and_wizards: passed');
