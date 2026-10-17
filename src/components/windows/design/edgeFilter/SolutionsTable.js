import { designMaterialShortName } from '../../../../utils/materials/designMaterials.js';
import { RESULT_ROW_HEIGHT } from '../../../ui/ResultsSection.js';
import { useSteadyColumns, useVirtualRows, virtualBody } from '../../../ui/virtualRows.js';

const { createElement: h } = React;

const cell = { padding: '2px 8px', textAlign: 'right', whiteSpace: 'nowrap' };
const nm = width => (Number.isFinite(width) ? width.toFixed(1) : '∞');

function columns(ef) {
    return [
        { label: '#' },
        { label: ef.colOuter, left: true },
        { label: 'a' }, { label: 'b' }, { label: 'c' },
        { label: ef.colZoneS, title: ef.colZoneTip },
        { label: ef.colZoneP, title: ef.colZoneTip },
        { label: ef.colPass, title: ef.colPassTip },
    ];
}

// `fit` records each cell's text so its column keeps the widest width drawn.
function solutionRow({ sol, index, selected, outerName, onSelect, fit, c }) {
    return h('tr', {
        key: index, onClick: () => onSelect(index),
        style: { height: RESULT_ROW_HEIGHT, cursor: 'pointer', backgroundColor: selected ? c.selection || c.hover : 'transparent' },
    },
        h('td', { style: { ...cell, color: c.textDim } }, fit(0, String(index + 1))),
        h('td', { style: { ...cell, textAlign: 'left', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' } }, fit(1, outerName)),
        h('td', { style: cell }, fit(2, sol.a.toFixed(4))),
        h('td', { style: cell }, fit(3, sol.b.toFixed(4))),
        h('td', { style: cell }, fit(4, sol.c.toFixed(4))),
        h('td', { style: cell }, fit(5, nm(sol.zoneS))),
        h('td', { style: cell }, fit(6, nm(sol.zoneP))),
        h('td', { style: { ...cell, color: c.textDim } }, fit(7, nm(sol.passWidth))),
    );
}

// The empty table says why it is empty.
function emptyText(state, ef) {
    if (state.running) return ef.searchStarted;
    if (!state.current) return ef.pressSearch;
    if (state.current.result.errorKey) return ef.errors[state.current.result.errorKey];
    return ef.none;
}

/**
 * The periods found, best first; a click picks the one previewed and applied.
 * Only the rows in view are drawn (ui/virtualRows.js): a fine step over a wide
 * range of a finds tens of thousands of periods.
 */
export function SolutionsTable({ state, design, c, ef }) {
    const { solutions, inputs } = state;
    const cols = columns(ef);
    const view = useVirtualRows(solutions.length, RESULT_ROW_HEIGHT);
    const widths = useSteadyColumns(cols.map(col => col.label));
    const selectedIndex = state.current?.selected ?? 0;
    const outerName = sol => designMaterialShortName(design, sol.outer === 'A' ? inputs.matA : inputs.matB);
    const body = solutions.length
        ? virtualBody(solutions, view, RESULT_ROW_HEIGHT, cols.length, (sol, index) => solutionRow({
            sol, index, selected: index === selectedIndex, outerName: outerName(sol), onSelect: state.select, fit: widths.fit, c,
        }))
        : h('tr', {}, h('td', { colSpan: cols.length, style: { padding: 10, color: c.textDim, textAlign: 'center', fontStyle: 'italic', whiteSpace: 'normal' } },
            emptyText(state, ef)));
    return h('div', {
        ref: view.paneRef, onScroll: view.onScroll,
        style: { height: '100%', overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 },
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
            widths.colgroup(),
            h('thead', {},
                h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                    cols.map((col, i) => h('th', {
                        key: i, title: col.title,
                        style: { ...cell, textAlign: col.left ? 'left' : 'right', padding: '4px 8px',
                                 borderBottom: `1px solid ${c.border}`, fontWeight: 600 },
                    }, col.label)))),
            h('tbody', {}, body)));
}
