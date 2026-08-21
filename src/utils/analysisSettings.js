/**
 * Resolve the analysis-window display settings a window should start with.
 *
 * Stored overrides are merged over the factory registry in
 * constants/analysisDefaults.js. Anything the registry does not declare is
 * dropped: a settings file written by a newer version, or hand-edited, must not
 * be able to push an unknown key or a malformed value into a plot.
 */
import { ANALYSIS_DEFAULTS } from '../constants/analysisDefaults.js';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function resolveColors(defaults, stored) {
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    const value = stored?.[key];
    out[key] = typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : def;
  }
  return out;
}

// Out-of-range and non-finite values fall back to the factory default rather
// than being clamped: a stored 0 nm step would otherwise silently become the
// minimum and hang the caller in a long loop.
function resolveNumbers(defaults, stored) {
  const out = {};
  for (const [key, spec] of Object.entries(defaults)) {
    const value = stored?.[key];
    const usable = typeof value === 'number' && Number.isFinite(value)
      && value >= spec.min && value <= spec.max;
    out[key] = usable ? value : spec.def;
  }
  return out;
}

function resolveEnums(defaults, stored) {
  const out = {};
  for (const [key, spec] of Object.entries(defaults)) {
    const value = stored?.[key];
    out[key] = spec.options.includes(value) ? value : spec.def;
  }
  return out;
}

function resolveBooleans(defaults, stored) {
  const out = {};
  for (const [key, def] of Object.entries(defaults)) {
    const value = stored?.[key];
    out[key] = typeof value === 'boolean' ? value : def;
  }
  return out;
}

// A list is kept only when every entry is a usable number: one bad value makes
// the whole list suspect, and a partly applied angle set would be worse than
// the shipped one.
function resolveLists(defaults, stored) {
  const out = {};
  for (const [key, spec] of Object.entries(defaults)) {
    const value = stored?.[key];
    const usable = Array.isArray(value) && value.length > 0
      && value.length <= spec.maxLength
      && value.every(entry => typeof entry === 'number' && Number.isFinite(entry)
        && entry >= spec.min && entry <= spec.max);
    out[key] = usable ? [...value] : [...spec.def];
  }
  return out;
}

/**
 * Resolved settings for one window.
 *
 * @param {string} windowId  key into the registry
 * @param {object} [stored]  the `analysis` block from the preferences file
 * @returns {{colors, numbers, enums, booleans, lists}}
 *          Empty sections for a window the registry does not declare.
 */
export function resolveAnalysisSettings(windowId, stored) {
  const registry = ANALYSIS_DEFAULTS[windowId];
  if (!registry) return { colors: {}, numbers: {}, enums: {}, booleans: {}, lists: {} };
  const overrides = stored?.[windowId] || {};
  return {
    colors:   resolveColors(registry.colors     || {}, overrides.colors),
    numbers:  resolveNumbers(registry.numbers   || {}, overrides.numbers),
    enums:    resolveEnums(registry.enums       || {}, overrides.enums),
    booleans: resolveBooleans(registry.booleans || {}, overrides.booleans),
    lists:    resolveLists(registry.lists       || {}, overrides.lists),
  };
}

/**
 * The values one window starts from: everything the registry declares for it,
 * flattened out of its sections with the overrides already applied.
 *
 * A session store is rebased onto this, so what Settings shows and what the
 * window opens with are one set of values read two ways.
 */
export function resolvedWindowValues(windowId, stored) {
  const resolved = resolveAnalysisSettings(windowId, stored);
  return {
    ...resolved.numbers, ...resolved.enums, ...resolved.booleans, ...resolved.lists,
  };
}

/** Just the curve colours, the common case for a figure module. */
export function resolveAnalysisColors(windowId, stored) {
  return resolveAnalysisSettings(windowId, stored).colors;
}

// A colour or a boolean is its own factory value; a number, an enum or a list
// carries one under `def`.
function factoryValue(section, spec) {
  return section === 'colors' || section === 'booleans' ? spec : spec.def;
}

function sameAsFactory(section, spec, value) {
  const factory = factoryValue(section, spec);
  if (section !== 'lists') return value === factory;
  return Array.isArray(value) && value.length === factory.length
    && value.every((entry, index) => entry === factory[index]);
}

/**
 * Keep only valid, non-default overrides declared by the current registry.
 * This also migrates settings written by older releases when a curve or field
 * is removed, so obsolete entries do not leave a false "modified" marker.
 */
export function sanitizeAnalysisOverrides(stored) {
  const clean = {};
  for (const [windowId, registry] of Object.entries(ANALYSIS_DEFAULTS)) {
    if (!stored?.[windowId]) continue;
    const resolved = resolveAnalysisSettings(windowId, stored);
    const windowOverrides = {};

    for (const section of ['colors', 'numbers', 'enums', 'booleans', 'lists']) {
      const declared = registry[section] || {};
      const bucket = {};
      for (const [key, spec] of Object.entries(declared)) {
        const value = resolved[section][key];
        if (!sameAsFactory(section, spec, value)) bucket[key] = value;
      }
      if (Object.keys(bucket).length > 0) windowOverrides[section] = bucket;
    }

    if (Object.keys(windowOverrides).length > 0) clean[windowId] = windowOverrides;
  }
  return clean;
}

/**
 * Store one field, dropping it from the override block when it matches the
 * factory default so an untouched setting leaves nothing behind and keeps
 * following the shipped value if that changes in a later release.
 */
export function setAnalysisOverride(stored, windowId, section, key, value) {
  const registry = ANALYSIS_DEFAULTS[windowId];
  const clean = sanitizeAnalysisOverrides(stored);
  if (!registry?.[section] || !(key in registry[section])) return clean;

  const spec = registry[section][key];

  const next = { ...clean };
  const win = { ...(next[windowId] || {}) };
  const bucket = { ...(win[section] || {}) };

  if (sameAsFactory(section, spec, value)) delete bucket[key];
  else bucket[key] = value;

  if (Object.keys(bucket).length > 0) win[section] = bucket;
  else delete win[section];

  if (Object.keys(win).length > 0) next[windowId] = win;
  else delete next[windowId];

  return next;
}

/** Drop every override for one window, restoring its factory defaults. */
export function resetAnalysisWindow(stored, windowId) {
  const next = sanitizeAnalysisOverrides(stored);
  delete next[windowId];
  return next;
}

/** True when the window has at least one stored override. */
export function isAnalysisWindowOverridden(stored, windowId) {
  return Object.keys(sanitizeAnalysisOverrides(stored)[windowId] || {}).length > 0;
}
