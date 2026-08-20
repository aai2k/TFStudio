/**
 * The frame an analysis window is assembled in.
 *
 * The plot is what the window is for, so it gets the height. Everything else
 * fits in two thin bands: one control row above the plot, and the collapsed
 * Results strip below it. Two of these windows docked side by side on a laptop
 * screen still show plots worth looking at.
 *
 * What goes where:
 *
 *   control row  the switches that change which curve is drawn — T/R/A, the
 *                quantity, the polarization — plus the notice badge and the
 *                Setup button at the right-hand end.
 *   Setup panel  everything else: ranges, steps, angle of incidence, side,
 *                reference wavelength. See `chrome/popover.js`.
 *   Results      the numbers behind the plot, collapsed by default, with the
 *                export control on its right.
 *
 * There is no status footer. The design's name, layer count and media are the
 * same in every analysis window and are already in the Design Editor; repeating
 * them in each window cost more height than they were worth.
 */

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

/** Outermost element of a window: fills the dock and never scrolls itself. */
export function AnalysisWindow({ c, row = false, children }) {
    return h('div', {
        style: {
            display: 'flex', flexDirection: row ? 'row' : 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
            fontFamily: FONT, fontSize: 12,
        },
    }, children);
}

/**
 * The window's one row of controls. Wraps rather than clips when the window is
 * narrow, and holds its height when the plot is squeezed.
 *
 * Put the curve switches in `children`; pass the notice badge and Setup button
 * as `trailing`, which is pushed to the right-hand end.
 */
export function ControlRow({ c, children, trailing, ...rest }) {
    return h('div', {
        ...rest,
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 5, padding: '5px 10px',
            backgroundColor: c.panel, flexShrink: 0,
            borderBottom: `1px solid ${c.border}`,
        },
    },
        children,
        trailing && h('div', {
            style: {
                marginLeft: 'auto', display: 'flex', alignItems: 'center',
                gap: 6, flexShrink: 0,
            },
        }, trailing),
    );
}

/**
 * A second row that belongs to a mode rather than to the window, such as the
 * target editor. Only ever rendered while that mode is on.
 */
export function ModeRow({ c, children, ...rest }) {
    return h('div', {
        ...rest,
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 8, rowGap: 6, padding: '5px 10px',
            borderBottom: `1px solid ${c.border}`,
            backgroundColor: c.bg, flexShrink: 0,
        },
    }, children);
}

/** The plot itself: takes the space left over and clips rather than scrolls. */
export function PlotArea({ children, relative = false }) {
    return h('div', {
        style: {
            flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
            position: relative ? 'relative' : undefined,
        },
    }, children);
}

/** Stands in for the plot when there is nothing to draw. */
export function CenteredMessage({ c, message }) {
    return h('div', {
        style: {
            flex: 1, minHeight: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontFamily: FONT,
            padding: 16, textAlign: 'center',
        },
    }, message);
}

/** Persistent column of settings beside the plot. */
export function SidePanel({ c, width = 260, children }) {
    return h('div', {
        style: {
            width, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            backgroundColor: c.panel, overflowY: 'auto',
            display: 'flex', flexDirection: 'column',
            fontFamily: FONT,
        },
    }, children);
}

/** Heading over a group of controls inside a `SidePanel`. */
export function SectionTitle({ c, children }) {
    return h('div', {
        style: {
            fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            userSelect: 'none', padding: '10px 10px 4px',
        },
    }, children);
}

/** Explanatory text at the foot of a `SidePanel`. */
export function SidePanelNote({ c, children }) {
    return h('div', {
        style: {
            padding: '8px 10px', marginTop: 'auto', fontSize: 10,
            color: c.textDim, lineHeight: 1.5,
            borderTop: `1px solid ${c.border}`,
        },
    }, children);
}
