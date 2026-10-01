/**
 * RIIBrowser — right panel: selected-material details, n/k chart, and the
 * add-to-catalog action bar (including the destination-catalog picker).
 */

import { sampledRangeNm } from '../../../../utils/materials/riiDatabase.js';
import { ActionButton, FieldLabel, SelectField } from '../../analysis/chrome/controls.js';
import { RiiChart } from './riiChart.js';

const { createElement: h } = React;

// The span that will be plotted beside this line and stored if the material is
// added, not the range the database record declares: a table often declares a
// wider range than its rows cover. Below 100 nm whole nanometres are too coarse,
// so a page starting at 27.5 nm does not read as 28.
const nmText = value => (value >= 100 ? Math.round(value) : Number(value.toPrecision(3)));

export function wlRange(mat) {
    const range = sampledRangeNm(mat);
    if (!range) return '—';
    return `${nmText(range[0])}–${nmText(range[1])} nm`;
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
    const options = [
        ...userCatalogs.map(cat => ({ id: cat.id, label: cat.name })),
        { id: '__new__', label: rii.newCatalogOption },
    ];
    return [
        h(FieldLabel, { key: 'lbl', c }, rii.catalogLabel),
        h('div', { key: 'sel', style: { flex: 1, minWidth: 0 } },
            h(SelectField, { c, width: '100%', value: targetCatId, onChange: setTargetCatId, options })),
        h(ActionButton, { key: 'add', c, label: rii.addButton, onClick: () => doAdd(targetCatId) }),
        h(ActionButton, { key: 'cancel', c, label: rii.cancel, onClick: () => setPhase('idle') }),
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
        (phase === 'idle' || phase === 'ok') && h('div', { style: { marginLeft: 'auto' } },
            h(ActionButton, { c, label: rii.addToCatalog, onClick: handleAddClick }))
    );
}

function renderMaterialDetails(s) {
    const { c, mat, wavelengthLabel } = s;
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        renderInfoGrid(s),
        mat.references && h('div', {
            style: {
                padding: '0 14px 6px', flexShrink: 0,
                fontSize: 11, color: c.textDim, lineHeight: 1.5,
                maxHeight: 52, overflow: 'hidden',
            },
        }, mat.references.length > 280 ? mat.references.slice(0, 280) + '…' : mat.references),
        h(RiiChart, { material: mat, c, xLabel: wavelengthLabel }),
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
