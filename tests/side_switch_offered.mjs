/**
 * The Side switch of each window that shows one face of the coating offers
 * only the faces it can show: a face with no layers is greyed and cannot be
 * picked. The Refractive Index Profiler's Total is greyed only on a design
 * with no layers at all.
 *
 * Run: node tests/side_switch_offered.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { RefractiveIndexProfiler } = await import('../src/components/windows/analysis/refractiveIndexProfiler/RefractiveIndexProfiler.js');
const { AdmittanceDiagram } = await import('../src/components/windows/analysis/admittanceDiagram/AdmittanceDiagram.js');
const { EFieldEvaluation } = await import('../src/components/windows/analysis/eFieldEvaluation/EFieldEvaluation.js');
const { LayerThicknesses } = await import('../src/components/windows/analysis/layerThicknesses/LayerThicknesses.js');
const { GDGDDEvaluation } = await import('../src/components/windows/analysis/gdGddEvaluation/GDGDDEvaluation.js');
const { EllipsometryControls } = await import('../src/components/windows/analysis/ellipsometryEvaluation/EllipsometryControls.js');
const { ChoiceGroup } = await import('../src/components/windows/analysis/chrome/controls.js');
const { offeredSides } = await import('../src/components/windows/analysis/availableSide.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const c = makeTheme(), t = makeLocale();
const both = api.openDesign(fixtureFile('absorbing-substrate-both-sides-total'));
const frontOnly = { ...both, backLayers: [] };
const backOnly = { ...both, frontLayers: [] };
const bare = { ...both, frontLayers: [], backLayers: [] };

// Every Side switch marks its choices with the face's colour.
const DOT = { front: '#1e88e5', back: '#e53935', total: '#ab47bc' };
const WINDOWS = {
    'Refractive Index Profiler': RefractiveIndexProfiler, Admittance: AdmittanceDiagram,
    'Electric Field': EFieldEvaluation, 'Layer Thicknesses': LayerThicknesses,
    'GD/GDD': GDGDDEvaluation,
};

// Whether the choice marked `side` is offered, or null when there is none.
function offered(Window, design, side) {
    const html = renderToStaticMarkup(withDesign(React.createElement(Window, { c, t, theme: c }), design));
    const button = [...html.matchAll(/<button([^>]*)>((?:(?!<\/button>)[\s\S])*)<\/button>/g)]
        .find(match => match[2].includes(`background-color:${DOT[side]}`));
    return button ? !/\bdisabled=""/.test(button[1]) : null;
}

for (const [name, Window] of Object.entries(WINDOWS)) {
    ok(`${name}: the switch has Front and Back`, offered(Window, both, 'front') != null && offered(Window, both, 'back') != null);
    ok(`${name}: a design with both faces coated offers both`, offered(Window, both, 'front') && offered(Window, both, 'back'));
    ok(`${name}: a front-only design does not offer Back`, offered(Window, frontOnly, 'back') === false && offered(Window, frontOnly, 'front'));
    ok(`${name}: a back-only design does not offer Front`, offered(Window, backOnly, 'front') === false && offered(Window, backOnly, 'back'));
}

// Ellipsometry chooses its side in Settings, which draws nothing until it is
// opened, so its choices are read from the panel's elements.
function ellipsometrySide(design) {
    const text = t.ellipsometry;
    const state = { mode: 'spectral', side: 'front', showPsi: true, showDelta: true, sideOffered: offeredSides(design) };
    const row = EllipsometryControls({ c, t, text, state, curveColors: { psi: '#000', delta: '#000' }, notices: [] });
    const setup = row.props.trailing.find(element => element.key === 'setup');
    const found = [];
    const walk = (node) => {
        if (Array.isArray(node)) { node.forEach(walk); return; }
        if (!node || typeof node !== 'object' || !node.props) return;
        if (node.type === ChoiceGroup && node.props.ariaLabel === text.side) found.push(node);
        walk(node.props.children);
    };
    walk(setup.type(setup.props));
    return Object.fromEntries(found[0].props.items.map(item => [item.id, !item.disabled]));
}
ok('Ellipsometry: a design with both faces coated offers both', ellipsometrySide(both).front && ellipsometrySide(both).back);
ok('Ellipsometry: a front-only design does not offer Back', ellipsometrySide(frontOnly).front && !ellipsometrySide(frontOnly).back);
ok('Ellipsometry: a back-only design does not offer Front', !ellipsometrySide(backOnly).front && ellipsometrySide(backOnly).back);

const rip = RefractiveIndexProfiler;
ok('the Profiler offers Total with layers on either face', offered(rip, frontOnly, 'total') && offered(rip, backOnly, 'total'));
ok('and on a design with no layers offers none of its three',
    offered(rip, bare, 'front') === false && offered(rip, bare, 'back') === false && offered(rip, bare, 'total') === false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
