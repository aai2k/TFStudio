// The field list for one analysis window, built from its registry entry.
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { ColorRow, NumberRow, EnumRow, BooleanRow, ListRow } from './FieldRows.js';
import { SpectralRangeRows } from './SpectralRangeRows.js';

const { createElement: h } = React;

// Numbered palette slots (`series3`, `mat7`) are labelled by position; every
// other colour has a name in the locale table.
const PALETTE_KEY = /^(?:series|mat)(\d+)$/;

function paletteSlot(key) {
  const match = PALETTE_KEY.exec(key);
  return match ? Number(match[1]) : null;
}

// Field labels come from the locale: `savedFields` names the window controls,
// `fields` the colours and the spectral rows. Curve keys (T, R, A, Ts, gd, psi…)
// are symbols and deliberately untranslated, so they fall through as-is.
function fieldLabel(t, key) {
  const slot = paletteSlot(key);
  if (slot !== null) return t.settings.analysis.paletteSlot(slot);
  return t.settings.analysis.savedFields[key] || t.settings.analysis.fields[key] || key;
}

const groupTitleStyle = (c) => ({
  fontSize: '11px', fontWeight: '600', color: c.textDim,
  textTransform: 'uppercase', letterSpacing: '0.5px',
  marginTop: '14px', marginBottom: '2px',
});

const groupHintStyle = (c) => ({
  fontSize: '11px', color: c.textDim, marginBottom: '6px', lineHeight: 1.4,
});

const ColorGroup = ({ title, hint, keys, resolved, onChange, c, t }) =>
  keys.length === 0 ? null : h('div', null,
    h('div', { style: groupTitleStyle(c) }, title),
    hint && h('div', { style: groupHintStyle(c) }, hint),
    keys.map(key => h(ColorRow, {
      key,
      c,
      label: fieldLabel(t, key),
      value: resolved.colors[key],
      onChange: (value) => onChange('colors', key, value),
    }))
  );

export const WindowFields = ({ windowId, resolved, onChange, c, t }) => {
  const registry = ANALYSIS_DEFAULTS[windowId];
  if (!registry) return null;

  // A window that lets the range be entered in another unit needs unit-aware
  // fields rather than plain numbers, because the values are stored in nm but
  // shown in the chosen unit. Those three are then left out of the plain rows.
  const unitAware = !!registry.enums?.spectralUnit;
  const SPECTRAL = ['lambdaStart', 'lambdaEnd', 'lambdaStep', 'spectralUnit'];
  const plain = ([key]) => !unitAware || !SPECTRAL.includes(key);

  const colorKeys = Object.keys(registry.colors || {});
  const numbers = Object.entries(registry.numbers || {}).filter(plain);
  const enums = Object.entries(registry.enums || {}).filter(plain);
  const lists = Object.entries(registry.lists || {});
  const booleans = Object.keys(registry.booleans || {});
  const hasControls =
    unitAware || numbers.length + enums.length + lists.length + booleans.length > 0;

  return h('div', null,
    h(ColorGroup, {
      title: t.settings.analysis.curveColors,
      keys: colorKeys.filter(key => paletteSlot(key) === null),
      resolved, onChange, c, t,
    }),
    h(ColorGroup, {
      title: t.settings.analysis.palette,
      hint: t.settings.analysis.paletteHint,
      keys: colorKeys.filter(key => paletteSlot(key) !== null),
      resolved, onChange, c, t,
    }),
    hasControls && h('div', null,
      h('div', { style: groupTitleStyle(c) }, t.settings.analysis.windowControls),
      h('div', { style: groupHintStyle(c) }, t.settings.analysis.windowControlsHint),
      unitAware && h(SpectralRangeRows, { registry, resolved, onChange, c, t }),
      numbers.map(([key, spec]) => h(NumberRow, {
        key,
        c,
        label: fieldLabel(t, key),
        value: resolved.numbers[key],
        spec,
        onChange: (value) => onChange('numbers', key, value),
      })),
      enums.map(([key, spec]) => h(EnumRow, {
        key,
        c,
        label: fieldLabel(t, key),
        value: resolved.enums[key],
        spec,
        onChange: (value) => onChange('enums', key, value),
      })),
      lists.map(([key, spec]) => h(ListRow, {
        key,
        c,
        label: fieldLabel(t, key),
        value: resolved.lists[key],
        spec,
        onChange: (value) => onChange('lists', key, value),
      })),
      booleans.map(key => h(BooleanRow, {
        key,
        c,
        label: fieldLabel(t, key),
        value: resolved.booleans[key],
        onChange: (value) => onChange('booleans', key, value),
      }))
    )
  );
};
