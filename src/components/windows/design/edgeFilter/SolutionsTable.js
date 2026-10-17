import { designMaterialShortName } from '../../../../utils/materials/designMaterials.js';

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

function solutionRow({ sol, index, selected, outerName, onSelect, c }) {
    return h('tr', {
        key: index, onClick: () => onSelect(index),
        style: { cursor: 'pointer', backgroundColor: selected ? c.selection || c.hover : 'transparent' },
    },
        h('td', { style: { ...cell, color: c.textDim } }, index + 1),
        h('td', { style: { ...cell, textAlign: 'left', maxWidth: 110, overflow: 'hidden', textOverflow: 'ellipsis' } }, outerName),
        h('td', { style: cell }, sol.a.toFixed(4)),
        h('td', { style: cell }, sol.b.toFixed(4)),
        h('td', { style: cell }, sol.c.toFixed(4)),
        h('td', { style: cell }, nm(sol.zoneS)),
        h('td', { style: cell }, nm(sol.zoneP)),
        h('td', { style: { ...cell, color: c.textDim } }, nm(sol.passWidth)),
    );
}

// The empty table says why it is empty.
function emptyText(state, ef) {
    if (state.running) return ef.searchStarted;
    if (!state.current) return ef.pressSearch;
    if (state.current.result.errorKey) return ef.errors[state.current.result.errorKey];
    return ef.none;
}

/** The periods found, best first; a click picks the one previewed and applied. */
export function SolutionsTable({ state, design, c, ef }) {
    const { solutions, inputs } = state;
    const selectedIndex = state.current?.selected ?? 0;
    const outerName = sol => designMaterialShortName(design, sol.outer === 'A' ? inputs.matA : inputs.matB);
    return h('div', { style: { height: '100%', overflowY: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11.5, color: c.text } },
            h('thead', {},
                h('tr', { style: { backgroundColor: c.hover, position: 'sticky', top: 0 } },
                    columns(ef).map((col, i) => h('th', {
                        key: i, title: col.title,
                        style: { ...cell, textAlign: col.left ? 'left' : 'right', padding: '4px 8px',
                                 borderBottom: `1px solid ${c.border}`, fontWeight: 600 },
                    }, col.label)))),
            h('tbody', {},
                solutions.length
                    ? solutions.map((sol, index) => solutionRow({
                        sol, index, selected: index === selectedIndex, outerName: outerName(sol), onSelect: state.select, c,
                    }))
                    : h('tr', {}, h('td', { colSpan: 8, style: { padding: 10, color: c.textDim, textAlign: 'center', fontStyle: 'italic', whiteSpace: 'normal' } },
                        emptyText(state, ef))))));
}
