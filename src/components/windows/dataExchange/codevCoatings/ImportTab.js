import { ActionButton } from '../../analysis/chrome/controls.js';
import { CenteredMessage, EditorGroupTitle } from '../../analysis/chrome/layout.js';
import { ImportPage, PanelSection } from '../chrome/panel.js';
import { LockIcon } from '../../../ui/LockIcon.js';
import { td, th } from '../zemaxCoatings/ui.js';
import { fileNumber } from './fileStack.js';

const { createElement: h } = React;

// A MIC material by its label, a constant index as CODE V wrote it.
const indexText = (index) => {
    if (index.label != null) return index.label;
    return index.k > 0 ? `n ${index.n}, k ${index.k}` : `n ${index.n}`;
};

const rangeText = (z, wavelengthsNm) => {
    if (!wavelengthsNm.length) return '';
    const shown = wavelengthsNm.map(fileNumber);
    return z.wavelengthsValue(shown.length, Math.min(...shown), Math.max(...shown));
};

function SummaryRow({ c, label, value }) {
    return h('tr', null,
        h('td', { style: { ...td(c), color: c.textDim, whiteSpace: 'nowrap', width: 1 } }, label),
        h('td', { style: td(c) }, value),
    );
}

// What the file sets around its layers.
function StackSummary({ c, z, stack }) {
    const rows = [
        [z.summaryIncident, indexText(stack.incident)],
        [z.summarySubstrate, indexText(stack.substrate)],
        [z.summaryWavelengths, rangeText(z, stack.wavelengthsNm)],
        [z.summaryAngles, stack.anglesDeg.map(angle => `${angle}°`).join(', ')],
        [z.summaryRef, `${fileNumber(stack.refNm)} nm`],
    ];
    return h(PanelSection, { c },
        h('table', { style: { borderCollapse: 'collapse' } },
            h('tbody', null, rows.map(([label, value]) => h(SummaryRow, { key: label, c, label, value })))));
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

// In Symmetric mode the design replaces any back coating written to it with the
// mirror of the front, so layers imported to the back would not stay there.
function BackButton({ c, z, design, importCoating }) {
    const mirrored = design?.surfaceMode === 'symmetric';
    return h('span', { title: mirrored ? z.importBackSymmetric : undefined },
        h(ActionButton, { c, label: z.importToBack, onClick: () => importCoating('back'), disabled: mirrored }));
}

// The stack read, its layers as the file lists them, and what can be done with it.
function StackView({ c, z, stack, fileName, design, importCoating, saveToLibrary }) {
    return h(React.Fragment, null,
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h('div', { style: { fontWeight: 600, fontSize: 12, marginRight: 'auto' } }, stack.title || fileName),
            h(ActionButton, { c, label: z.importToFront, onClick: () => importCoating('front') }),
            h(BackButton, { c, z, design, importCoating }),
            h(ActionButton, { c, label: z.saveToLibrary, title: z.saveToLibraryTip, onClick: saveToLibrary }),
        ),
        h(EditorGroupTitle, { c }, z.layersHeader(stack.layers.length)),
        h(LayersTable, { c, z, layers: stack.layers }),
    );
}

/**
 * The panel that opens the file and sums up what it sets, on the left; the
 * layers it holds and their actions, on the right.
 */
export function ImportTab(props) {
    const { c, z, stack, loading, onLoad, fileName, panelWidth, setPanelWidth } = props;
    return h(ImportPage, {
        c, panelWidth, onPanelWidthChange: setPanelWidth,
        file: {
            title: z.fileTitle, label: loading ? z.loading : z.openBtn,
            onImport: onLoad, loading, fileName, hint: z.fileHint,
        },
        section: stack && h(StackSummary, { c, z, stack }),
    }, stack ? h(StackView, props) : h(CenteredMessage, { c, message: z.noFile }));
}
