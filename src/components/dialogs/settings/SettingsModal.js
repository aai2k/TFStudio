// Settings dialog: a category rail on the left, the selected pane on the right.
//
// Synthesis settings (inner engine / candidate search / thick-seed handling)
// live INSIDE the Needle + Gradual-Evolution windows (Advanced section) — they
// belong with the synthesis tool, not the global app settings.
import { AppearancePane } from './AppearancePane.js';
import { LanguagePane } from './LanguagePane.js';
import { PerformancePane } from './PerformancePane.js';
import { FoldersPane } from './FoldersPane.js';

const { createElement: h, useState } = React;

const CATEGORIES = [
  { id: 'appearance',  Pane: AppearancePane },
  { id: 'language',    Pane: LanguagePane },
  { id: 'performance', Pane: PerformancePane },
  { id: 'folders',     Pane: FoldersPane },
];

const railButtonStyle = (c, active) => ({
  display: 'block', width: '100%', textAlign: 'left',
  padding: '9px 12px', marginBottom: '2px',
  backgroundColor: active ? c.accent : 'transparent',
  color: active ? c.accentText : c.text,
  border: 'none', borderRadius: '6px', cursor: 'pointer',
  fontSize: '13px', fontWeight: active ? '600' : '500',
});

export const SettingsModal = (props) => {
  const { onClose, c, t } = props;
  const [category, setCategory] = useState('appearance');
  const active = CATEGORIES.find(entry => entry.id === category) || CATEGORIES[0];

  return h('div', {
    style: {
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    },
  },
    h('div', {
      style: {
        backgroundColor: c.panel, borderRadius: '8px', padding: '24px',
        width: '760px', maxWidth: '92vw', maxHeight: '85vh',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 10px 40px rgba(0, 0, 0, 0.3)', border: `1px solid ${c.border}`,
      },
    },
      h('h2', { style: { marginTop: 0, marginBottom: '20px', fontSize: '18px', fontWeight: 'bold', color: c.text } },
        t.settings.title),
      h('div', { style: { display: 'flex', gap: '20px', flex: 1, minHeight: 0 } },
        h('nav', {
          style: {
            width: '170px', flexShrink: 0, borderRight: `1px solid ${c.border}`, paddingRight: '12px',
          },
        },
          CATEGORIES.map(entry => h('button', {
            key: entry.id,
            onClick: () => setCategory(entry.id),
            style: railButtonStyle(c, entry.id === category),
          }, t.settings.categories[entry.id]))
        ),
        h('div', { style: { flex: 1, minWidth: 0, overflow: 'auto' } },
          h(active.Pane, props))
      ),
      h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '20px' } },
        h('button', {
          onClick: onClose,
          style: {
            padding: '10px 24px', backgroundColor: c.accent, color: c.accentText,
            border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '600',
          },
        }, t.settings.close)
      )
    )
  );
};
