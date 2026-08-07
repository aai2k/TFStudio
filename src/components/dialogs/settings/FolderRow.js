// One configurable data folder: label, resolved path, and the actions that
// change it. `entry` is a row from the paths:list IPC result.
import { buttonStyle } from './ui.js';

const { createElement: h } = React;

const pathStyle = (c) => ({
  fontSize: '12px', color: c.text, fontFamily: 'monospace',
  wordBreak: 'break-all', marginTop: '2px',
});

export const FolderRow = ({ entry, onBrowse, onReset, onOpen, c, t }) =>
  h('div', {
    style: {
      display: 'flex', alignItems: 'flex-start', gap: '12px',
      padding: '10px 0', borderBottom: `1px solid ${c.border}`,
    },
  },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: '13px', fontWeight: '600', color: c.text } },
        t.settings.folders[entry.key]),
      h('div', { style: pathStyle(c) }, entry.path),
      !entry.overridden && h('div', { style: { fontSize: '11px', color: c.textDim, marginTop: '2px' } },
        t.settings.folders.defaultLabel),
      entry.rejected && h('div', { style: { fontSize: '11px', color: c.error, marginTop: '4px' } },
        t.settings.folders.rejected(entry.rejected.configured))
    ),
    h('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
      h('button', { onClick: () => onBrowse(entry.key), style: buttonStyle(c) },
        t.settings.folders.browse),
      h('button', {
        onClick: () => onReset(entry.key),
        disabled: !entry.overridden,
        style: { ...buttonStyle(c), opacity: entry.overridden ? 1 : 0.45, cursor: entry.overridden ? 'pointer' : 'default' },
      }, t.settings.folders.reset),
      h('button', { onClick: () => onOpen(entry.key), style: buttonStyle(c) },
        t.settings.folders.open)
    )
  );
