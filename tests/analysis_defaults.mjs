/**
 * Analysis-window display defaults: the registry (constants/analysisDefaults.js)
 * and the resolver (utils/analysisSettings.js).
 *
 * The characterization block at the bottom pins every factory colour to the
 * literal it replaced in the figure modules, so moving a colour into the
 * registry is provably a no-op until the user changes it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, '..', 'src');

// The modules are ESM using browser-side React; import them directly.
const {
  ANALYSIS_DEFAULTS, ANALYSIS_WINDOW_IDS, SPECTRAL_UNIT_IDS: SPECTRAL_UNITS,
  registryKeys, sessionDefaults,
} = await import(new URL('../src/constants/analysisDefaults.js', import.meta.url));
const {
  resolveAnalysisSettings, resolveAnalysisColors, setAnalysisOverride,
  resetAnalysisWindow, isAnalysisWindowOverridden, sanitizeAnalysisOverrides,
} = await import(new URL('../src/utils/analysisSettings.js', import.meta.url));

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// Obsolete fields from an older registry are removed rather than appearing as
// a modified window after an upgrade. GD/GDD used four quantity colours before
// all quantities moved to the single curve colour.
{
  const stale = {
    gdGddEvaluation: {
      colors: { phase: '#111111', gd: '#222222', gdd: '#333333', tod: '#444444' },
    },
  };
  ok(Object.keys(sanitizeAnalysisOverrides(stale)).length === 0,
    'obsolete GD/GDD colour overrides are removed');
  ok(!isAnalysisWindowOverridden(stale, 'gdGddEvaluation'),
    'obsolete GD/GDD colours do not mark the window as modified');

  const current = setAnalysisOverride(stale, 'materialDispersion', 'colors', 'curve', '#123456');
  ok(current.gdGddEvaluation === undefined,
    'writing a current setting does not preserve obsolete fields');
  ok(current.materialDispersion.colors.curve === '#123456',
    'the Material Dispersion curve colour can be stored');
}

// ── Registry shape ──────────────────────────────────────────────────────────
{
  ok(ANALYSIS_WINDOW_IDS.length === 18, 'registry covers the eighteen windows with display settings');
  ok(ANALYSIS_WINDOW_IDS[0] === 'opticalEvaluation', 'Optical Evaluation leads the rail');
  ok(!ANALYSIS_WINDOW_IDS.includes('shared'),
    'there is no catch-all entry: every setting belongs to the window that shows it');

  // Every window whose settings panel has controls declares them here, because
  // this is what Settings → Analysis renders itself from. A window that keeps a
  // setting to itself is a setting the main Settings menu cannot reach.
  const withoutControls = Object.entries(ANALYSIS_DEFAULTS)
    .filter(([, entry]) => ['numbers', 'enums', 'booleans', 'lists']
      .every(section => Object.keys(entry[section] || {}).length === 0))
    .map(([id]) => id);
  ok(withoutControls.join(',') === 'plotEngine',
    `only the Plot Engine has no configurable controls (got: ${withoutControls.join(',')})`);

  const hexColor = /^#[0-9a-f]{6}$/;
  for (const [id, entry] of Object.entries(ANALYSIS_DEFAULTS)) {
    for (const [key, value] of Object.entries(entry.colors || {})) {
      ok(hexColor.test(value.toLowerCase()), `${id}.${key} is a 6-digit hex colour`);
    }
    for (const [key, spec] of Object.entries(entry.numbers || {})) {
      ok(typeof spec.def === 'number' && Number.isFinite(spec.def), `${id}.${key} has a finite default`);
      ok(spec.min <= spec.def && spec.def <= spec.max, `${id}.${key} default lies inside its own bounds`);
    }
    for (const [key, spec] of Object.entries(entry.enums || {})) {
      ok(spec.options.includes(spec.def), `${id}.${key} default is one of its options`);
    }
    for (const [key, spec] of Object.entries(entry.lists || {})) {
      ok(Array.isArray(spec.def) && spec.def.length > 0, `${id}.${key} ships a non-empty list`);
      ok(spec.def.every(entry_ => entry_ >= spec.min && entry_ <= spec.max),
        `${id}.${key} default lies inside its own bounds`);
      ok(spec.def.length <= spec.maxLength, `${id}.${key} default is within its own length limit`);
    }
  }
}

// ── Resolution: factory defaults when nothing is stored ─────────────────────
{
  const resolved = resolveAnalysisSettings('opticalEvaluation', undefined);
  ok(resolved.colors.T === '#2196f3', 'unstored colour resolves to the factory value');
  ok(resolved.numbers.yMax === 100, 'unstored number resolves to the factory value');
  ok(resolved.booleans.yAuto === false, 'unstored boolean resolves to the factory value');

  ok(resolved.numbers.lambdaStart === 400 && resolved.numbers.lambdaEnd === 800
    && resolved.numbers.lambdaStep === 2, 'the spectral range resolves to its factory values');
  ok(resolved.enums.spectralUnit === 'nm', 'the spectral unit defaults to nm');
  ok(resolved.lists.thetas.length === 1 && resolved.lists.thetas[0] === 0,
    'and the angle list to a single normal-incidence entry');
}

// ── Resolution: a stored override wins ──────────────────────────────────────
{
  const stored = { opticalEvaluation: { colors: { T: '#123456' }, numbers: { yMax: 50 } } };
  const resolved = resolveAnalysisSettings('opticalEvaluation', stored);
  ok(resolved.colors.T === '#123456', 'a stored colour wins');
  ok(resolved.colors.R === '#ef5350', 'sibling colours keep their factory value');
  ok(resolved.numbers.yMax === 50, 'a stored number wins');
  ok(resolveAnalysisColors('opticalEvaluation', stored).T === '#123456', 'the colours-only helper agrees');
}

// ── Resolution: junk is ignored, never propagated into a plot ───────────────
{
  const stored = {
    opticalEvaluation: {
      colors: { T: 'red', R: '#GGGGGG', A: '#66bb6a', bogus: '#000000' },
      numbers: { yMin: 'low', yMax: Infinity },
      booleans: { yAuto: 'yes' },
    },
  };
  const resolved = resolveAnalysisSettings('opticalEvaluation', stored);
  ok(resolved.colors.T === '#2196f3', 'a named colour is rejected — hex only');
  ok(resolved.colors.R === '#ef5350', 'a malformed hex is rejected');
  ok(resolved.colors.A === '#66bb6a', 'a valid stored colour still applies');
  ok(resolved.colors.bogus === undefined, 'a key the registry does not declare is dropped');
  ok(resolved.numbers.yMin === 0, 'a non-numeric number is rejected');
  ok(resolved.numbers.yMax === 100, 'a non-finite number is rejected');
  ok(resolved.booleans.yAuto === false, 'a non-boolean is rejected');

  // Out of range falls back rather than clamping: a 0 nm step would hang a sweep.
  const badStep = resolveAnalysisSettings('opticalEvaluation',
    { opticalEvaluation: { numbers: { lambdaStep: 0 } } });
  ok(badStep.numbers.lambdaStep === 2, 'an out-of-range step falls back to the default, not the minimum');

  // A list is all-or-nothing: one unusable angle and the shipped list is kept.
  const badAngles = resolveAnalysisSettings('opticalEvaluation',
    { opticalEvaluation: { lists: { thetas: [0, 45, 900] } } });
  ok(badAngles.lists.thetas.length === 1 && badAngles.lists.thetas[0] === 0,
    'an angle outside the bounds rejects the whole list rather than half-applying it');
  const goodAngles = resolveAnalysisSettings('opticalEvaluation',
    { opticalEvaluation: { lists: { thetas: [0, 45] } } });
  ok(goodAngles.lists.thetas.length === 2, 'a usable list is kept');

  const unknownWindow = resolveAnalysisSettings('notAWindow', {});
  ok(Object.keys(unknownWindow.colors).length === 0, 'an unknown window resolves to empty sections');
}

// ── Writing overrides ───────────────────────────────────────────────────────
{
  let stored = setAnalysisOverride({}, 'opticalEvaluation', 'colors', 'T', '#111111');
  ok(stored.opticalEvaluation.colors.T === '#111111', 'an override is stored');
  ok(isAnalysisWindowOverridden(stored, 'opticalEvaluation'), 'the window reads as overridden');

  // Setting a field back to its factory value must leave nothing behind, so the
  // window keeps following the shipped colour if a later release changes it.
  stored = setAnalysisOverride(stored, 'opticalEvaluation', 'colors', 'T', '#2196f3');
  ok(stored.opticalEvaluation === undefined, 'restoring the factory value clears the block entirely');
  ok(!isAnalysisWindowOverridden(stored, 'opticalEvaluation'), 'the window no longer reads as overridden');

  stored = setAnalysisOverride({}, 'notAWindow', 'colors', 'T', '#111111');
  ok(stored.notAWindow === undefined, 'an unknown window cannot be written');
  stored = setAnalysisOverride({}, 'opticalEvaluation', 'colors', 'bogus', '#111111');
  ok(stored.opticalEvaluation === undefined, 'an undeclared field cannot be written');

  let multi = setAnalysisOverride({}, 'opticalEvaluation', 'colors', 'T', '#111111');
  multi = setAnalysisOverride(multi, 'opticalEvaluation', 'numbers', 'yMax', 50);
  multi = setAnalysisOverride(multi, 'gdGddEvaluation', 'colors', 'curve', '#222222');
  ok(multi.opticalEvaluation.colors.T === '#111111' && multi.opticalEvaluation.numbers.yMax === 50,
    'multiple sections coexist for one window');

  const afterReset = resetAnalysisWindow(multi, 'opticalEvaluation');
  ok(afterReset.opticalEvaluation === undefined, 'reset clears the window');
  ok(afterReset.gdGddEvaluation.colors.curve === '#222222', 'reset leaves other windows alone');
  ok(multi.opticalEvaluation.colors.T === '#111111', 'reset does not mutate the input');
}

// ── Characterization: factory colours equal the literals they replaced ──────
// The registry value must be exactly what the window drew before the setting
// existed, so moving a colour here is provably a no-op until the user changes
// it. Two guards: the hex is still registered (below), and the figure module
// no longer carries its own copy (further down).
{
  const CURRENT_LITERALS = {
    opticalEvaluation:      ['#2196f3', '#ef5350', '#66bb6a', '#64b5f6', '#ef9a9a', '#1565c0', '#c62828'],
    gdGddEvaluation:        ['#4fc3f7'],
    materialDispersion:     ['#4fc3f7'],
    ellipsometryEvaluation: ['#4fc3f7', '#ef5350'],
    eFieldEvaluation:       ['#66bb6a', '#4fc3f7', '#ef5350'],
    inhomogeneities:        ['#4fc3f7', '#ef5350', '#66bb6a'],
    systematicDeviations:   ['#4fc3f7', '#ef5350', '#66bb6a'],
    roughnessScattering:    ['#ef5350', '#4fc3f7', '#ffb74d'],
    refractiveIndexProfiler:['#4fc3f7', '#ef5350'],
    layerThicknesses:       ['#4fc3f7'],
    admittanceDiagram:      ['#ffca28', '#66bb6a', '#ef5350'],
    integralValues:         ['#4fc3f7', '#ef5350', '#66bb6a', '#ffd54f'],
    errorAnalysis:          ['#4fc3f7', '#ef5350', '#66bb6a'],
    colorEvaluation:        ['#bbbbbb', '#ffffff'],
    layerSensitivity:       ['#4fc3f7'],
    plotEngine:             ['#4fc3f7', '#ef5350', '#66bb6a', '#ffb74d', '#ba68c8'],
  };

  for (const [id, expected] of Object.entries(CURRENT_LITERALS)) {
    const registered = Object.values(ANALYSIS_DEFAULTS[id].colors).map(v => v.toLowerCase());
    for (const colour of expected) {
      ok(registered.includes(colour), `${id} registry carries the shipped colour ${colour}`);
    }
  }

  // The two blues the app currently draws T with. Documented so that unifying
  // them later is a deliberate change and this assertion is what fails first.
  ok(ANALYSIS_DEFAULTS.opticalEvaluation.colors.T === '#2196f3',
    'Optical Evaluation keeps its own blue for T');
  ok(ANALYSIS_DEFAULTS.inhomogeneities.colors.T === '#4fc3f7',
    'the other windows keep the lighter blue for T');
}

// ── The wired figure modules hold no colour literals of their own ───────────
// A literal left behind in a figure module is a colour the Settings pane
// silently fails to control, which is worse than not offering the setting.
// Read the modules as text; the registry import is what should remain.
{
  const WIRED = {
    'windows/analysis/integralValues/overlayFigure.js':      ['#4fc3f7', '#ef5350', '#66bb6a', '#ffd54f'],
    'windows/analysis/layerSensitivity/figure.js':           ['#4fc3f7'],
    'windows/analysis/errorAnalysis/ErrorChart.js':          ['#4fc3f7', '#66bb6a'],
    'windows/analysis/colorEvaluation/chartFigure.js':       ['#bbbbbb', '#ffffff'],
    'windows/analysis/admittanceDiagram/chartFigure.js':     ['#ffca28', '#66bb6a', '#ef5350'],
    'windows/analysis/admittanceDiagram/model.js':           ['#4fc3f7', '#ab47bc', '#8d6e63'],
  };

  for (const [relative, gone] of Object.entries(WIRED)) {
    const text = readFileSync(join(src, 'components', relative), 'utf8').toLowerCase();
    for (const colour of gone) {
      ok(!text.includes(colour), `${relative} no longer hardcodes ${colour}`);
    }
    ok(text.includes('analysisdefaults.js') || text.includes('analysissettingscontext.js'),
      `${relative} reads its colours from the registry`);
  }
}

// ── The Plot Engine palette agrees with the curve factory's fallback ────────
// makeDefaultCurve keeps its own palette so the physics utils stay usable
// without the UI registry. The two must not drift: the fallback is what a
// curve built outside the window gets.
{
  const { paletteColors } = await import(new URL('../src/constants/analysisDefaults.js', import.meta.url));
  const registered = paletteColors(ANALYSIS_DEFAULTS.plotEngine.colors, 'series');
  const text = readFileSync(join(src, 'utils', 'physics', 'plotQuantities', 'curves.js'), 'utf8');
  const fallback = text
    .slice(text.indexOf('const CURVE_COLORS'), text.indexOf('let _curveSeq'))
    .match(/#[0-9a-f]{6}/gi) || [];

  ok(registered.length === 10, 'the Plot Engine palette has ten slots');
  ok(registered.every(Boolean), 'every Plot Engine palette slot is filled');
  ok(fallback.length === registered.length,
    'the curve factory fallback has as many colours as the registry palette');
  ok(fallback.every((colour, i) => colour.toLowerCase() === registered[i].toLowerCase()),
    'the curve factory fallback matches the registry palette in order');
}

// ── The Admittance material palette resolves in rotation order ──────────────
{
  const { paletteColors } = await import(new URL('../src/constants/analysisDefaults.js', import.meta.url));
  const palette = paletteColors(ANALYSIS_DEFAULTS.admittanceDiagram.colors, 'mat');

  ok(palette.length === 10, 'the Admittance material palette has ten slots');
  ok(palette[0] === '#4fc3f7', 'the first material keeps the shipped blue');
  ok(palette[9] === '#8d6e63', 'the tenth material keeps the shipped brown');

  const overridden = resolveAnalysisColors('admittanceDiagram', {
    admittanceDiagram: { colors: { mat1: '#123456' } },
  });
  ok(paletteColors(overridden, 'mat')[0] === '#123456',
    'an overridden palette slot reaches the resolved palette');
  ok(paletteColors(overridden, 'mat')[1] === '#ef5350',
    'the untouched slots keep their factory colours');
}

// ── Spectral units reuse the engine's table, not a parallel list ────────────
// The unit ids must be the ones spectralAxis.js defines ('cm1', not 'cm-1'),
// or the Settings dropdown would offer a value the converter cannot resolve
// and every conversion would silently fall back to nm.
{
  const { SPECTRAL_UNITS: ENGINE_UNITS, fromNm, toNm } =
    await import(new URL('../src/utils/physics/spectralAxis.js', import.meta.url));

  for (const id of SPECTRAL_UNITS) {
    ok(ENGINE_UNITS[id] !== undefined, `spectral unit "${id}" is known to the engine`);
  }
  ok(SPECTRAL_UNITS.includes('cm1'), 'the wavenumber id is cm1');
  ok(!SPECTRAL_UNITS.includes('cm-1'), 'the invalid cm-1 id is not offered');
  ok(SPECTRAL_UNITS.includes('THz'), 'THz is offered');
  ok(SPECTRAL_UNITS.length === Object.keys(ENGINE_UNITS).length,
    'Settings offers exactly the units the engine supports');

  // Round-tripping a stored nm value through any unit must come back to nm.
  for (const id of SPECTRAL_UNITS) {
    for (const nm of [400, 550, 800, 2500]) {
      const back = toNm(fromNm(nm, id), id);
      ok(Math.abs(back - nm) < 1e-6, `${nm} nm survives a round trip through ${id}`);
    }
  }

  // cm1, THz and eV are reciprocal in λ, so the ends of a range swap. The
  // Settings writer re-orders them; this pins the property it relies on.
  for (const id of ['cm1', 'THz', 'eV']) {
    ok(fromNm(400, id) > fromNm(800, id), `${id} runs opposite to wavelength`);
  }
  for (const id of ['nm', 'um']) {
    ok(fromNm(400, id) < fromNm(800, id), `${id} runs with wavelength`);
  }
}

// ── A session store starts from the registry, not from its own copy ─────────
// There is no second set of shipped values to drift: a store spreads
// sessionDefaults(), so what the window opens with and what Settings shows are
// the same declaration read twice.
{
  const oe = sessionDefaults('opticalEvaluation');
  ok(oe.lambdaStart === 400 && oe.lambdaEnd === 800 && oe.lambdaStep === 2,
    'the spectral range comes out of the registry');
  ok(oe.spectralUnit === 'nm', 'and so does the unit it is entered in');
  ok(Array.isArray(oe.thetas) && oe.thetas.length === 1 && oe.thetas[0] === 0,
    'and the angle list');
  oe.thetas.push(45);
  ok(sessionDefaults('opticalEvaluation').thetas.length === 1,
    'each call returns its own list, so a store cannot mutate the registry');

  ok(registryKeys('errorAnalysis').includes('lambdaStart'),
    'the Monte-Carlo evaluation grid is declared field by field, not as one opaque object');
  ok(registryKeys('plotEngine').length === 0, 'a window with no configurable controls declares none');

  for (const id of ANALYSIS_WINDOW_IDS) {
    const keys = registryKeys(id);
    const values = sessionDefaults(id);
    ok(keys.length === Object.keys(values).length, `${id}: every declared key has a shipped value`);
  }
}

// ── One path from the stored block to the windows ───────────────────────────
//
// Every window is pointed at the configured values by the provider. A window
// that seeded itself would be a second path, and the two would disagree the
// moment one of them was changed.
{
  const provider = readFileSync(join(src, 'state', 'AnalysisSettingsContext.js'), 'utf8');
  ok(provider.includes('applyAnalysisDefaults(stored)'),
    'the provider pushes the stored block into the session stores');

  const stateDir = join(src, 'components', 'windows', 'analysis');
  const windows = [
    'opticalEvaluation', 'gdGddEvaluation', 'materialDispersion', 'eFieldEvaluation',
    'refractiveIndexProfiler', 'layerThicknesses', 'ellipsometryEvaluation', 'admittanceDiagram',
    'layerSensitivity', 'roughnessScattering', 'inhomogeneities',
    'systematicDeviations', 'integralValues', 'colorEvaluation', 'errorAnalysis',
  ];
  for (const id of windows) {
    const source = readFileSync(join(stateDir, id, 'sessionState.js'), 'utf8');
    // Optical Evaluation splits its settings across two stores, so it narrows
    // the registry rather than taking all of it.
    ok(source.includes(`sessionDefaults('${id}')`) || source.includes(`pickDefaults('${id}'`),
      `${id} takes its shipped values from the registry rather than repeating them`);
    ok(source.includes(`registryKeys('${id}')`),
      `${id} saves exactly what the registry declares`);
  }

  const evalParams = readFileSync(join(src, 'state', 'evalParamsSession.js'), 'utf8');
  ok(evalParams.includes("pickDefaults('opticalEvaluation', EVAL_PARAM_KEYS)")
    && evalParams.includes("id: 'opticalEvaluation'"),
  'and so does the evaluation grid, under the window that owns it');
}

console.log(`analysis_defaults: ${passed} passed`);
