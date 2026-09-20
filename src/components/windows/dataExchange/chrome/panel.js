/**
 * The panel chrome the Data Exchange windows are built from.
 *
 * These windows are pairs of side panels rather than plots, so they do not use
 * the analysis frame's control row; they do use the same controls, sizes and
 * type from `analysis/chrome`, which is why the pieces here are only layout.
 */

import { ActionButton, FieldLabel } from '../../analysis/chrome/controls.js';
import { startDividerDrag } from '../../../ui/dividerDrag.js';

const { createElement: h, useCallback, useRef } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

// Tab strips are not Data Exchange's alone, so the button itself is shared.
export { TabBtn } from '../../../ui/tabBtn.js';

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
 * The Open file button, the name of the file it opened, and a line saying
 * what the window loads. The same on every import tab.
 */
export function ImportFilePanel({ c, title, label, onImport, loading, disabled, fileName, hint }) {
    return h(PanelSection, { c, title },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(ActionButton, { c, label, onClick: onImport, disabled: loading || disabled }),
            fileName && h('span', {
                title: fileName,
                style: {
                    minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap', color: c.textDim, fontSize: 11,
                },
            }, fileName),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10.5, lineHeight: 1.45 } }, hint),
    );
}

// The width the panel opens at, matching the `.tfs-spectrum-import-sidebar`
// fallback so a window that never touches the divider looks the same as one
// that has no divider at all.
const PANEL_WIDTH = 380;
// Under this the panel's rows no longer fit: a label column plus the widest
// control on one row.
const PANEL_MIN_WIDTH = 340;
// The share of the window the plot keeps, so the divider cannot push it away.
const PLOT_MIN_SHARE = 0.4;
// What `.tfs-spectrum-import-sidebar` reads its width from, so the two import
// windows keep one set of layout rules between them.
const WIDTH_VAR = '--tfs-import-panel-width';

function clampPanelWidth(container, requested) {
    const max = Math.max(PANEL_MIN_WIDTH, container.getBoundingClientRect().width * (1 - PLOT_MIN_SHARE));
    return Math.min(max, Math.max(PANEL_MIN_WIDTH, requested));
}

/**
 * An import tab's two halves: the panel at a width the user sets by dragging
 * the divider, and the plot taking the rest.
 *
 * The panel holds fields of fixed sizes, so it is sized in pixels rather than
 * as a share of the window, and keeps a floor under which its rows would stop
 * fitting. `panelWidth` is kept in the window's session so the split survives
 * a remount, and is null until the user has dragged anything.
 */
export function ImportLayout({ c, panelWidth, onPanelWidthChange, children }) {
    const [panel, plot] = Array.isArray(children) ? children : [children];
    const containerRef = useRef(null);
    const width = panelWidth || PANEL_WIDTH;

    const startDrag = useCallback((event) => {
        const container = containerRef.current;
        if (!container) return;
        const startX = event.clientX;
        startDividerDrag(event, {
            axis: 'h',
            track: (move) => {
                const next = clampPanelWidth(container, width + move.clientX - startX);
                container.style.setProperty(WIDTH_VAR, `${next}px`);
                return next;
            },
            commit: value => onPanelWidthChange?.(value),
        });
    }, [width, onPanelWidthChange]);

    return h('div', {
        ref: containerRef,
        className: 'tfs-spectrum-import-layout',
        style: { flex: 1, [WIDTH_VAR]: `${width}px` },
    },
        h('div', { className: 'tfs-spectrum-import-sidebar' }, panel),
        h('div', {
            onMouseDown: startDrag,
            style: {
                width: 5, flexShrink: 0, cursor: 'col-resize',
                backgroundColor: c.border, transition: 'background-color 0.12s',
            },
            onMouseEnter: (hover) => { hover.currentTarget.style.backgroundColor = c.accent; },
            onMouseLeave: (hover) => { hover.currentTarget.style.backgroundColor = c.border; },
        }),
        h('div', { className: 'tfs-spectrum-import-preview' }, plot),
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
