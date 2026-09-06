// Root path 行：路径 + Browse / Reset / Open 按钮（Phase E 单一 Data Folder）。
// `entry` 来自 paths:list 返回的 folders 对象。
// `moving` 为 true 时所有按钮 disabled（Moving… busy state）。
import { buttonStyle } from './ui.js';

const { createElement: h } = React;

const pathStyle = (c) => ({
  fontSize: '12px', color: c.text, fontFamily: 'monospace',
  wordBreak: 'break-all', marginTop: '2px',
});

export const FolderRow = ({ entry, label, onBrowse, onReset, onOpen, moving, c, t }) =>
  h('div', {
    style: {
      display: 'flex', alignItems: 'flex-start', gap: '12px',
      padding: '10px 0', borderBottom: `1px solid ${c.border}`,
    },
  },
    h('div', { style: { flex: 1, minWidth: 0 } },
      h('div', { style: { fontSize: '13px', fontWeight: '600', color: c.text } },
        label || t.settings.folders[entry.key] || entry.key),
      h('div', { style: pathStyle(c) }, entry.path),
      !entry.overridden && h('div', { style: { fontSize: '11px', color: c.textDim, marginTop: '2px' } },
        t.settings.folders.defaultLabel),
    ),
    h('div', { style: { display: 'flex', gap: '6px', flexShrink: 0 } },
      h('button', {
        onClick: () => onBrowse(entry.key),
        disabled: moving,
        style: { ...buttonStyle(c), opacity: moving ? 0.45 : 1, cursor: moving ? 'default' : 'pointer' },
      }, t.settings.folders.browse),
      h('button', {
        onClick: () => onReset(entry.key),
        disabled: !entry.overridden || moving,
        style: {
          ...buttonStyle(c),
          opacity: (!entry.overridden || moving) ? 0.45 : 1,
          cursor: (!entry.overridden || moving) ? 'default' : 'pointer',
        },
      }, t.settings.folders.reset),
      h('button', {
        onClick: () => onOpen(entry.key),
        disabled: moving,
        style: { ...buttonStyle(c), opacity: moving ? 0.45 : 1, cursor: moving ? 'default' : 'pointer' },
      }, t.settings.folders.open)
    )
  );
