// Read-only subdirectory list: shows the 9 subdirectories under the Data folder.
// Data source: paths:list's folders.subfolders (count not hardcoded).
// Each row: status dot + key name + Open button (reveals the subdirectory path).
import { buttonStyle } from './ui.js';

const { createElement: h } = React;

const listItemStyle = (c, exists) => ({
  display: 'flex', alignItems: 'center', gap: '8px',
  padding: '4px 8px', fontSize: '12px',
  fontFamily: 'monospace',
  color: exists ? c.text : c.textDim,
  opacity: exists ? 1 : 0.6,
});

const dotStyle = (c, exists) => ({
  width: '6px', height: '6px', borderRadius: '50%',
  backgroundColor: exists ? c.success || '#4caf50' : c.textDim || '#888',
  flexShrink: 0,
});

export const SubfolderList = ({ subfolders, onOpen, moving, c, t }) =>
  h('div', {
    style: {
      marginTop: '4px', marginBottom: '12px',
      border: `1px solid ${c.border}`, borderRadius: '6px',
      padding: '6px 0', backgroundColor: c.panel + '33',
    },
  },
    h('div', {
      style: {
        fontSize: '11px', fontWeight: 600, color: c.textDim,
        padding: '0 8px 4px', textTransform: 'uppercase', letterSpacing: '0.5px',
      },
    }, t.settings.folders.subfolders),
    ...subfolders.map(sf =>
      h('div', { key: sf.key, style: { ...listItemStyle(c, sf.exists), justifyContent: 'space-between' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 } },
          h('span', { style: dotStyle(c, sf.exists) }),
          h('span', { style: { flex: 1, minWidth: 0 } }, t.settings.folders[sf.key]),
          !sf.exists && h('span', {
            style: { fontSize: '10px', color: c.textDim, marginLeft: '4px', flexShrink: 0 },
          }, `(${t.settings.folders.notCreated})`)
        ),
        onOpen && h('button', {
          onClick: () => onOpen(sf.key),
          disabled: moving,
          style: {
            ...buttonStyle(c), fontSize: '10px', padding: '2px 6px',
            opacity: moving ? 0.45 : 1, cursor: moving ? 'default' : 'pointer',
          },
        }, t.settings.folders.open)
      )
    )
  );
