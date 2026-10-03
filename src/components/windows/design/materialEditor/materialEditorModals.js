/**
 * Material Editor: the destination-catalog pickers, one for a material being
 * copied and one for a blank material. Each is shown only when there are two
 * or more user catalogs to choose from.
 */

const { createElement: h } = React;

// A dismissible overlay with a title and a list of clickable catalog rows.
function catalogPickerOverlay({ onDismiss, title, children, c, minWidth = 240, maxWidth = 360 }) {
    return h('div', {
        onClick: onDismiss,
        style: { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
        h('div', {
            onClick: e => e.stopPropagation(),
            style: { background: c.panel, border: `1px solid ${c.border}`, borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.4)', minWidth, maxWidth, padding: '10px 0' }
        },
            h('div', { style: { padding: '2px 14px 8px', fontSize: 13, fontWeight: 600, color: c.text } }, title),
            children
        )
    );
}

function catalogPickerRow(cat, onClick, c) {
    return h('div', {
        key: cat.id,
        onClick,
        style: { padding: '7px 14px', cursor: 'pointer', fontSize: 12, color: c.text, display: 'flex', justifyContent: 'space-between', gap: 12 },
        onMouseEnter: e => { e.currentTarget.style.backgroundColor = c.hover; },
        onMouseLeave: e => { e.currentTarget.style.backgroundColor = 'transparent'; }
    },
        h('span', null, cat.name),
        h('span', { style: { color: c.textDim } }, `(${Object.keys(cat.materials || {}).length})`)
    );
}

export function renderCopyPickerModal({ copyPickerFor, catalogs, doCopyToCatalog, setCopyPickerFor, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setCopyPickerFor(null),
        title: me.copyToCatalogTitle(copyPickerFor.name || copyPickerFor.id),
        c,
        children: catalogs.filter(cat => cat.source === 'user').map(cat =>
            catalogPickerRow(cat, () => doCopyToCatalog(copyPickerFor, cat.id), c)),
    });
}

export function renderNewMaterialPickerModal({ catalogs, handleNewMaterialIn, setNewMaterialPicker, me, c }) {
    return catalogPickerOverlay({
        onDismiss: () => setNewMaterialPicker(false),
        title: me.newMaterialPickTitle,
        c,
        children: catalogs.filter(cat => cat.source === 'user').map(cat =>
            catalogPickerRow(cat, () => handleNewMaterialIn(cat.id), c)),
    });
}
