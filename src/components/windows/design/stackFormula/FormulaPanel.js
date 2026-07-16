import { Checkbox } from '../../../ui/Checkbox.js';
import { MediaRow } from './MediaRow.js';
import { SymbolsPanel } from './SymbolsPanel.js';

const { createElement: h } = React;

function errorLine(compiled, c) {
    return !compiled.ok && h('div', {
        style: { fontSize: 12, color: c.warning || '#ef5350',
                 fontFamily: 'ui-monospace, Consolas, monospace' }
    },
        compiled.errorPos != null
            ? `↳ @${compiled.errorPos}: ${compiled.error}`
            : compiled.error);
}

function optionsRow(state, c, sf) {
    return h('div', { style: { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' } },
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3,
                     fontSize: 11, color: c.textDim } },
            h('span', {}, sf.refLambda),
            h('input', { type: 'number', min: 100, max: 5000, step: 1, value: state.refLambda,
                onChange: (e) => { const v = parseFloat(e.target.value); if (v > 0) state.setRefLambda(v); },
                style: { width: 90, padding: '5px 7px', fontSize: 13, backgroundColor: c.bg,
                         color: c.text, border: `1px solid ${c.border}`, borderRadius: 4, outline: 'none' } })
        ),
        h('label', { style: { display: 'flex', alignItems: 'center', gap: 6,
                     fontSize: 12, color: c.textDim, marginTop: 14 } },
            h(Checkbox, { c, checked: state.startFromSubstrate,
                onChange: (e) => state.setStartFromSubstrate(e.target.checked) }),
            h('span', { title: sf.startFromSubstrateTip }, sf.startFromSubstrate),
        ),
    );
}

export function FormulaPanel({ state, c, t, sf }) {
    return h('div', { style: { flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: 10 } },
        h('div', { style: { fontSize: 12, color: c.textDim } }, sf.intro),
        h('textarea', {
            value: state.text,
            onChange: (e) => state.setText(e.target.value),
            spellCheck: false,
            style: { width: '100%', minHeight: 64, resize: 'vertical', boxSizing: 'border-box',
                     fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 14,
                     padding: '8px 10px', backgroundColor: c.bg, color: c.text,
                     border: `1px solid ${state.parsed.ok ? c.border : (c.warning || '#ef5350')}`,
                     borderRadius: 4, outline: 'none' }
        }),
        errorLine(state.compiled, c),
        optionsRow(state, c, sf),
        h(MediaRow, { state, c, t, sf }),
        h(SymbolsPanel, { state, c, t, sf }),
    );
}
