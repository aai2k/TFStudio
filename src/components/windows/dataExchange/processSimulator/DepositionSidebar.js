/**
 * The deposition sequence and the per-material rates.
 *
 * The sequence table is also the window's selector: clicking a layer moves the
 * timeline to it and holds it, and the chart follows what is held. On witness
 * chips the table carries the chip each layer is monitored on, editable, and
 * shared with the Monitor Worksheet, and the chips themselves are set up above
 * it: the panel has a fixed width, so these controls stay put when the window
 * is resized.
 */

import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { ActionButton, NumInput } from '../../analysis/chrome/controls.js';
import { SectionTitle, SidePanel, SidePanelNote } from '../../analysis/chrome/layout.js';
import { MaterialPicker } from '../../../ui/MaterialPicker.js';

const { createElement: h, useEffect, useRef } = React;

// Fixed column widths. Material names run from "SiO2" to "Ta2O5 (Peleng 2024)",
// and an auto-sized table redraws every column as the current layer changes, so
// the numbers move under the pointer while a run plays.
// Leave enough room for the localized thickness heading; 66 px clipped the
// English "Thickness (nm)" after the first unit character.
const SEQUENCE_COLUMNS = [26, null, 86, 54];
const CHIP_SEQUENCE_COLUMNS = [26, 50, null, 86, 54];
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

// The chip a layer is monitored on. The input takes the click: editing a chip
// number is not a request to move the timeline.
function ChipCell({ c, layer, chips }) {
    return h('td', {
        onClick: event => event.stopPropagation(),
        style: { padding: '2px 4px', textAlign: 'right' },
    },
        h(NumInput, {
            c, width: 40, value: layer.chip, min: 1, max: 10000, step: 1,
            onChange: value => chips.setChipForStep(layer.step, value),
        }),
    );
}

/** One setting in the side panel: its name, then its control, lined up down the panel. */
function SideField({ c, label, title, children }) {
    return h('div', {
        title,
        style: { display: 'flex', alignItems: 'center', gap: 6, padding: '2px 10px', minHeight: 28 },
    },
        h('span', {
            style: { width: 100, flexShrink: 0, color: c.textDim, fontSize: 11, fontWeight: 500 },
        }, label),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 } },
            children),
    );
}

// The witness chips the run is read on: how many layers go on one, what glass
// it is, and how much thicker it coats than the part. Shared with the Monitor
// Worksheet, so the chip glass follows the design substrate until another
// material is picked, and the reset appears only while it is overridden.
function ChipSetup({ c, t, sp, chips, design }) {
    return h('div', { style: { paddingBottom: 6 } },
        h(SideField, { c, label: sp.layersPerChip },
            h(NumInput, {
                c, width: 56, value: chips.layersPerChip, min: 1,
                max: ANALYSIS_DEFAULTS.monitorWorksheet.numbers.layersPerChip.max, step: 1,
                onChange: chips.setLayersPerChip,
            }),
        ),
        h(SideField, { c, label: sp.chipGlass, title: sp.chipGlassHint },
            h('div', { style: { flex: 1, minWidth: 0 } },
                h(MaterialPicker, {
                    value: chips.chipMaterial || design?.substrate?.material || 'builtin:BK7',
                    onChange: chips.setChipMaterial,
                    c, t, compact: true,
                }),
            ),
            chips.chipMaterial ? h(ActionButton, {
                c, label: sp.chipGlassReset, title: sp.chipGlassHint,
                onClick: () => chips.setChipMaterial(null),
            }) : null,
        ),
        h(SideField, { c, label: sp.witnessRatio, title: sp.witnessRatioHint },
            h(NumInput, {
                c, width: 60, value: chips.witnessRatio, min: 0.05, max: 10, step: 0.01,
                onChange: chips.setWitnessRatio,
            }),
        ),
    );
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

function SequenceRows({ c, sp, deposition, chips }) {
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
                chips ? h(ChipCell, { c, layer, chips }) : null,
                h(NameCell, { title: display }, display),
                h(NumberCell, null, formatNumber(layer.thickness, 2)),
                h(NumberCell, null, formatNumber(deposition.layerTimes[index], 1)),
            );
        }),
        h('tr', { style: { color: c.textDim, fontSize: 10, borderTop: `1px solid ${c.border}` } },
            h('td', { colSpan: chips ? 4 : 3, style: { padding: '6px 4px', textAlign: 'right' } }, sp.totalTime),
            h(NumberCell, null, formatNumber(deposition.totalTime, 1) + ' s'),
        ),
    );
}

function SequenceTable({ c, sp, deposition, chips }) {
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
            c, columns: chips ? CHIP_SEQUENCE_COLUMNS : SEQUENCE_COLUMNS,
            head: [
                h(HeadCell, { key: 'n', align: 'right' }, sp.layerNum),
                chips ? h(HeadCell, { key: 'chip', align: 'right' }, sp.layerChip) : null,
                h(HeadCell, { key: 'mat' }, sp.layerMat),
                h(HeadCell, { key: 'thk', align: 'right' }, sp.layerThk),
                h(HeadCell, { key: 'time', align: 'right' }, sp.layerTime),
            ],
        }, h(SequenceRows, { c, sp, deposition, chips })),
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

export function DepositionSidebar({ c, t, sp, setup, deposition, design, chips }) {
    return h(SidePanel, { c, width: 300 },
        chips ? h(SectionTitle, { c }, sp.modeChips) : null,
        chips ? h(ChipSetup, { c, t, sp, chips, design }) : null,
        h(SectionTitle, { c }, sp.sectionSequence),
        h('div', { style: { padding: '0 10px 8px' } },
            h(SequenceTable, { c, sp, deposition, chips }),
        ),
        chips ? h(SidePanelNote, { c }, sp.chipPlanHint) : null,
        h('div', { style: { borderTop: `1px solid ${c.border}` } },
            h(SectionTitle, { c }, sp.sectionRates),
            h('div', { style: { padding: '0 10px 8px' } },
                h(RatesTable, { c, sp, setup, layers: deposition.activeDep, materials: deposition.materials }),
            ),
        ),
        h(SidePanelNote, { c }, sp.rateHint),
    );
}
