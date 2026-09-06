/**
 * Report block catalogue and templates.
 *
 * A report is an ordered list of blocks over one or more designs. Every block
 * has a type from BLOCK_TYPES, an on/off switch and a settings object whose
 * shape is fixed per type by `defaultSettings`. The five built-in types are in
 * every new report; a template switches them off but never removes them.
 *
 * A template is a block list without ids, plus the paper size and language.
 * Templates are stored as `.tfsr` files; `ver: 1` files written by the earlier
 * wizard convert through `convertLegacyPreset`, which also carries the cover
 * fields such a file holds as `doc`.
 *
 * Pure: no React, no DOM, so the window and the node tests share it.
 */

import { sessionDefaults } from '../../constants/analysisDefaults.js';

export const BLOCK_TYPES = [
  // Built-in: present in every new report.
  { type: 'title',        group: 'builtin', builtin: true },
  { type: 'facts',        group: 'builtin', builtin: true },
  { type: 'layers',       group: 'builtin', builtin: true },
  { type: 'materials',    group: 'builtin', builtin: true },
  { type: 'notes',        group: 'builtin', builtin: true },
  // From the analysis windows. `source` names the window whose session store
  // the block copies its settings from when it is added.
  { type: 'spectrum',     group: 'analysis', source: 'opticalEvaluation' },
  { type: 'color',        group: 'analysis', source: 'colorEvaluation' },
  { type: 'integrals',    group: 'analysis', source: 'integralValues' },
  { type: 'gdGdd',        group: 'analysis', source: 'gdGddEvaluation' },
  { type: 'ellipsometry', group: 'analysis', source: 'ellipsometryEvaluation' },
  { type: 'efield',       group: 'analysis', source: 'eFieldEvaluation' },
  { type: 'riProfile',    group: 'analysis', source: 'refractiveIndexProfiler' },
  // From a run made in the Monte-Carlo window: the block prints the last run
  // for the design rather than repeating it.
  { type: 'monteCarlo',   group: 'tolerance', source: 'errorAnalysis' },
  // From the Monitor Worksheet window's chip plan.
  { type: 'worksheet',    group: 'production', source: 'monitorWorksheet' },
  // From the design itself.
  { type: 'qualifiers',   group: 'design' },
  { type: 'merit',        group: 'design' },
  // Page furniture.
  { type: 'signatures',   group: 'other' },
];

export const BLOCK_TYPE_IDS = BLOCK_TYPES.map(b => b.type);
export const BUILTIN_TYPES = BLOCK_TYPES.filter(b => b.builtin).map(b => b.type);

export function blockSpec(type) {
  return BLOCK_TYPES.find(b => b.type === type) || null;
}

/** Plot heights in px at the report's 720 px plot width. */
export const PLOT_SIZES = { none: 0, s: 200, m: 300, l: 400 };

const pick = (values, keys) => Object.fromEntries(keys.map(key => [key, values[key]]));

// The spectrum block starts from the Optical Evaluation window's shipped
// settings, read from the analysis registry so the two never disagree; the
// curve map is the one that window opens with.
const OPTICAL_EVALUATION_KEYS = ['lambdaStart', 'lambdaEnd', 'lambdaStep', 'thetas', 'spectralUnit', 'yScale', 'yAuto', 'yMin', 'yMax'];
const ALL_CURVES_OFF = { T: false, R: false, A: false, Ts: false, Rs: false, Tp: false, Rp: false };

// The settings a block of each type starts from. Everything a section builder
// reads appears here, so a block saved by an older release still carries every
// key after `withDefaults`. Types with no settings have no entry.
const SETTINGS_DEFAULTS = {
  facts:        () => ({ stackDiagram: true }),
  layers:       () => ({ columns: 'auto', extended: false, groupPeriods: false }),
  materials:    () => ({ table: false }),
  notes:        () => ({ text: '' }),
  spectrum:     () => ({
    ...pick(sessionDefaults('opticalEvaluation'), OPTICAL_EVALUATION_KEYS),
    curves: { ...ALL_CURVES_OFF, T: true, R: true }, plot: 'm', tableStep: 10,
  }),
  color:        () => ({
    characteristic: 'R', pol: 'avg', theta: 0, observer: '2', illuminant: 'D65', step: 5,
  }),
  integrals:    () => ({ theta: 0, polarization: 'avg' }),
  gdGdd:        () => ({
    lambdaStart: 400, lambdaEnd: 800, lambdaStep: 1, theta: 0, target: 'R', pol: 'avg', side: 'front',
    quantities: { phase: false, gd: true, gdd: true, tod: false }, plot: 'm', tableStep: 0,
  }),
  ellipsometry: () => ({
    lambdaStart: 400, lambdaEnd: 800, lambdaStep: 5, thetas: [65],
    showPsi: true, showDelta: true, plot: 'm', tableStep: 0,
  }),
  efield:       () => ({ lambda: null, theta: 0, pol: 's', plot: 'm' }),
  riProfile:    () => ({ lambda: null, plot: 'm' }),
  monteCarlo:   () => ({ plot: 'm', tableStep: 10, envelope: false }),
};

export function defaultSettings(type) {
  const make = SETTINGS_DEFAULTS[type];
  return make ? make() : {};
}

/** `settings` completed with the defaults for `type`. */
export function withDefaults(type, settings) {
  return { ...defaultSettings(type), ...(settings || {}) };
}

let nextId = 1;
/** A block of `type`, switched on, with `settings` over the type's defaults. */
export function newBlock(type, settings, on = true) {
  return { id: `b${nextId++}`, type, on, settings: withDefaults(type, settings) };
}

// ── Templates ────────────────────────────────────────────────────────────────

const T = (type, on = true, settings = {}) => ({ type, on, settings });

/**
 * The templates that ship. Each answers who reads the report: the Design
 * record is the complete internal document, the Customer report leaves the
 * recipe out, the Comparison puts candidates side by side.
 */
export const BUILTIN_TEMPLATES = {
  'design-record': {
    ver: 2, name: 'design-record', builtin: true, paper: 'A4',
    blocks: [
      T('title'), T('facts'), T('layers'), T('materials'),
      T('spectrum'), T('qualifiers'), T('integrals', false), T('color', false),
      T('merit', false), T('notes'),
    ],
  },
  'customer': {
    ver: 2, name: 'customer', builtin: true, paper: 'A4',
    blocks: [
      T('title'), T('facts', true, { stackDiagram: false }), T('layers', false),
      T('materials', false), T('qualifiers'), T('spectrum', true, { tableStep: 20 }),
      T('integrals'), T('color'), T('notes', false), T('signatures'),
    ],
  },
  'comparison': {
    ver: 2, name: 'comparison', builtin: true, paper: 'A4',
    blocks: [
      T('title'), T('facts'), T('spectrum'), T('layers'), T('materials', false),
      T('qualifiers'), T('integrals'), T('notes', false),
    ],
  },
};

export const DEFAULT_TEMPLATE_ID = 'design-record';

/**
 * Blocks for a template, with fresh ids and every built-in type present: a
 * template that leaves one out gets it switched off, so the rail always shows
 * the same five and a template can only hide them.
 */
export function blocksFromTemplate(template) {
  const blocks = (template?.blocks || []).map(b => newBlock(b.type, b.settings, b.on !== false));
  for (const type of BUILTIN_TYPES) {
    if (!blocks.some(b => b.type === type)) blocks.push(newBlock(type, {}, false));
  }
  return blocks;
}

/** A template payload from the window's current block list. */
export function templateFromBlocks(name, blocks, { paper = 'A4', lang } = {}) {
  return {
    ver: 2, name: String(name || '').trim(), paper, lang,
    blocks: blocks.map(b => ({ type: b.type, on: !!b.on, settings: { ...b.settings } })),
  };
}

// ── Legacy presets ───────────────────────────────────────────────────────────

const LEGACY_SECTION_TYPES = {
  'cover': 'title', 'optical-eval': 'spectrum', 'color-eval': 'color',
  'ri-profile': 'riProfile', 'efield': 'efield', 'ellipsometry': 'ellipsometry',
  'integral-values': 'integrals', 'qualifiers': 'qualifiers',
  'merit-function': 'merit', 'notes': 'notes',
};

function legacySpectrum(o) {
  const curves = { ...ALL_CURVES_OFF };
  for (const key of (o.curves && o.curves.length ? o.curves : ['T', 'R'])) curves[key] = true;
  return {
    lambdaStart: o.lambdaStart, lambdaEnd: o.lambdaEnd, lambdaStep: o.lambdaStep,
    thetas: o.thetas && o.thetas.length ? [...o.thetas] : undefined,
    curves, tableStep: o.includeTable ? 10 : 0,
  };
}

function legacyEllipsometry(o) {
  const which = o.quantity || 'both';
  return {
    lambdaStart: o.lambdaStart, lambdaEnd: o.lambdaEnd, lambdaStep: o.lambdaStep,
    thetas: o.thetas && o.thetas.length ? [...o.thetas] : undefined,
    showPsi: which !== 'delta', showDelta: which !== 'psi',
  };
}

// Per-section options of a v1 preset, as block settings. Keys left undefined
// fall back to the block defaults.
const LEGACY_SETTINGS = {
  spectrum: legacySpectrum,
  ellipsometry: legacyEllipsometry,
  color: o => ({ characteristic: o.characteristic, observer: o.observer, illuminant: o.illuminant, step: o.step }),
  integrals: o => ({ theta: o.aoi, polarization: o.pol }),
  efield: o => ({ pol: o.pol, lambda: o.lambda ?? null }),
  riProfile: o => ({ lambda: o.lambda ?? null }),
  notes: o => ({ text: o.text }),
};

function defined(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

// The blocks one v1 section becomes. The design summary section split into
// three blocks, carrying its two options over.
function legacyBlocks(section, per) {
  const on = section.on !== false;
  const o = per[section.id] || {};
  if (section.id === 'design-summary') {
    return [T('facts', on), T('layers', on, { extended: !!o.optical }), T('materials', on, { table: !!o.materialsTable })];
  }
  const type = LEGACY_SECTION_TYPES[section.id];
  if (!type) return [];
  const make = LEGACY_SETTINGS[type];
  return [T(type, on, make ? defined(make(o)) : {})];
}

// The cover fields of a v1 preset with a place in the document. The project
// and subtitle have none, and the output format is now chosen at export.
const LEGACY_COVER_FIELDS = ['title', 'customer', 'designer', 'date'];

/**
 * A `ver: 1` preset written by the earlier wizard, as a `ver: 2` template.
 * Its cover fields come along as `doc`, applied to the document fields when
 * the template is chosen.
 */
export function convertLegacyPreset(preset) {
  const per = preset.perSection || {};
  const blocks = (preset.sections || []).flatMap(section => legacyBlocks(section, per));
  const cover = preset.cover || {};
  const doc = Object.fromEntries(LEGACY_COVER_FIELDS.filter(key => cover[key]).map(key => [key, String(cover[key])]));
  const template = { ver: 2, name: preset.name || '', paper: 'A4', lang: preset.lang, blocks };
  return Object.keys(doc).length ? { ...template, doc } : template;
}

/** Any stored template payload, as a `ver: 2` template. */
export function normalizeTemplate(payload) {
  if (!payload) return null;
  if (payload.ver === 2 && Array.isArray(payload.blocks)) return payload;
  if (Array.isArray(payload.sections)) return convertLegacyPreset(payload);
  return null;
}
