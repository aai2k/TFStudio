/**
 * Factory display defaults for the analysis windows.
 *
 * This registry is the single source for the curve colours the analysis plots
 * draw with, and for the ranges a window starts from. Settings renders itself
 * from it — a new window becomes an entry here, not new UI code — and each
 * window resolves its own entry at mount through utils/analysisSettings.js.
 *
 * Every value here is the factory default, i.e. exactly what the window drew
 * before the setting existed. Changing one changes the shipped appearance.
 *
 * Not covered here, deliberately:
 *   • Theme fallbacks (`c.panel || '#252526'`) — those follow the colour theme.
 *   • Material-derived colours (matColorMap in the E-field, Layer Sensitivity
 *     and Refractive Index Profiler plots) — those come from the material
 *     definitions and must keep agreeing with the Material Editor.
 *
 * `shared` is not a window. It holds the spectral range that seeds the
 * session-wide evaluation parameters (state/DesignContext.js), which every
 * analysis window reads.
 */
import { SPECTRAL_UNIT_IDS } from '../utils/physics/spectralAxis.js';

export { SPECTRAL_UNIT_IDS };

/**
 * Some windows colour by rotation rather than by named curve — Plot Engine
 * hands each new curve the next colour, the Admittance Diagram does the same
 * per distinct material in the stack. Those palettes are stored as numbered
 * keys (`series1`…, `mat1`…) so Settings can render one swatch per slot, and
 * read back as an ordered array through `paletteColors`.
 */
const PALETTE_SIZE = 10;

function palette(prefix, hexes) {
  return Object.fromEntries(hexes.map((hex, i) => [`${prefix}${i + 1}`, hex]));
}

/** Rotation-ordered colour array for a numbered palette. */
export function paletteColors(colors, prefix, size = PALETTE_SIZE) {
  return Array.from({ length: size }, (_, i) => colors[`${prefix}${i + 1}`]);
}

// Ranges and geometry a window shares with the others, spelled out here rather
// than repeated per window so a bound cannot drift between two windows that
// enter the same quantity.
const LAMBDA_BOUND = { min: 100, max: 30000, step: 10 };
const AOI = { def: 0, min: 0, max: 89, step: 1 };
const POL = { def: 'avg', options: ['avg', 's', 'p'] };
const SIDE = { def: 'front', options: ['front', 'back'] };

function lambdaRange(from, to) {
  return {
    lambdaStart: { def: from, ...LAMBDA_BOUND },
    lambdaEnd: { def: to, ...LAMBDA_BOUND },
  };
}

/**
 * The shipped values for one window's scalar settings, as a session store's
 * defaults.
 *
 * A window's store and the Settings pane read the same declaration, so the
 * value Settings shows is the value the window starts from — there is no second
 * copy to fall out of step. Keys the registry cannot describe, such as a curve
 * map or a parameter sweep, stay in the store's own literal defaults.
 */
export function sessionDefaults(windowId) {
  const registry = ANALYSIS_DEFAULTS[windowId] || {};
  const out = {};
  for (const [key, spec] of Object.entries(registry.numbers || {})) out[key] = spec.def;
  for (const [key, spec] of Object.entries(registry.enums || {})) out[key] = spec.def;
  for (const [key, value] of Object.entries(registry.booleans || {})) out[key] = value;
  for (const [key, spec] of Object.entries(registry.lists || {})) out[key] = [...spec.def];
  return out;
}

/**
 * The keys the registry declares for one window, optionally narrowed.
 *
 * A window whose settings are split across two stores narrows each of them, so
 * between them they still cover exactly what the registry declares.
 */
export function registryKeys(windowId, only) {
  const keys = Object.keys(sessionDefaults(windowId));
  return only ? keys.filter(key => only.includes(key)) : keys;
}

/** `sessionDefaults` narrowed to `keys`, or to everything outside them. */
export function pickDefaults(windowId, keys, { invert = false } = {}) {
  const all = sessionDefaults(windowId);
  const out = {};
  for (const [key, value] of Object.entries(all)) {
    if (keys.includes(key) !== invert) out[key] = value;
  }
  return out;
}

/**
 * Optical Evaluation's evaluation grid.
 *
 * These are its settings like any other, but they are held in DesignContext
 * rather than in the window, because the Spectrum Exchange window seeds its
 * export grid from them and would otherwise have to reach into a window that
 * may not be open.
 */
export const EVAL_PARAM_KEYS = [
  'lambdaStart', 'lambdaEnd', 'lambdaStep', 'spectralUnit', 'thetas',
];

export const ANALYSIS_DEFAULTS = {
  opticalEvaluation: {
    colors: {
      T:  '#2196f3', R:  '#ef5350', A: '#66bb6a',
      Ts: '#64b5f6', Rs: '#ef9a9a',
      Tp: '#1565c0', Rp: '#c62828',
    },
    // The spectral range is stored in nanometres because the physics engine
    // always works in vacuum wavelength; the unit below is a display choice
    // only, and the Settings fields convert through utils/physics/spectralAxis.js.
    numbers: {
      lambdaStart: { def: 400, min: 1,    max: 100000, step: 1 },
      lambdaEnd:   { def: 800, min: 1,    max: 100000, step: 1 },
      lambdaStep:  { def: 2,   min: 0.01, max: 1000,   step: 0.1 },
      // Match the bounds enforced by Optical Evaluation's own axis controls.
      yMin: { def: 0,   min: -10, max: 200, step: 5 },
      yMax: { def: 100, min: -10, max: 200, step: 5 },
    },
    enums: {
      spectralUnit: { def: 'nm', options: SPECTRAL_UNIT_IDS },
      // Whether T, R and A are shown as percentages or as fractions of the
      // incident flux. The bounds above are always percentages; the window
      // converts them for display, as it does the spectral range.
      yScale: { def: 'percent', options: ['percent', 'fraction'] },
    },
    // This window draws one set of curves per angle. Entered as a list because
    // it is a list: a single number would lose the comparison it is for.
    lists: {
      thetas: { def: [0], min: 0, max: 89, maxLength: 6 },
    },
    booleans: { yAuto: false, showTargets: true, showTable: false },
  },

  plotEngine: {
    // Handed to each new curve in turn.
    colors: palette('series', [
      '#4fc3f7', '#ef5350', '#66bb6a', '#ffb74d', '#ba68c8',
      '#81c784', '#ff8a65', '#7986cb', '#a1887f', '#90a4ae',
    ]),
  },

  colorEvaluation: {
    // Outlines of the two markers on the chromaticity diagram. The spectral
    // locus itself is drawn in the theme's text colour and follows the theme.
    colors: { whitePoint: '#bbbbbb', coating: '#ffffff' },
    numbers: {
      theta: AOI,
      step: { def: 5, min: 1, max: 20, step: 1 },
    },
    enums: {
      characteristic: { def: 'R', options: ['R', 'T'] },
      pol: POL,
      observer: { def: '2', options: ['2', '10'] },
      illuminant: { def: 'D65', options: ['D65', 'D50', 'A', 'E'] },
      exposure: { def: '1', options: ['1', '10', '50', '200', '1000', 'fit'] },
    },
    booleans: { showTable: false },
  },

  gdGddEvaluation: {
    colors: { curve: '#4fc3f7' },
    numbers: {
      lamStart: { def: 400, ...LAMBDA_BOUND },
      lamEnd: { def: 800, ...LAMBDA_BOUND },
      theta: AOI,
    },
    enums: {
      quantity: { def: 'gd', options: ['phase', 'gd', 'gdd', 'tod'] },
      target: { def: 'R', options: ['R', 'T'] },
      pol: POL,
    },
    // The manual Y bounds are not here: the window clears them whenever the
    // quantity changes, because a range in fs means nothing once the curve is
    // in fs³, so a saved pair would not survive to be used.
    booleans: { showRef: true, showTargets: true, showTable: false, yAuto: true },
  },

  materialDispersion: {
    colors: { curve: '#4fc3f7' },
    numbers: {
      thicknessMm: { def: 1, min: 0.000001, max: 10000, step: 0.1 },
      start: { def: 400, ...LAMBDA_BOUND },
      end: { def: 1100, ...LAMBDA_BOUND },
    },
    enums: {
      thicknessUnit: { def: 'mm', options: ['nm', 'um', 'mm'] },
      quantity: { def: 'gdd', options: ['phase', 'gd', 'gdd', 'tod'] },
    },
    booleans: { showTable: false },
  },

  ellipsometryEvaluation: {
    colors: { psi: '#4fc3f7', delta: '#ef5350' },
    numbers: {
      ...lambdaRange(400, 800),
      lambdaStep: { def: 2, min: 0.1, max: 1000, step: 0.5 },
      thetaDeg: { def: 65, min: 0, max: 89, step: 1 },
      angleStart: { def: 45, min: 0, max: 89, step: 1 },
      angleEnd: { def: 80, min: 0, max: 89, step: 1 },
      angleStep: { def: 0.5, min: 0.05, max: 30, step: 0.05 },
    },
    enums: {
      mode: { def: 'spectral', options: ['spectral', 'angular'] },
      deltaConvention: { def: 'azzam', options: ['azzam', 'reversed'] },
    },
    booleans: { showPsi: true, showDelta: true, showTable: false },
  },

  admittanceDiagram: {
    colors: {
      start: '#ffca28', end: '#66bb6a', target: '#ef5350',
      // One colour per distinct material in the stack, in order of first
      // appearance. Local to this window — the arcs are not tinted from the
      // material definitions the way the E-field and profile plots are.
      ...palette('mat', [
        '#4fc3f7', '#ef5350', '#66bb6a', '#ffca28', '#ab47bc',
        '#26c6da', '#ff7043', '#ec407a', '#78909c', '#8d6e63',
      ]),
    },
    numbers: { theta: { ...AOI, step: 0.5 } },
    enums: {
      view: { def: 'admittance', options: ['admittance', 'reflection'] },
      pol: POL,
      side: SIDE,
    },
    booleans: { showTable: false },
  },

  eFieldEvaluation: {
    colors: { avg: '#66bb6a', s: '#4fc3f7', p: '#ef5350' },
    numbers: { theta: AOI },
    enums: { pol: POL },
    booleans: { showTable: false },
  },

  refractiveIndexProfiler: {
    colors: { n: '#4fc3f7', k: '#ef5350' },
    enums: {
      quantity: { def: 'n', options: ['n', 'k'] },
      side: SIDE,
    },
    booleans: { showTable: false },
  },

  integralValues: {
    colors: {
      T: '#4fc3f7', R: '#ef5350', A: '#66bb6a',
      limits: '#ffd54f',
      min: '#ef5350', max: '#66bb6a',
    },
    // The band runs from the ultraviolet to the short-wave infrared because the
    // integrals include solar-weighted ones, which need the whole AM1.5 range.
    numbers: {
      ...lambdaRange(300, 2500),
      lambdaStep: { def: 5, min: 0.5, max: 50, step: 0.5 },
      theta: AOI,
    },
    enums: { polarization: POL },
    booleans: { showTable: true },
  },

  layerSensitivity: {
    // Bars are tinted per material; this is the fallback for a layer whose
    // material carries no colour.
    colors: { fallback: '#4fc3f7' },
    numbers: {
      relPct: { def: 1.0, min: 0.01, max: 100, step: 0.1 },
      absDeltaNm: { def: 1.0, min: 0.001, max: 1000, step: 0.1 },
    },
    enums: {
      mode: { def: 'relative', options: ['relative', 'absolute'] },
      scale: { def: 'normalized', options: ['normalized', 'absolute'] },
    },
    booleans: { includeLocked: false, showChart: false },
  },

  errorAnalysis: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' },
    numbers: {
      ...lambdaRange(400, 800),
      lambdaStep: { def: 5, min: 0.5, max: 50, step: 0.5 },
      theta: AOI,
      nTrials: { def: 200, min: 1, max: 100000, step: 50 },
      corridorSigma: { def: 1.0, min: 0.1, max: 10, step: 0.5 },
      rmsAbsNm: { def: 0, min: 0, max: 1000, step: 0.1 },
      rmsRelPct: { def: 1, min: 0, max: 100, step: 0.1 },
      rmsReN: { def: 0, min: 0, max: 2, step: 0.001 },
      rmsImN: { def: 0, min: 0, max: 2, step: 0.001 },
    },
    enums: {
      char: { def: 'R', options: ['T', 'R', 'A'] },
      polarization: POL,
      distribution: { def: 'gaussian', options: ['gaussian', 'uniform', 'truncated'] },
    },
    booleans: {
      perMaterial: false, keepOPT: false, showEnvelope: false,
      showEditor: true, showTable: false,
    },
  },

  inhomogeneities: {
    colors: {
      T: '#4fc3f7', R: '#ef5350', A: '#66bb6a',
      Ts: '#81d4fa', Rs: '#ef9a9a',
      Tp: '#0288d1', Rp: '#c62828',
    },
    numbers: {
      ...lambdaRange(400, 800),
      lambdaStep: { def: 2, min: 0.1, max: 1000, step: 0.5 },
      aoi: AOI,
    },
    booleans: { showEditor: true, showTable: false },
  },

  systematicDeviations: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' },
    numbers: {
      ...lambdaRange(400, 800),
      lambdaStep: { def: 5, min: 0.5, max: 50, step: 0.5 },
      aoi: { ...AOI, step: 5 },
    },
    enums: {
      mode: { def: 'single', options: ['single', 'sweep'] },
      channel: { def: 'all', options: ['all', 'T', 'R', 'A'] },
      sweepChannel: { def: 'T', options: ['T', 'R', 'A'] },
      pol: POL,
    },
    booleans: { showBaseline: true, showEditor: true, showTable: false },
  },

  roughnessScattering: {
    colors: {
      R: '#ef5350', T: '#4fc3f7', tis: '#ffb74d',
      Ts: '#81d4fa', Rs: '#ef9a9a',
      Tp: '#0288d1', Rp: '#c62828',
    },
    numbers: {
      ...lambdaRange(400, 800),
      lambdaStep: { def: 2, min: 0.1, max: 1000, step: 0.5 },
      aoi: AOI,
    },
    enums: { units: { def: 'ppm', options: ['ppm', 'frac'] } },
    booleans: { showEditor: true, showTable: false },
  },
};

// Rail order for the Settings pane. `shared` leads because its spectral range
// applies to every window below it.
export const ANALYSIS_WINDOW_IDS = Object.keys(ANALYSIS_DEFAULTS);
