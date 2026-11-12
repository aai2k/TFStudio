/**
 * The Admittance, Electric Field and Refractive Index Profile windows on a
 * design with environments, each with the Environment droplist in the row
 * under its plot (chrome/environmentChoice.js).
 *
 *   1. One environment: each window computes the design of the environment
 *      chosen or current, environment 1's being the design itself and one that
 *      is off computed when chosen; a design without environments computes as
 *      itself, a stored All aside, and its table keeps today's columns.
 *   2. Admittance under All: each environment's loci in its colour, named
 *      after it, p dashed; its η_s, Y₀ and η₀ marks in its colour, named on the
 *      first locus alone; a legend naming the environments; the table listing
 *      each environment's rows in turn after an Environment column.
 *   3. Electric Field under All: each environment's curves in its colour,
 *      named after it, each polarization keeping its dash; the first
 *      environment's layer bands; each environment's incident level in its
 *      colour; the depth axis running on to the thickest environment's stack;
 *      the table as Admittance's.
 *   4. Refractive Index Profile under All: n and k in each environment's
 *      colour, k dashed, the k axis named in the text colour; the depth axis
 *      to the thickest stack; in the whole-part view each region starting at
 *      the same place in every environment, sized by the thickest; the table
 *      as Admittance's.
 *   5. Every window draws the droplist with Current, each environment and All
 *      on a design with environments, and none without; the range notice reads
 *      the materials of every environment shown; Preferences > Analysis lists
 *      Admittance's environment palette apart from its material palette.
 *
 * Run: node tests/environments_admittance_field_profile.mjs
 */
import assert from 'node:assert/strict';
import './_kernel.mjs';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadApp, makeLocale, makeTheme, shimBrowserGlobals, withDesign } from './_uiShim.mjs';

shimBrowserGlobals();
await loadApp();
const { initCatalogs } = await import('../src/utils/materials/catalogManager.js');
initCatalogs({});
const { oneEnvironmentDesign, threeEnvironmentDesign } = await import('./_environmentDesign.mjs');
const { environmentChoiceSession } = await import('../src/components/windows/analysis/chrome/environmentChoice.js');
const { currentEnvironmentSession } = await import('../src/components/windows/design/environments/currentEnvironment.js');
const { environmentDesign } = await import('../src/utils/environments/environments.js');
const { ANALYSIS_DEFAULTS, environmentColor } = await import('../src/constants/analysisDefaults.js');
const A = '../src/components/windows/analysis/';
const { AdmittanceDiagram } = await import(`${A}admittanceDiagram/AdmittanceDiagram.js`);
const { useAdmittanceDiagram } = await import(`${A}admittanceDiagram/useAdmittanceDiagram.js`);
const { buildDiagramData } = await import(`${A}admittanceDiagram/model.js`);
const { buildAdmittanceTableRows, tableColumns } = await import(`${A}admittanceDiagram/tableModel.js`);
const { buildAdmittanceOption } = await import(`${A}admittanceDiagram/chartFigure.js`);
const { admittanceSession } = await import(`${A}admittanceDiagram/sessionState.js`);
const { EFieldEvaluation } = await import(`${A}eFieldEvaluation/EFieldEvaluation.js`);
const { useEFieldState } = await import(`${A}eFieldEvaluation/useEFieldState.js`);
const { computeProfile } = await import(`${A}eFieldEvaluation/profileModel.js`);
const { buildProfileTable: fieldTable } = await import(`${A}eFieldEvaluation/profileViewModel.js`);
const { efieldOption } = await import(`${A}eFieldEvaluation/chartModel.js`);
const { incidentAmplitudeVpm, incidentLevel } = await import(`${A}eFieldEvaluation/yScale.js`);
const { eFieldSession } = await import(`${A}eFieldEvaluation/sessionState.js`);
const { RefractiveIndexProfiler } = await import(`${A}refractiveIndexProfiler/RefractiveIndexProfiler.js`);
const { useProfilerState } = await import(`${A}refractiveIndexProfiler/useProfilerState.js`);
const { computeProfileForSide, computeTotalRegions } = await import(`${A}refractiveIndexProfiler/profileModel.js`);
const { buildProfileTable: indexTable } = await import(`${A}refractiveIndexProfiler/profileViewModel.js`);
const { buildRIOption } = await import(`${A}refractiveIndexProfiler/RIChart.js`);
const { buildRITotalOption } = await import(`${A}refractiveIndexProfiler/RITotalChart.js`);
const { profilerSession } = await import(`${A}refractiveIndexProfiler/sessionState.js`);
const { WindowFields } = await import('../src/components/dialogs/settings/analysis/WindowFields.js');
const { resolveAnalysisSettings } = await import('../src/utils/analysisSettings.js');

const h = React.createElement;
const c = makeTheme();
const en = makeLocale('en');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const AD_COLORS = ANALYSIS_DEFAULTS.admittanceDiagram.colors;
const EF_COLORS = ANALYSIS_DEFAULTS.eFieldEvaluation.colors;
const RI_COLORS = ANALYSIS_DEFAULTS.refractiveIndexProfiler.colors;
const LABELS = ['1 · BK7', '2 · Sapphire'];

const lone = oneEnvironmentDesign();
const design = threeEnvironmentDesign();
const wet = environmentDesign(design, 'env2');
const thin = environmentDesign(design, 'env3');
// Environment 3 switched on with MgF2 half as thick again: the thickest stack.
const [base, sapphire, third] = design.environments;
const thick = { ...design, environments: [base, sapphire, { ...third, enabled: true, thicknessFactors: { 'builtin:MgF2': 1.5 } }] };
const thickest = environmentDesign(thick, 'env3');

// The current environment and the droplist's choice.
function shown(one, { current = 'base', choice = 'current' } = {}) {
    currentEnvironmentSession.write(one, { current });
    environmentChoiceSession.write(one, { choice });
}

// What a window's hook gives for `one` in the state `state`.
function hooked(useHook, one, state) {
    shown(one, state);
    let got = null;
    const Probe = () => { got = useHook(); return null; };
    renderToStaticMarkup(withDesign(h(Probe), one));
    return got;
}

// The window as drawn for `one` in the state `state`, its results open.
function drawn(Window, one, state) {
    shown(one, state);
    const html = renderToStaticMarkup(withDesign(h(Window, { c, theme: c, t: en }), one));
    shown(one);
    return html;
}

const header = new RegExp(`<th[^>]*>${en.environments.environment}</th>`);
const rowCount = n => en.dataTable.rowCount(n);
// The curves of an option, without the empty series that carry its legend.
const curvesOf = option => option.series.filter(s => s.type === 'line' && s.data.length);

// ── Admittance ──────────────────────────────────────────────────────────────
const AD = { lambda: 550, theta: 30, pol: 'avg', side: 'front', view: 'admittance', showTable: true };
for (const one of [lone, design, thick]) admittanceSession.write(one, AD);
const conditions = { lambda_nm: AD.lambda, theta_deg: AD.theta, pol: AD.pol, side: AD.side, view: AD.view };
const lociOf = one => buildDiagramData(one, conditions);
const admittanceOf = (one, state) => hooked(() => useAdmittanceDiagram(one), one, state);

// 1. One environment.
{
    const own = admittanceOf(design);
    assert.ok(same(own.series, lociOf(design)) && own.series.every(item => !('env' in item)),
        'Admittance: Current on environment 1 is the design itself, its loci naming no environment');
    assert.ok(same(own.tableRows, buildAdmittanceTableRows(lociOf(design), own.matName, design)),
        'Admittance: with its own table');
    assert.ok(same(admittanceOf(design, { current: 'env2' }).series, lociOf(wet)), 'Admittance: Current follows the current environment');
    assert.ok(same(admittanceOf(design, { choice: 'env3' }).series, lociOf(thin)),
        'Admittance: an environment chosen by its id, though off, is computed apart');
    const stale = admittanceOf(lone, { choice: 'all' });
    assert.ok(same(stale.series, lociOf(lone)) && !stale.environment.every,
        'Admittance: a design without environments computes as itself, a stored All aside');
    assert.deepEqual(tableColumns(en).map(col => col.key), ['layer', 'material', 're', 'im', 'gRe', 'gIm'],
        'Admittance: one environment\'s table keeps today\'s columns');
    const option = buildAdmittanceOption(own.series, own.matColorMap, own.matName, c, { marks: AD_COLORS });
    const arcs = curvesOf(option);
    assert.ok(arcs.length && arcs.every(s => Object.values(own.matColorMap).includes(s.lineStyle.color)) && !option.legend.show,
        'Admittance: one environment colours each layer by its material, with no legend');
    assert.ok(!header.test(drawn(AdmittanceDiagram, design)), 'Admittance: and no Environment column');
}

// 2. All.
{
    const all = admittanceOf(design, { choice: 'all' });
    assert.deepEqual([...new Set(all.series.map(item => item.env.label))], LABELS, 'Admittance: All computes every environment that is on');
    // eslint-disable-next-line no-unused-vars
    const apart = all.series.map(({ env, ...item }) => item);
    assert.ok(same(apart, [...lociOf(design), ...lociOf(wet)]), 'Admittance: each environment\'s loci are its design\'s, computed apart');
    const rows = [...buildAdmittanceTableRows(lociOf(design), all.matName, design), ...buildAdmittanceTableRows(lociOf(wet), all.matName, wet)];
    assert.ok(same(all.tableRows.map(({ env, ...row }) => row), rows), 'Admittance: the table lists each environment\'s rows in turn');
    const half = rows.length / 2;
    assert.ok(all.tableRows.every((row, k) => row.env === LABELS[k < half ? 0 : 1]), 'Admittance: each naming its environment');
    assert.deepEqual(tableColumns(en, true).map(col => col.key).slice(0, 2), ['env', 'layer'], 'Admittance: in a column of its own, first');
    assert.notDeepEqual(rows[0], rows[half], 'Admittance: the two environments differ, on substrates of their own');

    const option = buildAdmittanceOption(all.series, all.matColorMap, all.matName, c, { marks: AD_COLORS });
    const arcs = curvesOf(option);
    const colorOf = label => environmentColor(AD_COLORS, LABELS.indexOf(label) + 1);
    assert.ok(arcs.every(s => LABELS.some(label => s.name.endsWith(` (${label})`) && s.lineStyle.color === colorOf(label))),
        'Admittance: each locus drawn in its environment\'s colour and named after it');
    const solid = arcs.filter(s => s.name.includes('(s)')), dashed = arcs.filter(s => s.name.includes('(p)'));
    assert.ok(solid.length && dashed.length && solid.every(s => s.lineStyle.type === 'solid') && dashed.every(s => s.lineStyle.type !== 'solid'),
        'Admittance: s solid and p dashed, as for one environment');
    assert.deepEqual(option.legend.data.map(item => item.name ?? item), LABELS, 'Admittance: the legend names the environments');
    const marks = option.series.filter(s => s.type === 'scatter' && s.symbol === 'rect');
    assert.deepEqual(marks.map(s => s.itemStyle.color), [1, 1, 2, 2].map(n => environmentColor(AD_COLORS, n)),
        'Admittance: each environment\'s η_s in its colour');
    assert.equal(option.series.filter(s => s.type === 'scatter' && s.label?.show).length, 3,
        'Admittance: η_s, Y₀ and η₀ named on the first locus alone');

    const html = drawn(AdmittanceDiagram, design, { choice: 'all' });
    assert.ok(header.test(html) && html.includes(rowCount(rows.length)), 'Admittance: the window\'s table has the Environment column and every row');
}

// ── Electric Field ──────────────────────────────────────────────────────────
const EF = { lambda: 550, theta: 30, pol: 'avg', side: 'front', showTable: true, axisRefFromDesign: true };
for (const one of [lone, design, thick]) eFieldSession.write(one, EF);
const fieldOf = (one, state) => hooked(() => useEFieldState(one), one, state);
const fieldParams = state => ({ lambda: state.lambda, theta: state.theta, pol: state.pol, side: state.side, refLambda: state.axisRefLambda });
const profileOf = (one, state) => computeProfile(one, fieldParams(state));
const COLORS = { bgColor: '#111111', paperColor: '#222222', gridColor: '#333333', textColor: '#eeeeee', accentColor: '#3399ff' };
const fieldOption = state => efieldOption(state.profile, state.pol, state.matColorMap, COLORS,
    { curve: EF_COLORS, tr: en.eField, display: state.display, sets: state.sets });

// 1. One environment.
{
    const own = fieldOf(design);
    assert.ok(same(own.profile, profileOf(design, own)) && own.sets === null, 'Field: Current on environment 1 is the design itself');
    const env2 = fieldOf(design, { current: 'env2' });
    assert.ok(same(env2.profile, profileOf(wet, env2)), 'Field: Current follows the current environment');
    const env3 = fieldOf(design, { choice: 'env3' });
    assert.ok(same(env3.profile, profileOf(thin, env3)), 'Field: an environment chosen by its id, though off, is computed apart');
    const stale = fieldOf(lone, { choice: 'all' });
    assert.ok(same(stale.profile, profileOf(lone, stale)) && stale.sets === null, 'Field: a design without environments computes as itself');
    const option = fieldOption(own);
    assert.deepEqual(curvesOf(option).map(s => s.lineStyle.color), [EF_COLORS.avg, EF_COLORS.s, EF_COLORS.p],
        'Field: one environment draws each polarization in its own colour');
    assert.ok(!header.test(drawn(EFieldEvaluation, design)), 'Field: and lists no Environment column');
}

// 2. All.
{
    const all = fieldOf(design, { choice: 'all' });
    assert.deepEqual(all.sets.map(set => set.env.label), LABELS, 'Field: All computes every environment that is on');
    assert.ok(same(all.sets.map(set => set.profile), [profileOf(design, all), profileOf(wet, all)]) && all.sets[0].profile === all.profile,
        'Field: each environment\'s field is its design\'s, the first the profile shown');
    const option = fieldOption(all);
    const curves = curvesOf(option);
    const single = curvesOf(fieldOption(fieldOf(design)));
    assert.deepEqual(curves.map(s => [s.name, s.lineStyle.color, s.lineStyle.type]),
        LABELS.flatMap((label, k) => single.map(s => [`${s.name} (${label})`, environmentColor(EF_COLORS, k + 1), s.lineStyle.type])),
        'Field: each environment\'s curves in its colour, named after it, each polarization keeping its dash');
    assert.deepEqual(option.legend.data.map(item => item.name ?? item), LABELS, 'Field: the legend names the environments');
    const level = profile => incidentLevel(all.display.quantity, incidentAmplitudeVpm(profile.incidentIndex));
    assert.deepEqual(curves[3].markLine.data, [{ yAxis: level(all.sets[1].profile), lineStyle: { color: `${environmentColor(EF_COLORS, 2)}88`, type: 'dotted' } }],
        'Field: the second environment\'s incident level in its colour');

    const deep = fieldOf(thick, { choice: 'all' });
    const own3 = fieldOf(thick, { choice: 'env3' });
    assert.ok(same(own3.profile, profileOf(thickest, own3)), 'Field: the thicker environment computed');
    const ends = [fieldOption(deep).xAxis.max, fieldOption(own3).xAxis.max, fieldOption(fieldOf(thick)).xAxis.max];
    assert.ok(ends[0] === ends[1] && ends[1] > ends[2], `Field: the depth axis runs on to the thickest stack (${ends})`);
    const bands = state => fieldOption(state).series[0].markArea;
    assert.ok(same(bands(deep), bands(fieldOf(thick))) && !same(bands(deep), bands(own3)),
        'Field: the layer bands are the first environment\'s, not the thicker one\'s');

    const rows = all.sets.reduce((n, set) => n + fieldTable(set.profile, all.pol, en.eField, all.display).rows.length, 0);
    const html = drawn(EFieldEvaluation, design, { choice: 'all' });
    assert.ok(header.test(html) && html.includes(rowCount(rows)), 'Field: the table has the Environment column and every environment\'s rows');
}

// 3. A long stack: 240 layers in four environments are more samples than a
// call takes as arguments, and the plot still draws every curve.
{
    const layers = Array.from({ length: 240 }, (_, k) => ({ id: `b${k}`, material: k % 2 ? 'builtin:MgF2' : 'builtin:TiO2', thickness: 60 }));
    const fourth = { id: 'env4', thicknessFactors: { 'builtin:MgF2': 1.02 } };
    const long = { ...design, frontLayers: layers, environments: [base, sapphire, { ...third, enabled: true }, fourth] };
    eFieldSession.write(long, EF);
    const all = fieldOf(long, { choice: 'all' });
    assert.ok(all.sets.length === 4 && curvesOf(fieldOption(all)).length === 12, 'Field: a 240-layer stack under All in four environments draws');
}

// ── Refractive Index Profile ────────────────────────────────────────────────
const RI = { lambda: 550, quantity: 'both', side: 'front', showTable: true };
for (const one of [lone, design, thick]) profilerSession.write(one, RI);
const indexOf = (one, state) => hooked(() => useProfilerState(one, en.riProfile), one, state);
const RI_DRAW = { bgColor: '#111111', paperColor: '#222222', gridColor: '#333333', textColor: '#eeeeee' };
const indexOption = state => buildRIOption({
    profile: state.profile, quantity: state.quantity, matColorMap: state.matColorMap, colors: RI_DRAW,
    depthAxis: 'z', curve: RI_COLORS, sets: state.sets,
});

// 1. One environment.
{
    const own = indexOf(design);
    assert.ok(same(own.profile, computeProfileForSide(design, 550, 'front')) && own.sets === null, 'Index: Current on environment 1 is the design itself');
    assert.ok(same(indexOf(design, { current: 'env2' }).profile, computeProfileForSide(wet, 550, 'front')), 'Index: Current follows the current environment');
    assert.ok(same(indexOf(design, { choice: 'env3' }).profile, computeProfileForSide(thin, 550, 'front')),
        'Index: an environment chosen by its id, though off, is computed apart');
    const stale = indexOf(lone, { choice: 'all' });
    assert.ok(same(stale.profile, computeProfileForSide(lone, 550, 'front')) && stale.sets === null, 'Index: a design without environments computes as itself');
    const option = indexOption(own);
    assert.deepEqual([curvesOf(option).map(s => s.lineStyle.color), option.yAxis[1].nameTextStyle?.color ?? option.yAxis[1].axisLine?.lineStyle?.color],
        [[RI_COLORS.n, RI_COLORS.k], RI_COLORS.k], 'Index: one environment draws n and k in their colours, the k axis in k\'s');
    assert.ok(!header.test(drawn(RefractiveIndexProfiler, design)), 'Index: and lists no Environment column');
}

// 2. All.
{
    const all = indexOf(design, { choice: 'all' });
    assert.ok(same(all.sets.map(set => [set.env.label, set.profile]), [[LABELS[0], all.profile], [LABELS[1], computeProfileForSide(wet, 550, 'front')]]),
        'Index: All computes every environment that is on, the first the profile shown');
    const option = indexOption(all);
    assert.deepEqual(curvesOf(option).map(s => [s.name, s.lineStyle.color, s.yAxisIndex, s.lineStyle.type === 'solid']),
        LABELS.flatMap((label, k) => [[`n (${label})`, environmentColor(RI_COLORS, k + 1), 0, true], [`k (${label})`, environmentColor(RI_COLORS, k + 1), 1, false]]),
        'Index: n and k in each environment\'s colour, named after it, k dashed on its own axis');
    const kAxis = option.yAxis[1];
    assert.equal(kAxis.nameTextStyle?.color ?? kAxis.axisLine?.lineStyle?.color, RI_DRAW.textColor, 'Index: the k axis named in the text colour');
    assert.deepEqual(option.legend.data.map(item => item.name ?? item), LABELS, 'Index: the legend names the environments');

    const [deep, own3, own1] = [indexOf(thick, { choice: 'all' }), indexOf(thick, { choice: 'env3' }), indexOf(thick)];
    const ends = [deep, own3, own1].map(state => indexOption(state).xAxis.max);
    assert.ok(ends[0] === ends[1] && ends[1] > ends[2], `Index: the depth axis runs on to the thickest stack (${ends})`);
    const bands = state => indexOption(state).series[0].markArea;
    assert.ok(same(bands(deep), bands(own1)) && !same(bands(deep), bands(own3)),
        'Index: the layer bands are the first environment\'s, not the thicker one\'s');

    const rows = all.sets.reduce((n, set) => n + indexTable(false, set.profile, [], en.units).rows.length, 0);
    const html = drawn(RefractiveIndexProfiler, design, { choice: 'all' });
    assert.ok(header.test(html) && html.includes(rowCount(rows)), 'Index: the table has the Environment column and every environment\'s rows');
}

// 3. The whole part.
{
    profilerSession.write(thick, { ...RI, quantity: 'n', side: 'total' });
    const all = indexOf(thick, { choice: 'all' });
    assert.ok(same(all.sets.map(set => set.regions), [thick, environmentDesign(thick, 'env2'), thickest].map(one => computeTotalRegions(one, 550, en.riProfile))),
        'Index: the whole part of every environment on, each its design\'s');
    const option = buildRITotalOption(all.regions, 'n', { matColorMap: all.matColorMap, colors: RI_DRAW, units: en.units, curve: RI_COLORS, sets: all.sets });
    const curves = curvesOf(option);
    const named = key => all.regions.find(one => one.key === key).label;
    const region = (label, key) => curves.find(s => s.name === `n (${label})` && s.data[0].region === named(key));
    const xs = s => s.data.map(point => point.value[0]);
    const third3 = '3';
    assert.ok([LABELS[1], third3].every(label => xs(region(label, 'substrate'))[0] === xs(region(LABELS[0], 'substrate'))[0]),
        'Index: the substrate starts at the same place in every environment');
    const [front1, front3] = [xs(region(LABELS[0], 'front')).at(-1), xs(region(third3, 'front')).at(-1)];
    const separator = curves[0].markLine.data.find(line => line.lineStyle.type === 'dashed').xAxis;
    assert.ok(front3 > front1 && separator > front3 && separator < xs(region(LABELS[0], 'substrate'))[0],
        'Index: the front sized by the thickest environment, the line between the regions clear of it');
    // The front starts the plot alike in both, so its bands sit where they do for one environment.
    const one = buildRITotalOption(all.regions, 'n', { matColorMap: all.matColorMap, colors: RI_DRAW, units: en.units, curve: RI_COLORS });
    const [bands, ownBands] = [curves[0].markArea.data, curvesOf(one)[0].markArea.data];
    const layers = thick.frontLayers.length;
    assert.ok(bands.length === ownBands.length && same(bands.slice(0, layers), ownBands.slice(0, layers)),
        'Index: the bands are the first environment\'s');
    profilerSession.write(thick, RI);
}

// ── Every window: the droplist and the range notice ─────────────────────────
{
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');
    const literal = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tip = literal(esc(en.analysisChrome.environmentTip));
    const droplist = html => html.match(new RegExp(`<label[^>]*><span[^>]*>${en.environments.environment}</span>(<select[^>]*title="[^"]*${tip}"[^>]*>.*?</select>)</label>`));
    const optionsOf = html => [...html.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map(match => match[1]);
    for (const [name, Window] of [['Admittance', AdmittanceDiagram], ['Field', EFieldEvaluation], ['Index', RefractiveIndexProfiler]]) {
        const select = droplist(drawn(Window, design, { current: 'env2' }));
        assert.ok(select, `${name}: the Environment droplist on a design with environments`);
        assert.deepEqual(optionsOf(select[1]), ['Current (2)', ...LABELS, '3', 'All'], `${name}: Current, each environment and All`);
        assert.equal(droplist(drawn(Window, lone)), null, `${name}: and none without environments`);
    }
    const ids = materials => materials.map(m => m.id);
    for (const [name, useHook] of [
        ['Admittance', one => useAdmittanceDiagram(one)],
        ['Field', one => useEFieldState(one)],
        ['Index', one => useProfilerState(one, en.riProfile)],
    ]) {
        const materialsOf = state => ids(hooked(() => useHook(design), design, state).materials);
        assert.ok(!materialsOf().includes('builtin:Al2O3'), `${name}: the range notice reads environment 1's own materials`);
        assert.ok(materialsOf({ choice: 'env2' }).includes('builtin:Al2O3'), `${name}: environment 2's sapphire when it is chosen`);
        const every = materialsOf({ choice: 'all' });
        assert.ok(every.includes('builtin:Al2O3') && every.includes('builtin:BK7'), `${name}: every environment shown under All`);
    }
    shown(design);

    // Preferences > Analysis: Admittance keeps its material colours under
    // Palette and lists the environments' apart; a window with no other
    // palette shows the environments' under Palette.
    const settings = en.settings.analysis;
    const fields = windowId => renderToStaticMarkup(h(WindowFields, {
        windowId, resolved: resolveAnalysisSettings(windowId, {}), onChange: () => {}, c, t: en,
    }));
    const admittance = fields('admittanceDiagram');
    const slots = html => count => html.split(`>${settings.paletteSlot(count)}<`).length - 1;
    assert.ok(admittance.indexOf(`>${settings.palette}<`) < admittance.indexOf(`>${settings.environmentPalette}<`)
        && slots(admittance)(10) === 2, 'Admittance: Settings lists the material palette and the environment palette apart');
    const field = fields('eFieldEvaluation');
    assert.ok(field.includes(`>${settings.palette}<`) && !field.includes(settings.environmentPalette) && slots(field)(10) === 1,
        'Field: the environments under Palette, the window having no other');
}

console.log('environments_admittance_field_profile: ALL PASS');
