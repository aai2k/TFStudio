import { Check, TextField, smallBtn } from './ui.js';

const { createElement: h } = React;

export function StepScope({ g, c, R, W }) {
  const { scope, setScope, designs, activeDesignId, designList, selectedIds, setSelectedIds,
          cover, setCoverField, loadLogo } = g;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14 } },
    h('div', { style: { display: 'flex', gap: 16 } },
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
        h('input', { type: 'radio', checked: scope === 'current', onChange: () => setScope('current'), style: { accentColor: c.accent } }),
        W.scopeCurrent || 'Current design'),
      h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text } },
        h('input', { type: 'radio', checked: scope === 'selected', onChange: () => setScope('selected'), style: { accentColor: c.accent } }),
        W.scopeSelected || 'Selected designs (comparison)')),
    scope === 'current'
      ? h('div', { style: { color: c.textDim, fontSize: 13 } },
          (W.currentIs || 'Report will cover') + ': ',
          h('strong', { style: { color: c.text } }, designs[activeDesignId]?.name || designList[0]?.name || '—'))
      : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto',
            border: `1px solid ${c.border}`, borderRadius: 4, padding: 10 } },
          designList.length === 0 && h('div', { style: { color: c.textDim } }, W.noDesigns || 'No designs available.'),
          designList.map(d => h(Check, { key: d.id, c,
            checked: selectedIds.has(d.id),
            onChange: (on) => setSelectedIds(prev => { const n = new Set(prev); on ? n.add(d.id) : n.delete(d.id); return n; }),
            label: d.name }))),
    // Cover fields (shared across scopes)
    h('div', { style: { borderTop: `1px solid ${c.border}`, paddingTop: 12, marginTop: 4 } },
      h('div', { style: { fontSize: 12, color: c.textDim, marginBottom: 8 } }, W.coverFields || 'Cover page'),
      h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap' } },
        h(TextField, { c, label: W.title || 'Title', value: cover.title, onChange: v => setCoverField('title', v), placeholder: R.defaultTitle || 'Optical Coating Report' }),
        h(TextField, { c, label: W.customer || 'Customer', value: cover.customer, onChange: v => setCoverField('customer', v) })),
      h('div', { style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 } },
        h(TextField, { c, label: W.project || 'Project', value: cover.project, onChange: v => setCoverField('project', v) }),
        h(TextField, { c, label: W.designer || 'Designer', value: cover.designer, onChange: v => setCoverField('designer', v) }),
        h(TextField, { c, label: W.date || 'Date', value: cover.date, onChange: v => setCoverField('date', v), width: 130 })),
      h('div', { style: { display: 'flex', gap: 12, alignItems: 'center', marginTop: 10 } },
        h('button', { onClick: loadLogo, style: smallBtn(c, false) }, W.loadLogo || 'Load logo…'),
        cover.logoDataUrl && h('img', { src: cover.logoDataUrl, alt: '', style: { height: 32, border: `1px solid ${c.border}`, borderRadius: 3 } }),
        cover.logoDataUrl && h('button', { onClick: () => setCoverField('logoDataUrl', null), style: smallBtn(c, false) }, W.clearLogo || 'Clear'))));
}
