/**
 * The deposition sequence and the per-material rates.
 *
 * The sequence table is also the window's selector: clicking a layer moves the
 * timeline to it and holds it, and the chart follows what is held.
 */

import { NumInput } from '../../analysis/chrome/controls.js';
import { SectionTitle, SidePanel, SidePanelNote } from '../../analysis/chrome/layout.js';

const { createElement: h, useEffect, useRef } = React;

// Fixed column widths. Material names run from "SiO2" to "Ta2O5 (Peleng 2024)",
// and an auto-sized table redraws every column as the current layer changes, so
// the numbers move under the pointer while a run plays.
// Leave enough room for the localized thickness heading; 66 px clipped the
// English "Thickness (nm)" after the first unit character.
const SEQUENCE_COLUMNS = [26, null, 86, 54];
const RATE_COLUMNS = [null, 86];

function formatNumber(value, decimals = 1) {
    return isFinite(value) ? value.toFixed(decimals) : '';
}

function materialDisplay(layer) {
    return layer?.matObj?.name || layer?.materialId || '';
}

/** Table whose columns hold their width whatever the cells contain. */
function FixedTable({ c, columns, head, children }) {
    return h('table', {
        style: { width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse', fontSize: 11 },
    },
        h('colgroup', null, columns.map((width, index) => h('col', {
            key: index, style: width == null ? undefined : { width },
        }))),
        h('thead', null, h('tr', { style: { color: c.textDim } }, head)),
        children,
    );
}

function HeadCell({ align = 'left', children }) {
    return h('th', {
        style: {
            textAlign: align, padding: '4px 4px', fontWeight: 500,
            whiteSpace: 'nowrap', overflow: 'hidden',
        },
    }, children);
}

function NameCell({ children, title }) {
    return h('td', {
        title,
        style: {
            padding: '4px 4px', overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
    }, children);
}

function NumberCell({ children }) {
    return h('td', {
        style: {
            padding: '4px 4px', textAlign: 'right',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        },
    }, children);
}

function rowStyle(c, { current, pinned, done }) {
    return {
        backgroundColor: pinned ? c.accent + (c.light ? '28' : '3a')
            : current ? c.accent + (c.light ? '14' : '22') : 'transparent',
        color: done ? c.text : (current ? c.accent : c.textDim),
        fontWeight: current || pinned ? 600 : 400,
        borderBottom: `1px solid ${c.border}33`,
        // The bar marks the layer the timeline is on, held or not, so a run
        // moving through the stack is as easy to follow as a layer picked by
        // hand. A held layer is separated from it by the stronger fill.
        boxShadow: current ? `inset 2px 0 0 ${c.accent}` : 'none',
        cursor: 'pointer',
    };
}

function SequenceRows({ c, sp, deposition }) {
    const currentRef = useRef(null);
    // Follow the run down a stack too long to fit the panel. Keyed on the layer
    // rather than the progress, so it scrolls once per layer and does not fight
    // a scroll of your own on every tick.
    useEffect(() => {
        currentRef.current?.scrollIntoView({ block: 'nearest' });
    }, [deposition.layerIdx]);
    return h('tbody', null,
        deposition.activeDep.map((layer, index) => {
            const number = index + 1;
            const pinned = number === deposition.pinnedStep;
            const current = number === deposition.layerIdx;
            const display = materialDisplay(layer);
            return h('tr', {
                key: layer.id,
                ref: current ? currentRef : undefined,
                onClick: () => deposition.selectStep(number),
                title: pinned ? sp.releaseLayer : sp.jumpToLayer,
                style: rowStyle(c, {
                    current,
                    pinned,
                    done: number <= deposition.completedSteps,
                }),
            },
                h(NumberCell, null, number),
                h(NameCell, { title: display }, display),
                h(NumberCell, null, formatNumber(layer.thickness, 2)),
                h(NumberCell, null, formatNumber(deposition.layerTimes[index], 1)),
            );
        }),
        h('tr', { style: { color: c.textDim, fontSize: 10, borderTop: `1px solid ${c.border}` } },
            h('td', { colSpan: 3, style: { padding: '6px 4px', textAlign: 'right' } }, sp.totalTime),
            h(NumberCell, null, formatNumber(deposition.totalTime, 1) + ' s'),
        ),
    );
}

function SequenceTable({ c, sp, deposition }) {
    if (deposition.N === 0) {
        return h('div', { style: { color: c.textDim, padding: '2px 0 8px' } }, sp.noLayers);
    }
    // Up and down walk the stack from wherever the timeline is. Clicking a row
    // focuses this container, so the keys carry on from the layer just picked.
    const walk = (direction) => {
        const from = deposition.pinnedStep ?? deposition.layerIdx;
        const next = Math.min(Math.max(from + direction, 1), deposition.N);
        // selectStep releases a layer asked for twice, which at either end of
        // the list would turn a key press into a release.
        if (next !== deposition.pinnedStep) deposition.selectStep(next);
    };
    return h('div', {
        tabIndex: 0,
        className: 'tfs-keylist',
        'aria-label': sp.sectionSequence,
        onKeyDown: (event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            walk(event.key === 'ArrowDown' ? 1 : -1);
        },
    },
        h(FixedTable, {
            c, columns: SEQUENCE_COLUMNS,
            head: [
                h(HeadCell, { key: 'n', align: 'right' }, sp.layerNum),
                h(HeadCell, { key: 'mat' }, sp.layerMat),
                h(HeadCell, { key: 'thk', align: 'right' }, sp.layerThk),
                h(HeadCell, { key: 'time', align: 'right' }, sp.layerTime),
            ],
        }, h(SequenceRows, { c, sp, deposition })),
    );
}

function RatesTable({ c, sp, setup, layers, materials }) {
    if (materials.length === 0) {
        return h('div', { style: { color: c.textDim, fontSize: 11 } }, sp.noLayers);
    }
    return h(FixedTable, {
        c, columns: RATE_COLUMNS,
        head: [
            h(HeadCell, { key: 'mat' }, sp.layerMat),
            h(HeadCell, { key: 'rate', align: 'right' }, sp.rateNmS),
        ],
    },
        h('tbody', null, materials.map((materialId) => {
            const display = materialDisplay(layers.find(item => item.materialId === materialId));
            return h('tr', { key: materialId },
                h(NameCell, { title: display }, display),
                h(NumberCell, null,
                    h(NumInput, {
                        c, width: 76,
                        value: setup.rates[materialId] != null ? setup.rates[materialId] : 1.0,
                        onChange: value => setup.setRates(previous => ({ ...previous, [materialId]: value })),
                        min: 0.001, max: 1000, step: 0.1,
                    }),
                ),
            );
        })),
    );
}

export function DepositionSidebar({ c, sp, setup, deposition }) {
    return h(SidePanel, { c, width: 300 },
        h(SectionTitle, { c }, sp.sectionSequence),
        h('div', { style: { padding: '0 10px 8px' } },
            h(SequenceTable, { c, sp, deposition }),
        ),
        h('div', { style: { borderTop: `1px solid ${c.border}` } },
            h(SectionTitle, { c }, sp.sectionRates),
            h('div', { style: { padding: '0 10px 8px' } },
                h(RatesTable, { c, sp, setup, layers: deposition.activeDep, materials: deposition.materials }),
            ),
        ),
        h(SidePanelNote, { c }, sp.rateHint),
    );
}
