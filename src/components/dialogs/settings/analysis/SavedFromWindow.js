// What the user saved from an analysis window's own settings panel.
//
// These are the window's controls — ranges, angles, modes — so they are edited
// where they live and only listed here, next to the display fields, so one
// screen shows everything a window starts from. "Reset this window" above
// clears both.
const { createElement: h } = React;

const rowStyle = {
  display: 'flex', alignItems: 'baseline', gap: '12px', padding: '4px 0',
};

// Curve maps, parameter blocks and sweep specifications are saved whole. They
// are shown as they are stored rather than picked apart: the panel that owns
// them is the place to read them field by field.
function displayValue(value) {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export const SavedFromWindow = ({ values, c, t }) => {
  const entries = Object.entries(values || {});
  if (entries.length === 0) return null;

  return h('div', null,
    h('div', {
      style: {
        fontSize: '11px', fontWeight: '600', color: c.textDim,
        textTransform: 'uppercase', letterSpacing: '0.5px',
        marginTop: '14px', marginBottom: '2px',
      },
    }, t.settings.analysis.savedFromWindow),
    h('div', { style: { fontSize: '11px', color: c.textDim, marginBottom: '6px', lineHeight: 1.4 } },
      t.settings.analysis.savedFromWindowHint),
    entries.map(([key, value]) => h('div', { key, style: rowStyle },
      h('span', { style: { flex: 1, fontSize: '13px', color: c.text } },
        t.settings.analysis.savedFields[key] || t.settings.analysis.fields[key] || key),
      h('code', {
        style: {
          fontSize: '11px', color: c.textDim, maxWidth: '55%',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
      }, displayValue(value)))),
  );
};
