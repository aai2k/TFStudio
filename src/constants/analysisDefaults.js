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

// Spectral units offered wherever a window exposes an x-axis unit choice.
export const SPECTRAL_UNITS = ['nm', 'um', 'eV', 'cm-1'];

export const ANALYSIS_DEFAULTS = {
  shared: {
    numbers: {
      lambdaStart: { def: 400, min: 1,    max: 100000, step: 1 },
      lambdaEnd:   { def: 800, min: 1,    max: 100000, step: 1 },
      lambdaStep:  { def: 2,   min: 0.01, max: 1000,   step: 0.1 },
    },
    enums: {
      spectralUnit: { def: 'nm', options: SPECTRAL_UNITS },
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
    // Rotating palette assigned to each new curve in turn.
    colors: {
      series1:  '#4fc3f7', series2:  '#ef5350', series3: '#66bb6a', series4: '#ffb74d', series5:  '#ba68c8',
      series6:  '#81c784', series7:  '#ff8a65', series8: '#7986cb', series9: '#a1887f', series10: '#90a4ae',
    },
  },

  colorEvaluation: {
    colors: { locus: '#bbbbbb', whitePoint: '#ffffff' },
  },

  gdGddEvaluation: {
    colors: { phase: '#ab47bc', gd: '#4fc3f7', gdd: '#ef5350', tod: '#66bb6a' },
  },

  ellipsometryEvaluation: {
    colors: { psi: '#4fc3f7', delta: '#ef5350' },
  },

  admittanceDiagram: {
    colors: { start: '#ffca28', end: '#66bb6a', target: '#ef5350' },
  },

  eFieldEvaluation: {
    colors: { avg: '#66bb6a', s: '#4fc3f7', p: '#ef5350' },
  },

  refractiveIndexProfiler: {
    colors: { n: '#4fc3f7', k: '#ef5350' },
  },

  integralValues: {
    colors: { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a', limits: '#ffd54f' },
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
