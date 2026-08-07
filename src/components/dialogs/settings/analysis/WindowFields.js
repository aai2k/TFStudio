// The field list for one analysis window, built from its registry entry.
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { ColorRow, NumberRow, EnumRow, BooleanRow } from './FieldRows.js';

const { createElement: h } = React;

// Field labels come from t.settings.analysis.fields when present; otherwise the
// registry key is shown as-is. Curve keys (T, R, A, Ts, gd, psi…) are symbols
// and deliberately untranslated.
function fieldLabel(t, key) {
  return t.settings.analysis.fields[key] || key;
}

const groupTitleStyle = (c) => ({
  fontSize: '11px', fontWeight: '600', color: c.textDim,
  textTransform: 'uppercase', letterSpacing: '0.5px',
  marginTop: '14px', marginBottom: '2px',
});

export const WindowFields = ({ windowId, resolved, onChange, c, t }) => {
  const registry = ANALYSIS_DEFAULTS[windowId];
  if (!registry) return null;

  const colors = Object.keys(registry.colors || {});
  const numbers = Object.entries(registry.numbers || {});
  const enums = Object.entries(registry.enums || {});
  const booleans = Object.keys(registry.booleans || {});

  return h('div', null,
    colors.length > 0 && h('div', null,
      h('div', { style: groupTitleStyle(c) }, t.settings.analysis.curveColors),
      colors.map(key => h(ColorRow, {
        key,
        c,
        label: fieldLabel(t, key),
        value: resolved.colors[key],
        onChange: (value) => onChange('colors', key, value),
      }))
    ),
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
