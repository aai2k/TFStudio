/**
 * avg means one thing wherever the electric field is read: the mean of the s
 * and p fields. EFMX is the peak over depth of the field it names, so an EFMX
 * avg row reads the peak of the curve the Electric Field window draws for avg,
 * and the report's electric field block offers avg and samples as the window
 * does.
 *
 * Checks, on the corpus quarter-wave mirror at 600 nm and 45°, where the s and
 * p peaks differ:
 *   1. The window's avg curve is the mean of its s and p curves.
 *   2. An EFMX row reads the peak of the window's curve in avg, s and p alike,
 *      so its avg row sits strictly between the s and p rows.
 *   3. The report block draws the window's curve, sample for sample, in avg,
 *      s and p.
 *   4. A block made while the window shows avg is an avg block, and its
 *      settings offer avg.
 *
 * Run: node tests/efield_avg_one_meaning.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { computeProfile } = await import('../src/components/windows/analysis/eFieldEvaluation/profileModel.js');
const { eFieldSession } = await import('../src/components/windows/analysis/eFieldEvaluation/sessionState.js');
const { gatherDesignData } = await import('../src/utils/report/reportData.js');
const { newBlock } = await import('../src/utils/report/blocks.js');
const { settingsFromWindow } = await import('../src/components/windows/information/report/blockSources.js');
const { BlockSettingsPanel } = await import('../src/components/windows/information/report/BlockSettings.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};
const peak = values => Math.max(...values);
const sameCurve = (a, b) => a.length === b.length && a.every((value, i) => Math.abs(value - b[i]) <= 1e-12);

await api.init();
const design = api.openDesign(fixtureFile('builtin-bare-ids-qw-mirror'));
const at = { lambda: 600, theta: 45 };
const drawn = computeProfile(design, { ...at, pol: 'avg' });

// ── 1. The window's avg is the mean of s and p ──────────────────────────────
ok('the window draws avg as the mean of s and p',
    drawn.avg.e2.every((value, i) => Math.abs(value - (drawn.s.e2[i] + drawn.p.e2[i]) / 2) <= 1e-15));
ok('and the s and p peaks differ on this design', Math.abs(peak(drawn.s.e2) - peak(drawn.p.e2)) > 0.1,
    `${peak(drawn.s.e2)} ${peak(drawn.p.e2)}`);

// ── 2. EFMX reads the peak of the window's curve ────────────────────────────
const efmx = pol => api.merit(api.setMerit(design, [{ type: 'EFMX', lambdaStart: at.lambda, aoi: at.theta, pol, target: 0 }])).rows[0].value;
for (const pol of ['avg', 's', 'p']) {
    ok(`EFMX ${pol} reads the peak of the window's ${pol} curve`, Math.abs(efmx(pol) - peak(drawn[pol].e2)) <= 1e-12,
        `${efmx(pol)} against ${peak(drawn[pol].e2)}`);
}
ok('so EFMX avg lies between EFMX s and EFMX p', efmx('avg') > efmx('s') && efmx('avg') < efmx('p'),
    `${efmx('s')} ${efmx('avg')} ${efmx('p')}`);

// ── 3. The report block draws the window's curve ────────────────────────────
for (const pol of ['avg', 's', 'p']) {
    const block = newBlock('efield', { ...at, pol });
    const data = gatherDesignData(design, [block]).blocks[block.id];
    const shown = pol === 'avg' ? drawn : computeProfile(design, { ...at, pol });
    ok(`the report's ${pol} block is the window's ${pol} curve`, data.pol === pol && sameCurve(data.e2, shown[pol].e2),
        `${data.pol}, ${data.e2?.length} samples against ${shown[pol].e2.length}`);
    ok(`and its depths are the window's`, sameCurve(data.z, shown[pol].z));
}

// ── 4. A block made from the window in avg is an avg block ──────────────────
eFieldSession.write(design, { pol: 'avg', theta: at.theta });
ok('a block made while the window shows avg is an avg block', settingsFromWindow('efield', design).pol === 'avg',
    JSON.stringify(settingsFromWindow('efield', design)));
eFieldSession.write(design, { pol: 'p' });
ok('and one made while it shows p is a p block', settingsFromWindow('efield', design).pol === 'p');

const t = makeLocale();
const W = t.report.window;
const noop = () => {};
const words = renderToStaticMarkup(React.createElement('div', null, BlockSettingsPanel({
    c: makeTheme(), W, t, block: newBlock('efield', { pol: 'avg' }), index: 0, count: 1, design,
    onChange: noop, onMove: noop, onRemove: noop, onClose: noop,
}))).replace(/<[^>]*>/g, '\n').split('\n').map(word => word.trim());
ok('the block settings offer avg, s and p', [W.polAvg, 's', 'p'].every(word => words.includes(word)));

console.log(`efield_avg_one_meaning: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
