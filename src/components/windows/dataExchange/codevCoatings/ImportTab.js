import { LockIcon } from '../../../ui/LockIcon.js';
import { Btn, Label, td, th } from '../zemaxCoatings/ui.js';
import { WarningList } from './parts.js';

const { createElement: h } = React;

// A MIC material by its label, a constant index as CODE V wrote it.
const indexText = (index) => {
    if (index.label != null) return index.label;
    return index.k > 0 ? `n ${index.n}, k ${index.k}` : `n ${index.n}`;
};

const rangeText = (z, wavelengthsNm) => (wavelengthsNm.length
    ? z.wavelengthsValue(wavelengthsNm.length, Math.min(...wavelengthsNm), Math.max(...wavelengthsNm))
    : '');

function SummaryRow({ c, label, value }) {
    return h('tr', null,
        h('td', { style: { ...td(c), color: c.textDim, whiteSpace: 'nowrap', width: 1 } }, label),
        h('td', { style: td(c) }, value),
    );
}

function StackSummary({ c, z, stack }) {
    const rows = [
        [z.summaryTitle, stack.title],
        [z.summaryIncident, indexText(stack.incident)],
        [z.summarySubstrate, indexText(stack.substrate)],
        [z.summaryWavelengths, rangeText(z, stack.wavelengthsNm)],
        [z.summaryAngles, stack.anglesDeg.map(angle => `${angle}°`).join(', ')],
        [z.summaryRef, `${stack.refNm} nm`],
    ];
    return h('table', { style: { borderCollapse: 'collapse' } },
        h('tbody', null, rows.map(([label, value]) => h(SummaryRow, { key: label, c, label, value }))));
}

function layerRow(layer, index, c) {
    return h('tr', { key: index },
        h('td', { style: { ...td(c), color: c.textDim } }, index + 1),
        h('td', { style: td(c) }, indexText(layer.index)),
        h('td', { style: { ...td(c), textAlign: 'right', fontVariantNumeric: 'tabular-nums' } }, layer.thicknessNm.toFixed(2)),
        h('td', { style: { ...td(c), color: c.textDim } },
            layer.code === 100 ? h(LockIcon, { locked: true, size: 11 }) : null),
    );
}

function LayersTable({ c, z, layers }) {
    return h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
        h('thead', null, h('tr', null,
            h('th', { style: { ...th(c), width: 30 } }, '#'),
            h('th', { style: th(c) }, z.colMaterial),
            h('th', { style: { ...th(c), textAlign: 'right' } }, z.colThickness),
            h('th', { style: { ...th(c), width: 60 } }, z.colLocked),
        )),
        h('tbody', null, layers.map((layer, index) => layerRow(layer, index, c))),
    );
}

function StackView({ c, z, stack, importCoating }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
        h(StackSummary, { c, z, stack }),
        h(WarningList, { c, z, warnings: stack.warnings }),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
            h(Label, { c }, z.layersHeader(stack.layers.length)),
            h('div', { style: { flex: 1 } }),
            h(Btn, { onClick: importCoating, c, primary: true }, z.importToFront),
        ),
        h('div', { style: { fontSize: 10.5, color: c.textDim } }, z.importNote),
        h(LayersTable, { c, z, layers: stack.layers }),
    );
}

export function ImportTab({ c, z, stack, fileName, loading, onLoad, importCoating }) {
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' } },
            h(Btn, { onClick: onLoad, c, primary: true, disabled: loading }, loading ? z.loading : z.openBtn),
            fileName ? h('span', { style: { fontSize: 11, color: c.textDim } }, fileName) : null,
        ),
        stack
            ? h(StackView, { c, z, stack, importCoating })
            : h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noFile),
    );
}
