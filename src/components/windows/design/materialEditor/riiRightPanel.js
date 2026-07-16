/**
 * RIIBrowser — right panel: selected-material details, n/k chart, and the
 * add-to-catalog action bar (including the destination-catalog picker).
 */

const { createElement: h } = React;

export function wlRange(mat) {
    if (mat.wavelengthRange) {
        return `${Math.round(mat.wavelengthRange[0])}–${Math.round(mat.wavelengthRange[1])} nm`;
    }
    if (mat.tableNK?.length) {
        const lo = mat.tableNK[0][0], hi = mat.tableNK[mat.tableNK.length - 1][0];
        return `${Math.round(lo)}–${Math.round(hi)} nm`;
    }
    return '—';
}

export function typeLabel(type) {
    return { tabulated_nk: 'Tabulated n,k', tabulated_n: 'Tabulated n',
             formula: 'Dispersion formula', mixed: 'Formula + tabulated k' }[type] || type;
}

function renderInfoGrid(s) {
    const { c, rii, selected, mat } = s;
    return h('div', {
        style: {
            padding: '10px 14px 6px', flexShrink: 0,
            display: 'grid', gridTemplateColumns: 'auto 1fr',
            gap: '3px 14px', fontSize: 12,
        },
    },
        h('span', { style: { color: c.textDim } }, rii.book),
        h('span', { style: { color: c.text, fontWeight: 600 } }, selected.bookName),
        h('span', { style: { color: c.textDim } }, rii.page),
        h('span', { style: { color: c.text } }, selected.pageName),
        h('span', { style: { color: c.textDim } }, rii.type),
        h('span', { style: { color: c.text } }, typeLabel(mat.type)),
        h('span', { style: { color: c.textDim } }, rii.wavelengthRange),
        h('span', { style: { color: c.text } }, wlRange(mat)),
    );
}

function renderCatalogPicker(s) {
    const { c, rii, userCatalogs, targetCatId, setTargetCatId, doAdd, setPhase } = s;
    return [
        h('span', { key: 'lbl', style: { fontSize: 12, color: c.textDim } }, rii.catalogLabel),
        h('select', {
            key: 'sel',
            value: targetCatId, onChange: e => setTargetCatId(e.target.value),
            style: {
                flex: 1, height: 24, backgroundColor: c.panel, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 12,
            },
        },
            userCatalogs.map(cat => h('option', { key: cat.id, value: cat.id }, cat.name)),
            h('option', { key: '__new__', value: '__new__' }, rii.newCatalogOption)
        ),
        h('button', {
            key: 'add',
            onClick: () => doAdd(targetCatId),
            style: {
                padding: '3px 12px', fontSize: 12,
                backgroundColor: c.accent, color: '#fff',
                border: 'none', borderRadius: 3, cursor: 'pointer',
            },
        }, rii.addButton),
        h('button', {
            key: 'cancel',
            onClick: () => setPhase('idle'),
            style: {
                padding: '3px 10px', fontSize: 12, backgroundColor: c.panel,
                color: c.text, border: `1px solid ${c.border}`,
                borderRadius: 3, cursor: 'pointer',
            },
        }, rii.cancel),
    ];
}

function renderActionBar(s) {
    const { c, rii, phase, addMsg, handleAddClick } = s;
    return h('div', {
        style: {
            padding: '8px 14px', borderTop: `1px solid ${c.border}`,
            flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8,
        },
    },
        phase === 'ok'    && h('span', { style: { fontSize: 12, color: '#58d68d' } }, addMsg),
        phase === 'error' && h('span', { style: { fontSize: 12, color: '#ec7063' } }, addMsg),
        phase === 'picking' && renderCatalogPicker(s),
        (phase === 'idle' || phase === 'ok') && h('button', {
            onClick: handleAddClick,
            style: {
                marginLeft: 'auto', padding: '4px 16px', fontSize: 12,
                backgroundColor: c.accent, color: '#fff',
                border: 'none', borderRadius: 3, cursor: 'pointer',
            },
        }, rii.addToCatalog)
    );
}

function renderMaterialDetails(s) {
    const { c, mat, chartRef } = s;
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        renderInfoGrid(s),
        mat.references && h('div', {
            style: {
                padding: '0 14px 6px', flexShrink: 0,
                fontSize: 11, color: c.textDim, lineHeight: 1.5,
                maxHeight: 52, overflow: 'hidden',
            },
        }, mat.references.length > 280 ? mat.references.slice(0, 280) + '…' : mat.references),
        h('div', { ref: chartRef, style: { flex: 1, minHeight: 160 } }),
        renderActionBar(s)
    );
}

export function renderRiiRightPanel(s) {
    const { c, rii, selected, matLoading, matErr, mat } = s;
    const centered = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' };
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        !selected && h('div', { style: { ...centered, color: c.textDim, fontSize: 13, fontStyle: 'italic' } }, rii.selectMaterial),
        selected && matLoading && h('div', { style: { ...centered, color: c.textDim, fontSize: 13 } }, rii.loadingMaterial),
        selected && matErr && h('div', { style: { flex: 1, padding: 16, color: '#ec7063', fontSize: 12 } }, matErr),
        selected && mat && !matLoading && renderMaterialDetails(s)
    );
}
