/**
 * The ordered list of blocks on the left of the Report window: a switch, the
 * block's name and a one-line summary of its settings, and a gear that opens
 * its settings. Rows drag to reorder.
 */

import { Checkbox } from '../../../ui/Checkbox.js';
import { blockName, blockSummary } from './blockText.js';

const { createElement: h, useRef, useState } = React;

const FONT = 'system-ui, -apple-system, sans-serif';
export const RAIL_WIDTH = 300;

const GRIP = h('svg', { width: 8, height: 14, viewBox: '0 0 8 14', fill: 'currentColor' },
    [2, 7, 12].flatMap(cy => [h('circle', { key: `a${cy}`, cx: 2, cy, r: 1.2 }), h('circle', { key: `b${cy}`, cx: 6, cy, r: 1.2 })]));

const GEAR = h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
        d: 'M6.75 1.6h2.5l.32 1.85 1.16.67 1.75-.66 1.25 2.16-1.43 1.22v1.32l1.43 1.22-1.25 2.16-1.75-.66-1.16.67-.32 1.85h-2.5l-.32-1.85-1.16-.67-1.75.66-1.25-2.16 1.43-1.22V7.62L2.27 6.4l1.25-2.16 1.75.66 1.16-.67.32-1.85z',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
    }),
    h('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.2 }));

const PLUS = h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none' },
    h('path', { d: 'M6 1.5v9M1.5 6h9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));

function BlockRow({ c, W, block, index, selected, onToggle, onSelect, drag }) {
    const summary = blockSummary(W, block);
    return h('div', {
        draggable: true,
        onDragStart: event => drag.start(event, index),
        onDragOver: event => event.preventDefault(),
        onDrop: event => drag.drop(event, index),
        title: W.dragToReorder,
        style: {
            display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
            backgroundColor: selected ? c.selected : 'transparent',
            borderBottom: `1px solid ${c.border}55`, opacity: block.on ? 1 : 0.55,
        },
    },
        h('span', { style: { color: c.textDim, display: 'flex', cursor: 'grab', flexShrink: 0 } }, GRIP),
        h(Checkbox, { c, checked: !!block.on, onChange: () => onToggle(block.id), 'aria-label': blockName(W, block.type) }),
        h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12, color: c.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, blockName(W, block.type)),
            summary && h('div', { style: { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, summary),
        ),
        h('button', {
            type: 'button', title: W.settingsTip || blockName(W, block.type), 'aria-pressed': selected,
            onClick: () => onSelect(selected ? null : block.id),
            style: {
                width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
                border: `1px solid ${selected ? c.accent : 'transparent'}`, borderRadius: 5,
                backgroundColor: selected ? c.accent + (c.light ? '20' : '38') : 'transparent',
                color: selected ? c.text : c.textDim, cursor: 'pointer', flexShrink: 0, padding: 0,
            },
        }, GEAR),
    );
}

export function BlockRail({ c, W, blocks, selectedId, onSelect, onToggle, onReorder, addOpen, onToggleAdd }) {
    const dragIndex = useRef(null);
    const [, setTick] = useState(0);
    const drag = {
        start: (event, index) => { dragIndex.current = index; event.dataTransfer.effectAllowed = 'move'; },
        drop: (event, index) => {
            event.preventDefault();
            const from = dragIndex.current;
            dragIndex.current = null;
            if (from != null && from !== index) onReorder(from, index);
            setTick(n => n + 1);
        },
    };
    const on = blocks.filter(b => b.on).length;
    return h('div', {
        style: {
            width: RAIL_WIDTH, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            backgroundColor: c.panel, display: 'flex', flexDirection: 'column', minHeight: 0, fontFamily: FONT,
        },
    },
        h('div', {
            style: {
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 10px 4px',
                fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', userSelect: 'none',
            },
        },
            W.blocks,
            h('span', { style: { fontWeight: 500, textTransform: 'none', letterSpacing: 0 } }, W.blocksOn(on, blocks.length)),
        ),
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            blocks.map((block, index) => h(BlockRow, {
                key: block.id, c, W, block, index, selected: block.id === selectedId, onToggle, onSelect, drag,
            }))),
        h('div', { style: { padding: '8px 10px', borderTop: `1px solid ${c.border}` } },
            h('button', {
                type: 'button', onClick: onToggleAdd, 'aria-expanded': addOpen,
                style: {
                    width: '100%', height: 28, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    border: `1px solid ${addOpen ? c.accent : c.border}`, borderRadius: 6,
                    backgroundColor: addOpen ? c.accent + (c.light ? '20' : '38') : 'transparent',
                    color: c.text, cursor: 'pointer', fontSize: 11, fontWeight: 500, fontFamily: FONT,
                },
            }, PLUS, W.addBlock)),
    );
}
