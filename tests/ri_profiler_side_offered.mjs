/**
 * The Refractive Index Profiler offers only the sides it can show: a face with
 * no layers is greyed and cannot be picked, and Total is greyed on a design
 * with no layers at all.
 *
 * Run: node tests/ri_profiler_side_offered.mjs
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { fixtureFile } from './_apiCorpus.mjs';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();

const api = await import('../src/api/index.js');
const { RefractiveIndexProfiler } = await import('../src/components/windows/analysis/refractiveIndexProfiler/RefractiveIndexProfiler.js');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
    if (cond) pass++;
    else { fail++; console.error(`FAIL: ${name}${detail ? `  (${detail})` : ''}`); }
};

await api.init();
const c = makeTheme(), t = makeLocale();
const rp = t.riProfile;
const both = api.openDesign(fixtureFile('absorbing-substrate-both-sides-total'));
const frontOnly = { ...both, backLayers: [] };
const backOnly = { ...both, frontLayers: [] };

// The opening tag of the Side switch's button whose label is `label`.
function sideButton(design, label) {
    const html = renderToStaticMarkup(withDesign(React.createElement(RefractiveIndexProfiler, { c, t, theme: c }), design));
    const tag = [...html.matchAll(/<button([^>]*)>((?:(?!<\/button>)[\s\S])*)<\/button>/g)]
        .find(match => match[2].replace(/<[^>]*>/g, '') === label);
    return tag ? tag[1] : null;
}
const offered = (design, label) => !/\bdisabled=""/.test(sideButton(design, label));

ok('the switch has a Back button', sideButton(frontOnly, rp.back) != null);
ok('a front-only design does not offer Back', !offered(frontOnly, rp.back), sideButton(frontOnly, rp.back));
ok('and offers Front and Total', offered(frontOnly, rp.front) && offered(frontOnly, rp.total));
ok('a back-only design does not offer Front', !offered(backOnly, rp.front), sideButton(backOnly, rp.front));
ok('and offers Back and Total', offered(backOnly, rp.back) && offered(backOnly, rp.total));
ok('a design with both faces coated offers all three',
    offered(both, rp.front) && offered(both, rp.back) && offered(both, rp.total));
const bare = { ...both, frontLayers: [], backLayers: [] };
ok('a design with no layers offers none of them',
    !offered(bare, rp.front) && !offered(bare, rp.back) && !offered(bare, rp.total));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
