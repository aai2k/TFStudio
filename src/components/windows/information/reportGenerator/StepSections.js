import { Check, smallBtn } from './ui.js';

const { createElement: h } = React;

export function StepSections({ g, c, W }) {
  const { sections, toggleSection, moveSection, sectionTitleOf } = g;

  return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
    h('div', { style: { fontSize: 12, color: c.textDim, marginBottom: 6 } }, W.sectionsHint || 'Pick sections and order them (▲/▼).'),
    h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 360, overflowY: 'auto' } },
      sections.map((s, idx) => h('div', { key: s.id,
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px',
          border: `1px solid ${c.border}`, borderRadius: 4, background: c.bg } },
        h(Check, { c, checked: s.on, onChange: () => toggleSection(s.id), label: sectionTitleOf(s.id) }),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 4 } },
          h('button', { onClick: () => moveSection(idx, -1), disabled: idx === 0,
            style: { ...smallBtn(c, false), opacity: idx === 0 ? 0.4 : 1 } }, '▲'),
          h('button', { onClick: () => moveSection(idx, 1), disabled: idx === sections.length - 1,
            style: { ...smallBtn(c, false), opacity: idx === sections.length - 1 ? 0.4 : 1 } }, '▼'))))));
}
