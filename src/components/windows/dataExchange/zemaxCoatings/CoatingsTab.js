import { ActionButton } from '../../analysis/chrome/controls.js';
import { CenteredMessage, EditorGroupTitle } from '../../analysis/chrome/layout.js';
import { PanelSection } from '../chrome/panel.js';
import { LockIcon } from '../../../ui/LockIcon.js';
import { ImportPage } from './ImportPage.js';
import { coatLayerThkNm } from './model.js';
import { td, th } from './ui.js';

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
            h('span', null, coating.name),
        ),
        h('td', { style: { ...td(c), color: c.textDim } }, coatingTypeLabel(z, coating.type)),
        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, importable ? coating.layers.length : ''),
    );
}

function CoatingList({ c, z, doc, selCoating, setSelCoating }) {
    return h(PanelSection, { c, title: z.tabCoatings },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: th(c) }, z.colName),
                h('th', { style: th(c) }, z.colType),
                h('th', { style: { ...th(c), textAlign: 'right' } }, z.colLayers),
            )),
            h('tbody', null, doc.coatings.map((coating, index) => coatingListRow(coating, index, { c, z, selCoating, setSelCoating }))),
        ),
    );
}

// A relative thickness for which the file's MATE tables give no index at λ₀
// shows as "?".
function coatingLayerRow(layer, index, { c, z, materialsByName, refNm }) {
    const thickness = coatLayerThkNm(layer, materialsByName, refNm);
    return h('tr', { key: index },
        h('td', { style: { ...td(c), color: c.textDim } }, index + 1),
        h('td', { style: td(c) }, layer.material),
        h('td', { style: { ...td(c), textAlign: 'right', fontVariantNumeric: 'tabular-nums' } },
            Number.isFinite(thickness) ? `${thickness.toFixed(2)} nm` : '?'),
        h('td', { style: { ...td(c), color: c.textDim } },
            layer.isAbsolute ? `${layer.thickness} ${z.modeAbs}` : `${layer.thickness} ${z.modeRel}`),
    );
}

// The selected COAT, its layers as the file lists them, and what can be done
// with it. A layer naming a material the file defines more than once is
// converted with the last record of that name, as the import does.
function CoatingDetail({ c, z, doc, selected, refNm, importCoating, saveToLibrary }) {
    if (!selected) return h(CenteredMessage, { c, message: z.selectCoating });
    if (selected.type !== 'layers') return h(CenteredMessage, { c, message: z.importNotStack });
    const materialsByName = {};
    for (const material of doc.materials) materialsByName[material.name.toUpperCase()] = material;
    return h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontWeight: 600, fontSize: 12, marginRight: 'auto' } }, selected.name),
            h(ActionButton, { c, label: z.importToFront, onClick: importCoating }),
            h(ActionButton, { c, label: z.saveToLibrary, title: z.saveToLibraryTip, onClick: saveToLibrary }),
        ),
        h(EditorGroupTitle, { c }, z.layersHeader),
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null, h('tr', null,
                h('th', { style: { ...th(c), width: 30 } }, '#'),
                h('th', { style: th(c) }, z.colMaterial),
                h('th', { style: { ...th(c), textAlign: 'right' } }, z.colThickness),
                h('th', { style: th(c) }, z.colMode),
            )),
            h('tbody', null, selected.layers.map((layer, index) => coatingLayerRow(layer, index, { c, z, materialsByName, refNm }))),
        ),
        h('div', { style: { fontSize: 10.5, color: c.textDim } }, z.importNotStack),
    );
}

function coatingsBody(props) {
    const { c, z, doc, selCoating } = props;
    if (!doc) return h(CenteredMessage, { c, message: z.noFile });
    if (!doc.coatings.length) return h(CenteredMessage, { c, message: z.noCoatings });
    return h(CoatingDetail, { ...props, selected: doc.coatings[selCoating] });
}

export function CoatingsTab(props) {
    const hasCoatings = props.doc?.coatings.length > 0;
    return h(ImportPage, { ...props, section: hasCoatings ? h(CoatingList, props) : null },
        coatingsBody(props));
}
