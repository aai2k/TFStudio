/**
 * The Design Cleaner window's row and the side it cleans, rendered to markup
 * with the app's React.
 *
 *   1. On a design with layers on both sides the row opens with Side: Front,
 *      Back, Both, Both picked, before Remove below; a design coated on one
 *      side and a symmetric design have no Side.
 *   2. With Back picked, the pending operations, the thin layers and Apply's
 *      count are the back's alone and the front's are not listed; the same
 *      Back left picked cleans a design coated on the front alone on its
 *      front, since that design is offered no Side.
 *   3. The row holds the analysis windows' controls: Remove below with its
 *      unit, Merge same material, Re-optimize, the Settings menu and Apply,
 *      and no refiner select or iteration box, which the Settings menu
 *      holds. Ticking Re-optimize adds or takes away nothing.
 *   4. While the re-optimize pass runs, Stop takes Apply's place on the row
 *      and the step count shows in the summary strip below it.
 *
 * Run: node tests/design_cleaner_window.mjs
 */
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { shimBrowserGlobals, loadApp, makeTheme, makeLocale, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const { DesignCleaner } = await import('../src/components/windows/optimization/designCleaner/DesignCleaner.js');
const { CleanerControls } = await import('../src/components/windows/optimization/designCleaner/CleanerControls.js');
const { CleanerSummary } = await import('../src/components/windows/optimization/designCleaner/CleanerStatus.js');
const { designCleanerSession } = await import('../src/components/windows/optimization/designCleaner/sessionState.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

const c = makeTheme();
const t = makeLocale();
const dc = t.designCleaner;
const noop = () => {};

const layer = (id, material, thickness) => ({ id, material, thickness, locked: false });
// Coated on both sides: on each, a layer under 5 nm and two touching layers of
// one material. Both sides cleaned: 3 operations on the front, 2 on the back.
const twoSided = {
    id: 'clean-two', name: 'Two sides', incidentMedium: 'builtin:Air', exitMedium: 'builtin:Air',
    substrate: { material: 'builtin:BK7', thickness: 1 }, referenceWavelength: 550,
    surfaceMode: 'both_independent', mfEvalMode: 'total',
    frontLayers: [layer('f6', 'builtin:MgF2', 96.4), layer('f5', 'builtin:TiO2', 2.1), layer('f4', 'builtin:MgF2', 31.2),
        layer('f3', 'builtin:TiO2', 58.7), layer('f2', 'builtin:TiO2', 11.3), layer('f1', 'builtin:SiO2', 24.9)],
    backLayers: [layer('b4', 'builtin:SiO2', 88.1), layer('b3', 'builtin:TiO2', 3.4), layer('b2', 'builtin:SiO2', 26.5), layer('b1', 'builtin:TiO2', 19.8)],
    meritOperands: [],
};
const frontOnly = { ...twoSided, id: 'clean-front', surfaceMode: 'front_only', mfEvalMode: 'side', backLayers: [] };
const symmetric = { ...twoSided, id: 'clean-sym', surfaceMode: 'symmetric', backLayers: [] };

// The window drawn on `design`, with `side` picked.
function windowOn(design, side) {
    designCleanerSession.write(design, { side }, null);
    return renderToStaticMarkup(withDesign(React.createElement(DesignCleaner, { c, t, theme: c }), design));
}
const SIDE_GROUP = 'aria-label="Side"';
const count = (html, text) => html.split(text).length - 1;

// ── 1. Side, where it is offered ───────────────────────────────────────────
{
    const html = windowOn(twoSided, 'both');
    const group = html.slice(html.indexOf(SIDE_GROUP), html.indexOf('</div>', html.indexOf(SIDE_GROUP)));
    const labels = [dc.side, dc.sides.front, dc.sides.back, dc.sides.both];
    ok('a design with layers on both sides opens its row with Side: Front, Back, Both', html.includes(SIDE_GROUP)
        && labels.every((label, i) => i === 0 || group.indexOf(`>${label}<`) > group.indexOf(`>${labels[i - 1]}<`))
        && html.indexOf(SIDE_GROUP) < html.indexOf(dc.minThickness), group);
    ok('Both picked by default', /aria-pressed="true"[^>]*>Both</.test(group), group);
    ok('and the window cleans both sides then: 5 operations', html.includes(`${dc.pendingOps} (5)`) && html.includes(`${dc.apply} (5)`));
    ok('a design coated on the front alone has no Side', !windowOn(frontOnly, 'both').includes(SIDE_GROUP));
    ok('nor has a symmetric design, whose back mirrors its front', !windowOn(symmetric, 'both').includes(SIDE_GROUP));
}

// ── 2. Back picked ─────────────────────────────────────────────────────────
{
    const html = windowOn(twoSided, 'back');
    const rows = [...html.matchAll(/<tr[^>]*><td[^>]*>\d+<\/td><td[^>]*>([FB])<\/td>/g)].map(m => m[1]);
    ok('Back picked: the pending operations are the back\'s alone', rows.join('') === 'BB' && html.includes(`${dc.pendingOps} (2)`), rows.join(''));
    ok('Apply counts the back\'s operations, and the summary keeps the front\'s 6 layers', html.includes(`${dc.apply} (2)`) && html.includes('6F + 2B'));
    ok('the thin layers listed are the back\'s alone', html.includes(`${dc.thinList} (1)`) && html.includes('>B2<') && !html.includes('>F5<'));
    ok('Front picked: the front\'s operations alone', windowOn(twoSided, 'front').includes(`${dc.pendingOps} (3)`));
    const leftPicked = windowOn(frontOnly, 'back');
    ok('Back left picked on a design coated on the front alone, which is offered no Side, cleans its front',
        leftPicked.includes(`${dc.pendingOps} (3)`) && leftPicked.includes(`${dc.apply} (3)`));
    designCleanerSession.write(twoSided, { side: 'both' }, null);
}

// ── 3. The row's controls ──────────────────────────────────────────────────
const rowProps = {
    c, dc, tr: t.refinement, units: t.units, settingsLabel: t.analysisChrome.settings,
    design: { meritOperands: [{}] }, sideOffered: true, side: 'both', setSide: noop,
    dMin: 5, setDMin: noop, mergeAdjacent: true, setMergeAdjacent: noop,
    reoptimize: true, setReoptimize: noop, reoptIters: 80, setReoptIters: noop, reoptMethod: 'sqp', setReoptMethod: noop,
    applying: false, progress: null, ops: [{}, {}], apply: noop, stop: noop,
};
const row = props => renderToStaticMarkup(React.createElement(CleanerControls, { ...rowProps, ...props }));
{
    const html = row({});
    const order = [SIDE_GROUP, `>${dc.minThickness}<`, `>${t.units.nm}<`, dc.mergeAdjacent, dc.reoptimize, t.analysisChrome.settings, `${dc.apply} (2)`];
    ok('the row: Side, Remove below with its unit, Merge same material, Re-optimize, Settings, Apply, in that order',
        order.every((text, i) => html.includes(text) && (i === 0 || html.indexOf(text) > html.indexOf(order[i - 1]))), order.filter(text => !html.includes(text)).join(' | '));
    ok('the refiner select and the iteration box are not on the row but in the Settings menu', !html.includes('<select') && !html.includes(dc.reoptIters));
    ok('the minimum thickness is the analysis windows\' 24 px field', /<input(?=[^>]*height:24px)(?=[^>]*value="5")[^>]*>/.test(html));
    const off = row({ reoptimize: false });
    const kinds = markup => ['<input', '<button', '<select', 'role="group"'].map(tag => count(markup, tag)).join();
    ok('ticking Re-optimize adds or takes away nothing on the row', kinds(off) === kinds(html), `${kinds(off)} / ${kinds(html)}`);
}

// ── 4. While the pass runs ─────────────────────────────────────────────────
{
    const progress = { step: 37, iters: 80, mf: 0.0482 };
    const html = row({ applying: true, progress });
    ok('while the pass runs, Stop takes Apply\'s place', html.includes(`>${dc.stop}<`) && !html.includes(dc.apply) && !html.includes(dc.applying));
    ok('and the step count is not on the row', !html.includes(dc.refining(37, 80, 0.0482)));
    const strip = renderToStaticMarkup(React.createElement(CleanerSummary, {
        c, dc, preview: null, ops: [], removedOps: [], mergedOps: [], resultMsg: null, progress,
        mfBefore: null, mfAfter: null, mfBusy: false, tip: '', computingLabel: '',
    }));
    ok('the summary strip shows the step count', strip.includes(dc.refining(37, 80, 0.0482)), strip);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
