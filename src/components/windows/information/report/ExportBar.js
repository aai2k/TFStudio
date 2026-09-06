/**
 * The strip under the page: what the report holds, the last export's outcome,
 * and the Export menu at the right-hand end, where every window keeps its
 * export. The menu opens upwards, since there is no room below the strip, and
 * closes as soon as an item is chosen.
 */

const { createElement: h, useState } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

const DOWNLOAD = h('svg', { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none' },
    h('path', { d: 'M8 2v8M4.5 6.5L8 10l3.5-3.5M3 13h10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
const CHEVRON = h('svg', { width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none' },
    h('path', { d: 'M2 3.5l3 3 3-3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }));

function MenuItem({ c, label, onClick }) {
    return h('button', {
        type: 'button', onClick,
        style: {
            width: '100%', display: 'flex', alignItems: 'center', height: 26, padding: '0 10px',
            border: 'none', borderRadius: 4, backgroundColor: 'transparent', color: c.text, cursor: 'pointer',
            fontSize: 11, fontFamily: FONT, textAlign: 'left', whiteSpace: 'nowrap',
        },
    }, label);
}

function ExportMenu({ c, W, enabled, onPdf, onHtml, onCopy }) {
    const [open, setOpen] = useState(false);
    const run = action => { setOpen(false); action(); };
    return h('div', { style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            type: 'button', disabled: !enabled, 'aria-expanded': open,
            onClick: () => enabled && setOpen(current => !current),
            style: {
                height: 22, display: 'inline-flex', alignItems: 'center', gap: 5, padding: '0 8px',
                border: `1px solid ${open ? c.accent : c.border}`, borderRadius: 6,
                backgroundColor: open ? c.accent + (c.light ? '20' : '38') : 'transparent',
                color: c.text, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
                fontSize: 11, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap', outline: 'none',
            },
        }, DOWNLOAD, W.export, CHEVRON),
        open && h('div', { onClick: () => setOpen(false), style: { position: 'fixed', inset: 0, zIndex: 49 } }),
        open && h('div', {
            style: {
                position: 'absolute', right: 0, bottom: 27, zIndex: 50, minWidth: 200, padding: 4,
                backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 6,
                boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            },
        },
            h(MenuItem, { c, label: W.exportPdf, onClick: () => run(onPdf) }),
            h(MenuItem, { c, label: W.exportHtml, onClick: () => run(onHtml) }),
            h(MenuItem, { c, label: W.copyTables, onClick: () => run(onCopy) }),
        ),
    );
}

export function ExportBar({ c, W, summary, status, enabled, onPdf, onHtml, onCopy }) {
    const tone = !status ? c.textDim : status.kind === 'err' ? c.error : status.kind === 'ok' ? c.success : c.textDim;
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, height: 30, padding: '0 8px 0 12px',
            backgroundColor: c.field, borderTop: `1px solid ${c.border}`, flexShrink: 0,
            fontFamily: FONT, fontSize: 11, color: c.text,
        },
    },
        h('span', { style: { color: c.textDim, whiteSpace: 'nowrap' } }, summary),
        status && h('span', { role: 'status', style: { color: tone, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, status.msg),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center' } },
            h(ExportMenu, { c, W, enabled, onPdf, onHtml, onCopy })),
    );
}
