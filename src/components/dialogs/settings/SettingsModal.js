// Preferences dialog: a category rail on the left, the selected pane on the right.
//
// Synthesis settings (inner engine / candidate search / thick-seed handling)
// live INSIDE the Needle + Gradual-Evolution windows (Advanced section): they
// belong with the synthesis tool, not the global preferences.
import { AppearancePane } from './AppearancePane.js';
import { LanguagePane } from './LanguagePane.js';
import { PerformancePane } from './PerformancePane.js';
import { QuickAccessPane } from './QuickAccessPane.js';
import { FoldersPane } from './FoldersPane.js';
import { AnalysisPane } from './analysis/AnalysisPane.js';

const { createElement: h, useState } = React;

const CATEGORIES = [
  { id: 'appearance',  Pane: AppearancePane },
  { id: 'quickAccess', Pane: QuickAccessPane },
  { id: 'language',    Pane: LanguagePane },
  { id: 'performance', Pane: PerformancePane },
  { id: 'analysis',    Pane: AnalysisPane },
  { id: 'folders',     Pane: FoldersPane },
];

const railButtonStyle = (c, active) => ({
  display: 'block', width: '100%', textAlign: 'left',
  padding: '6px 10px', marginBottom: '1px',
  backgroundColor: active ? c.accent : 'transparent',
  color: active ? c.accentText : c.text,
  border: 'none', borderRadius: '4px', cursor: 'pointer',
  fontSize: '12.5px', fontWeight: active ? '600' : '400',
});

export const SettingsModal = (props) => {
  const { onClose, c, t } = props;
  const [category, setCategory] = useState('appearance');
  const active = CATEGORIES.find(entry => entry.id === category) || CATEGORIES[0];

  // No click-outside-to-close: a stray click on the backdrop while reading a
  // hint should not throw away the dialog.
  return h('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
  },
    h('div', {
      style: {
        // Fixed footprint: the dialog must not resize as the user moves between
        // a short pane (Language) and a tall one (Analysis). The pane scrolls
        // inside instead. Height is capped against the viewport so the dialog
        // still fits on a small screen.
        backgroundColor: c.panel, borderRadius: '7px',
        width: '700px', maxWidth: '92vw',
        height: '480px', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)', border: `1px solid ${c.border}`,
      },
    },
      h('div', {
        style: {
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '11px 14px', borderBottom: `1px solid ${c.border}`, flexShrink: 0,
        },
      },
        h('span', { style: { fontSize: '14px', fontWeight: '600', color: c.text } }, t.settings.title),
        h('button', {
          onClick: onClose,
          title: t.settings.close,
          style: {
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '24px', height: '24px', padding: 0,
            background: 'transparent', border: 'none', borderRadius: '4px',
            color: c.textDim, cursor: 'pointer',
          },
          onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
          onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; },
        },
          h('svg', { width: 11, height: 11, viewBox: '0 0 11 11', fill: 'none' },
            h('path', { d: 'M1 1l9 9M10 1L1 10', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }))
        )
      ),

      h('div', { style: { display: 'flex', flex: 1, minHeight: 0 } },
        h('nav', {
          style: {
            width: '150px', flexShrink: 0, borderRight: `1px solid ${c.border}`,
            padding: '8px', overflowY: 'auto',
          },
        },
          CATEGORIES.map(entry => h('button', {
            key: entry.id,
            onClick: () => setCategory(entry.id),
            style: railButtonStyle(c, entry.id === category),
          }, t.settings.categories[entry.id]))
        ),
        h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto', padding: '4px 16px 16px' } },
          h(active.Pane, props))
      )
    )
  );
};
