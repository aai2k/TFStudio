import { LockIcon } from '../../../ui/LockIcon.js';
import { coatLayerThkNm } from './model.js';
import { Btn, td, th } from './ui.js';

const { createElement: h } = React;

const coatingTypeLabel = (z, type) => ({
    layers: z.typeStack, idealI: z.typeIdeal, ideal: z.typeIdeal, ideal2: z.typeIdeal,
    table: z.typeTable, encrypted: z.typeEncrypted,
}[type] || type);

function coatingListRow(coating, index, { c, z, selCoating, setSelCoating }) {
    const importable = coating.type === 'layers';
    return h('tr', {
        key: index,
        onClick: importable ? () => setSelCoating(index) : undefined,
        title: importable ? coating.name : z.notImportable,
        style: {
            cursor: importable ? 'pointer' : 'default',
            opacity: importable ? 1 : 0.5,
            background: index === selCoating ? c.accent + '22' : 'transparent',
        },
    },
        h('td', { style: { ...td(c), display: 'flex', alignItems: 'center', gap: 5 } },
            importable ? null : h('span', { style: { display: 'inline-flex', color: c.textDim }, title: z.notImportable }, h(LockIcon, { locked: true, size: 11 })),
            h('span', null, coating.name || '—'),
        ),
        h('td', { style: { ...td(c), color: c.textDim } }, coatingTypeLabel(z, coating.type)),
        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, importable ? coating.layers.length : ''),
    );
}

function coatingLayerRow(layer, index, { c, z, materialsByName, refNm }) {
    const thickness = coatLayerThkNm(layer, materialsByName, refNm);
    return h('tr', { key: index },
        h('td', { style: { ...td(c), color: c.textDim } }, index + 1),
        h('td', { style: td(c) }, layer.material),
        h('td', { style: { ...td(c), textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
            Number.isFinite(thickness) ? `${thickness.toFixed(2)} nm` : '—'),
        h('td', { style: { ...td(c), color: c.textDim } },
            layer.isAbsolute ? `${layer.thickness} ${z.modeAbs}` : `${layer.thickness} ${z.modeRel}`),
    );
}

function coatingDetail(selected, { c, z, materialsByName, refNm, importCoating }) {
    if (!selected) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 12 } }, z.selectCoating);
    if (selected.type !== 'layers') return h('div', { style: { color: c.textDim, fontSize: 12, padding: 12 } }, z.importNotStack);
    return [
        h('div', { key: 'h', style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h('div', { style: { fontWeight: 600, fontSize: 12 } }, selected.name),
            h('div', { style: { flex: 1 } }),
            h(Btn, { onClick: importCoating, c, primary: true }, z.importToFront),
        ),
        h('div', { key: 'lh', style: { fontSize: 10, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.4px' } }, z.layersHeader),
        h('table', { key: 'lt', style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: { ...th(c), width: 30 } }, '#'),
                h('th', { style: th(c) }, z.colMaterial),
                h('th', { style: { ...th(c), textAlign: 'right' } }, z.colThickness),
                h('th', { style: th(c) }, z.colMode),
            )),
            h('tbody', null, selected.layers.map((layer, index) => coatingLayerRow(layer, index, { c, z, materialsByName, refNm }))),
        ),
        h('div', { key: 'note', style: { fontSize: 10.5, color: c.textDim, marginTop: 4 } }, z.importNotStack),
    ];
}

export function CoatingsTab({ c, z, doc, selCoating, setSelCoating, refNm, importCoating }) {
    if (!doc) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noFile);
    if (!doc.coatings.length) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noCoatings);

    const selected = doc.coatings[selCoating];
    const materialsByName = {};
    for (const material of doc.materials) materialsByName[material.name.toUpperCase()] = material;

    return h('div', { style: { display: 'flex', gap: 12, height: '100%' } },
        h('div', { style: { flex: '0 0 300px', overflow: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null,
                    h('th', { style: th(c) }, z.colName),
                    h('th', { style: th(c) }, z.colType),
                    h('th', { style: { ...th(c), textAlign: 'right' } }, z.colLayers),
                )),
                h('tbody', null, doc.coatings.map((coating, index) => coatingListRow(coating, index, { c, z, selCoating, setSelCoating }))),
            ),
        ),
        h('div', { style: { flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 8 } },
            coatingDetail(selected, { c, z, materialsByName, refNm, importCoating }),
        ),
    );
}
