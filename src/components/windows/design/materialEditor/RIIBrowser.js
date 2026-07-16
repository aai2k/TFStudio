/**
 * RIIBrowser.js — Modal browser for refractiveindex.info database.
 * Opened from MaterialEditor via the "Browse RII…" button.
 *
 * Browse mode (no query): collapsible shelf → book → page tree.
 * Search mode (query typed): flat filtered results list.
 */

import { useRIIBrowser } from './useRIIBrowser.js';
import { renderRiiLeftPanel, renderStatusBar } from './riiLeftPanel.js';
import { renderRiiRightPanel } from './riiRightPanel.js';

const { createElement: h } = React;

export function RIIBrowser({ c, t, onClose, onAdded }) {
    const s = useRIIBrowser({ c, t, onAdded });

    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 9000,
            backgroundColor: 'rgba(0,0,0,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        },
        onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); },
    },
        h('div', {
            style: {
                width: 820, height: 580,
                backgroundColor: c.bg, border: `1px solid ${c.border}`,
                borderRadius: 6, display: 'flex', flexDirection: 'column', overflow: 'hidden',
                boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        },
            // Header
            h('div', {
                style: {
                    padding: '9px 14px', borderBottom: `1px solid ${c.border}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexShrink: 0,
                },
            },
                h('span', { style: { fontSize: 14, fontWeight: 600, color: c.text } }, s.rii.title),
                h('button', {
                    onClick: onClose,
                    style: { background: 'none', border: 'none', color: c.textDim, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: 0 },
                }, '×')
            ),
            renderStatusBar(s),
            h('div', { style: { flex: 1, display: 'flex', overflow: 'hidden' } },
                renderRiiLeftPanel(s),
                renderRiiRightPanel(s)
            )
        )
    );
}
