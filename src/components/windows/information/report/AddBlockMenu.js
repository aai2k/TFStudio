/**
 * The list a new block is added from, grouped the way the ribbon groups the
 * windows. Each entry shows the settings it would copy from its window right
 * now. The built-in blocks are already in the report and only listed.
 */

import { BLOCK_TYPES, newBlock } from '../../../../utils/report/blocks.js';
import { blockName, blockSummary } from './blockText.js';
import { settingsFromWindow } from './blockSources.js';
import { overlayPanelStyle, OverlayCatcher } from './BlockSettings.js';

const { createElement: h } = React;

const GROUPS = ['builtin', 'analysis', 'tolerance', 'production', 'design', 'other'];

const PLUS = h('svg', { width: 11, height: 11, viewBox: '0 0 12 12', fill: 'none' },
    h('path', { d: 'M6 1.5v9M1.5 6h9', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));
const TICK = h('svg', { width: 10, height: 10, viewBox: '0 0 10 10', fill: 'none' },
    h('path', { d: 'M2 5.2l2.2 2.2L8 3', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));

function Entry({ c, W, spec, design, onAdd }) {
    const preview = spec.builtin ? null : newBlock(spec.type, settingsFromWindow(spec.type, design));
    const summary = preview ? blockSummary(W, preview) : '';
    return h('button', {
        type: 'button', disabled: spec.builtin,
        onClick: () => onAdd(spec.type),
        style: {
            width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '4px 4px', minHeight: 28,
            border: 'none', borderRadius: 4, backgroundColor: 'transparent', textAlign: 'left',
            cursor: spec.builtin ? 'default' : 'pointer', color: c.text, fontFamily: 'inherit',
        },
    },
        h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { style: { fontSize: 12, color: spec.builtin ? c.textDim : c.text } }, blockName(W, spec.type)),
            summary && h('div', { style: { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, summary)),
        spec.builtin
            ? h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: c.textDim, flexShrink: 0 } }, TICK, W.inReport)
            : h('span', { style: { display: 'flex', color: c.accent, flexShrink: 0 } }, PLUS),
    );
}

export function AddBlockMenu({ c, W, design, onAdd, onClose }) {
    return [
        h(OverlayCatcher, { key: 'catcher', onClose }),
        h('div', { key: 'panel', style: overlayPanelStyle(c, 380) },
            h('div', { style: { fontSize: 12, fontWeight: 600, paddingBottom: 4 } }, W.addBlock),
            GROUPS.map(group => [
                h('div', {
                    key: `${group}-title`,
                    style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', padding: '8px 4px 3px' },
                }, W.groups[group]),
                ...BLOCK_TYPES.filter(spec => spec.group === group).map(spec =>
                    h(Entry, { key: spec.type, c, W, spec, design, onAdd: type => { onAdd(type); onClose(); } })),
            ]),
            h('div', { style: { marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}`, fontSize: 10, color: c.textDim, lineHeight: 1.5 } }, W.sourceHint),
        ),
    ];
}
