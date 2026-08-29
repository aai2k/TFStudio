/**
 * The panel chrome the Data Exchange windows are built from.
 *
 * These windows are pairs of side panels rather than plots, so they do not use
 * the analysis frame's control row; they do use the same controls, sizes and
 * type from `analysis/chrome`, which is why the pieces here are only layout.
 */

import { FieldLabel } from '../../analysis/chrome/controls.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

// Tabs are Data Exchange navigation rather than analysis settings, which is why
// this one control lives here instead of in the shared analysis chrome.
export function TabBtn({ active, onClick, c, children }) {
    return h('button', {
        type: 'button', onClick, 'aria-pressed': active,
        style: {
            height: 28, padding: '0 12px', border: 'none', borderRadius: 5,
            borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            outline: 'none', cursor: 'pointer', background: active ? c.accent + '20' : 'transparent',
            color: active ? c.text : c.textDim, fontSize: 11, fontWeight: active ? 600 : 500,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    }, children);
}

/** One titled band of a panel, separated from the next by a rule. */
export function PanelSection({ c, title, children }) {
    return h('section', {
        style: {
            padding: '10px', borderBottom: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', gap: 8,
        },
    },
        title && h('div', {
            style: {
                color: c.textDim, fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.06em',
            },
        }, title),
        children,
    );
}

/**
 * A labelled field. The label column is wide enough for the longest of them,
 * "Angle of incidence", so the controls line up down the panel and no label
 * clips into its own input.
 */
export function FieldRow({ c, label, children }) {
    return h('div', {
        style: {
            display: 'grid', gridTemplateColumns: '112px minmax(0, 1fr)',
            gap: 7, alignItems: 'center', minHeight: 28,
        },
    }, h(FieldLabel, { c }, label), h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flexWrap: 'wrap' },
    }, children));
}

/** A row that wraps rather than aligning to a label column. */
export function InlineRow({ c, label, children }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8,
            flexWrap: 'wrap', minHeight: 28,
        },
    }, label && h(FieldLabel, { c }, label), children);
}

/** Text input matching the height and type of the shared number input. */
export function textInputStyle(c) {
    return {
        height: 24, minWidth: 0, flex: 1, boxSizing: 'border-box',
        backgroundColor: c.field, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 3, padding: '0 5px', outline: 'none', fontSize: 11,
        fontFamily: FONT,
    };
}
