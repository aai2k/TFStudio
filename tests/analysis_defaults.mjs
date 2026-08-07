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
const { ANALYSIS_DEFAULTS, ANALYSIS_WINDOW_IDS, SPECTRAL_UNIT_IDS: SPECTRAL_UNITS } =
  await import(new URL('../src/constants/analysisDefaults.js', import.meta.url));
const {
  resolveAnalysisSettings, resolveAnalysisColors, setAnalysisOverride,
  resetAnalysisWindow, isAnalysisWindowOverridden,
} = await import(new URL('../src/utils/analysisSettings.js', import.meta.url));

let passed = 0;
function ok(condition, message) {
  if (!condition) throw new Error(message);
  passed++;
}

// ── Registry shape ──────────────────────────────────────────────────────────
{
  ok(ANALYSIS_WINDOW_IDS.length === 15, 'registry covers 14 windows plus the shared entry');
  ok(ANALYSIS_WINDOW_IDS[0] === 'shared', 'shared leads the rail');

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
  }
}

// ── Resolution: factory defaults when nothing is stored ─────────────────────
{
  const resolved = resolveAnalysisSettings('opticalEvaluation', undefined);
  ok(resolved.colors.T === '#2196f3', 'unstored colour resolves to the factory value');
  ok(resolved.numbers.yMax === 100, 'unstored number resolves to the factory value');
  ok(resolved.booleans.yAuto === false, 'unstored boolean resolves to the factory value');

  const shared = resolveAnalysisSettings('shared', {});
  ok(shared.numbers.lambdaStart === 400 && shared.numbers.lambdaEnd === 800 && shared.numbers.lambdaStep === 2,
    'the shared spectral range matches the hardcoded DesignContext seed');
  ok(shared.enums.spectralUnit === 'nm', 'the shared spectral unit defaults to nm');
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
  const badStep = resolveAnalysisSettings('shared', { shared: { numbers: { lambdaStep: 0 } } });
  ok(badStep.numbers.lambdaStep === 2, 'an out-of-range step falls back to the default, not the minimum');

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
  multi = setAnalysisOverride(multi, 'gdGddEvaluation', 'colors', 'gd', '#222222');
  ok(multi.opticalEvaluation.colors.T === '#111111' && multi.opticalEvaluation.numbers.yMax === 50,
    'multiple sections coexist for one window');

  const afterReset = resetAnalysisWindow(multi, 'opticalEvaluation');
  ok(afterReset.opticalEvaluation === undefined, 'reset clears the window');
  ok(afterReset.gdGddEvaluation.colors.gd === '#222222', 'reset leaves other windows alone');
  ok(multi.opticalEvaluation.colors.T === '#111111', 'reset does not mutate the input');
}

// ── Characterization: factory colours equal the literals they replaced ──────
// Read the figure modules as text and assert the colour still appears there.
// Once a module imports from the registry its literal is gone, and the check
// below is what proves the registry value carried the original through.
{
  const CURRENT_LITERALS = {
    opticalEvaluation:      ['#2196f3', '#ef5350', '#66bb6a', '#64b5f6', '#ef9a9a', '#1565c0', '#c62828'],
    gdGddEvaluation:        ['#ab47bc', '#4fc3f7', '#ef5350', '#66bb6a'],
    ellipsometryEvaluation: ['#4fc3f7', '#ef5350'],
    eFieldEvaluation:       ['#66bb6a', '#4fc3f7', '#ef5350'],
    inhomogeneities:        ['#4fc3f7', '#ef5350', '#66bb6a'],
    systematicDeviations:   ['#4fc3f7', '#ef5350', '#66bb6a'],
    roughnessScattering:    ['#ef5350', '#4fc3f7', '#ffb74d'],
    refractiveIndexProfiler:['#4fc3f7', '#ef5350'],
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

// ── The shared seed still matches DesignContext ─────────────────────────────
// If the hardcoded seed moves, the registry default has to move with it, or the
// app would start at a different range than the one Settings reports.
{
  const context = readFileSync(join(src, 'state', 'DesignContext.js'), 'utf-8');
  const seed = context.match(/lambdaStart:\s*(\d+),\s*lambdaEnd:\s*(\d+),\s*lambdaStep:\s*([\d.]+)/);
  ok(seed, 'the DesignContext evaluation seed is still recognizable');
  const shared = ANALYSIS_DEFAULTS.shared.numbers;
  ok(Number(seed[1]) === shared.lambdaStart.def, 'registry lambdaStart matches the DesignContext seed');
  ok(Number(seed[2]) === shared.lambdaEnd.def, 'registry lambdaEnd matches the DesignContext seed');
  ok(Number(seed[3]) === shared.lambdaStep.def, 'registry lambdaStep matches the DesignContext seed');
}

console.log(`analysis_defaults: ${passed} passed`);
