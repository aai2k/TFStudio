/**
 * Material Editor — destination-catalog picker modals.
 *
 * Two small modals share the same overlay/row chrome: the copy-to-catalog
 * picker (shown for ≥2 user catalogs) and the OptiLayer-import target picker.
 */

const { createElement: h } = React;

// A dismissible overlay with a title and a list of clickable catalog rows.
function catalogPickerOverlay({ onDismiss, title, children, c, minWidth = 240, maxWidth = 360, extraStyle }) {
    return h('div', {
        onClick: onDismiss,
        style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
        h('div', {
            onClick: e => e.stopPropagation(),
            style: { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', minWidth, maxWidth, padding: '10px 0', ...extraStyle }
        },
            h('div', { style: { padding: '2px 14px 8px', fontSize: 13, fontWeight: 600, color: c.text } }, title),
            children
        )
    );
}

function catalogPickerRow(cat, onClick, c, ellipsis) {
    // OptiLayer-import rows can carry long catalog names → ellipsis + non-shrinking
    // count; the copy-picker rows use plain spans. `ellipsis` selects the variant.
    const nameStyle = ellipsis ? { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } : undefined;
    const countStyle = ellipsis ? { color: c.textDim, flexShrink: 0 } : { color: c.textDim };
    return h('div', {
        key: cat.id,
        onClick,
        style: { padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: c.text, display: 'flex', justifyContent: 'space-between', gap: 12 },
        onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
    },
        h('span', nameStyle ? { style: nameStyle } : null, cat.name),
        h('span', { style: countStyle }, `(${Object.keys(cat.materials || {}).length})`)
    );
}

export function renderCopyPickerModal({ copyPickerFor, catalogs, doCopyToCatalog, setCopyPickerFor, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setCopyPickerFor(null),
        title: me.copyToCatalogTitle(copyPickerFor.name || copyPickerFor.id),
        c,
        children: catalogs.filter(cat => cat.source === 'user').map(cat =>
            catalogPickerRow(cat, () => doCopyToCatalog(copyPickerFor, cat.id), c, false)),
    });
}

export function renderOptiLayerImportModal({ olImport, catalogs, doImportOptiLayer, setOlImport, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setOlImport(null),
        title: me.importTargetTitle(olImport.count),
        c, minWidth: 280, maxWidth: 380,
        extraStyle: { maxHeight: '70vh', display: 'flex', flexDirection: 'column' },
        children: [
            h('div', { key: 'list', style: { overflowY: 'auto' } },
                catalogs.filter(cat => cat.id !== 'builtin').map(cat =>
                    catalogPickerRow(cat, () => doImportOptiLayer(cat.id), c, true))
            ),
            h('div', {
                key: 'new',
                onClick: () => doImportOptiLayer('__new__'),
                style: { padding: '8px 14px', cursor: 'pointer', fontSize: 12, color: c.accent, fontWeight: 600, borderTop: `1px solid ${c.border}`, marginTop: 4 },
                onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
                onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
            }, me.importTargetNew)
        ],
    });
}
