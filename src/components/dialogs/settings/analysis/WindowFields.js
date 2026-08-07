// The field list for one analysis window, built from its registry entry.
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { ColorRow, NumberRow, EnumRow, BooleanRow } from './FieldRows.js';
import { SpectralRangeRows } from './SpectralRangeRows.js';

const { createElement: h } = React;

// Numbered palette slots (`series3`, `mat7`) are labelled by position; every
// other colour has a name in the locale table.
const PALETTE_KEY = /^(?:series|mat)(\d+)$/;

function paletteSlot(key) {
  const match = PALETTE_KEY.exec(key);
  return match ? Number(match[1]) : null;
}

// Field labels come from t.settings.analysis.fields when present; otherwise the
// registry key is shown as-is. Curve keys (T, R, A, Ts, gd, psi…) are symbols
// and deliberately untranslated.
function fieldLabel(t, key) {
  const slot = paletteSlot(key);
  if (slot !== null) return t.settings.analysis.paletteSlot(slot);
  return t.settings.analysis.fields[key] || key;
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

  // The shared spectral range needs unit-aware fields rather than plain
  // numbers, because its values are stored in nm but shown in the chosen unit.
  if (windowId === 'shared') {
    return h('div', null,
      h('div', { style: groupTitleStyle(c) }, t.settings.analysis.ranges),
      h(SpectralRangeRows, { resolved, onChange, c, t }));
  }

  const colorKeys = Object.keys(registry.colors || {});
  const numbers = Object.entries(registry.numbers || {});
  const enums = Object.entries(registry.enums || {});
  const booleans = Object.keys(registry.booleans || {});

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
    numbers.length > 0 && h('div', null,
      h('div', { style: groupTitleStyle(c) }, t.settings.analysis.ranges),
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
