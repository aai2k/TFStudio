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

export const ANALYSIS_DEFAULTS = {
  // The spectral range is stored in nanometres because the physics engine
  // always works in vacuum wavelength; the unit below is a display choice only
  // and the Settings fields convert through utils/physics/spectralAxis.js.
  shared: {
    numbers: {
      lambdaStart: { def: 400, min: 1,    max: 100000, step: 1 },
      lambdaEnd:   { def: 800, min: 1,    max: 100000, step: 1 },
      lambdaStep:  { def: 2,   min: 0.01, max: 1000,   step: 0.1 },
    },
    enums: {
      spectralUnit: { def: 'nm', options: SPECTRAL_UNIT_IDS },
    },
  },

  opticalEvaluation: {
    colors: {
      T:  '#2196f3', R:  '#ef5350', A: '#66bb6a',
      Ts: '#64b5f6', Rs: '#ef9a9a',
      Tp: '#1565c0', Rp: '#c62828',
    },
    numbers: {
      yMin: { def: 0,   min: -1000, max: 10000, step: 1 },
      yMax: { def: 100, min: -1000, max: 10000, step: 1 },
    },
    booleans: { yAuto: false },
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
  },

  gdGddEvaluation: {
    colors: { phase: '#ab47bc', gd: '#4fc3f7', gdd: '#ef5350', tod: '#66bb6a' },
  },

  ellipsometryEvaluation: {
    colors: { psi: '#4fc3f7', delta: '#ef5350' },
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
  },

  eFieldEvaluation: {
    colors: { avg: '#66bb6a', s: '#4fc3f7', p: '#ef5350' },
  },

  refractiveIndexProfiler: {
    colors: { n: '#4fc3f7', k: '#ef5350' },
  },

  integralValues: {
    colors: {
      T: '#4fc3f7', R: '#ef5350', A: '#66bb6a',
      limits: '#ffd54f',
      min: '#ef5350', max: '#66bb6a',
    },
  },

  layerSensitivity: {
    // Bars are tinted per material; this is the fallback for a layer whose
    // material carries no colour.
    colors: { fallback: '#4fc3f7' },
  },

  errorAnalysis: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' },
  },

  inhomogeneities: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' },
  },

  systematicDeviations: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' },
  },

  roughnessScattering: {
    colors: { R: '#ef5350', T: '#4fc3f7', tis: '#ffb74d' },
  },
};

// Rail order for the Settings pane. `shared` leads because its spectral range
// applies to every window below it.
export const ANALYSIS_WINDOW_IDS = Object.keys(ANALYSIS_DEFAULTS);
