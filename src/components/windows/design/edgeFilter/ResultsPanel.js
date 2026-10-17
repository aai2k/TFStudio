import { SplitPane } from '../../../docking/SplitPane.js';
import { FooterBtn } from '../stackFormula/ui.js';
import { SolutionsTable } from './SolutionsTable.js';
import { PreviewPlot } from './PreviewPlot.js';

const { createElement: h, useState } = React;

const SPLIT_CHILDREN = [{ id: 'edge-solutions' }, { id: 'edge-preview' }];

// The selected period as a formula, to copy or to open in Stack Formula.
function FormulaRow({ state, c, ef }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h('span', { style: { fontSize: 11, color: c.textDim, flexShrink: 0 } }, ef.formula),
        h('input', {
            type: 'text', readOnly: true, value: state.formula, spellCheck: false,
            onFocus: e => e.target.select(),
            style: { flex: 1, minWidth: 0, padding: '5px 8px', fontSize: 12, backgroundColor: c.bg, color: c.text,
                     border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' },
        }),
        h(FooterBtn, { onClick: state.openInStackFormula, c, disabled: !state.compiled.ok, title: ef.openInStackFormulaTip },
            ef.openInStackFormula),
    );
}

export function ResultsPanel({ state, c, ef, design, lambdaAxis }) {
    const [sizes, setSizes] = useState([45, 55]);
    const { solutions } = state;
    return h('div', { style: { flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 320, height: 470 } },
        h('div', { style: { fontSize: 11, color: c.textDim, display: 'flex', gap: 14, flexWrap: 'wrap' } },
            solutions.length > 0 && h('span', { key: 'n' }, ef.found(solutions.length)),
            h('span', { key: 'rule' }, ef.rule),
        ),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } },
            h(SplitPane, { c, onSizesChange: setSizes, node: { direction: 'v', sizes, children: SPLIT_CHILDREN } },
                h(SolutionsTable, { state, design, c, ef }),
                h(PreviewPlot, {
                    design, compiled: state.compiled, inputs: state.inputs, c,
                    noPreviewText: ef.noPreview, lambdaAxis,
                }),
            ),
        ),
        h(FormulaRow, { state, c, ef }),
    );
}
