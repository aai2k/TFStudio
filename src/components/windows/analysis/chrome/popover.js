/**
 * The panels that hang off an analysis window's control row.
 *
 * An analysis window gives its height to the plot. Only the switches that
 * change which curve is drawn stay on the row; everything else — ranges, steps,
 * angle of incidence, side, reference wavelength — lives in the settings panel,
 * and anything the result needs qualifying with lives in the notice badge. Two
 * docked windows then fit on a laptop screen with the plots still readable.
 *
 * Both panels open over the plot rather than pushing it down, so opening one
 * never resizes the chart underneath. Inside a panel, a control that only
 * applies in one state is disabled rather than removed: a panel that changes
 * size when a checkbox is ticked moves everything under the pointer.
 */

import { DesignContext } from '../../../../state/DesignContext.js';
import { useAnalysisSettings } from '../../../../state/AnalysisSettingsContext.js';
import {
    canSaveWindowDefaults, hasSavedWindowDefaults,
    restoreWindowDefaults, saveWindowDefaults,
} from '../../../../utils/windowDefaults.js';

const { createElement: h, useContext, useState } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

function panelStyle(c, width) {
    return {
        position: 'absolute', right: 0, top: 32, zIndex: 50,
        minWidth: width, maxWidth: 420, maxHeight: 420, overflowY: 'auto',
        padding: 10, backgroundColor: c.panel,
        border: `1px solid ${c.border}`, borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)',
        fontFamily: FONT, fontSize: 11, color: c.text,
    };
}

function triggerStyle(c, { open, tone }) {
    const accent = tone || c.accent;
    return {
        height: 28, padding: '0 9px', display: 'inline-flex', alignItems: 'center', gap: 5,
        border: `1px solid ${open ? accent : c.border}`, borderRadius: 6, outline: 'none',
        backgroundColor: open ? accent + (c.light ? '20' : '38') : 'transparent',
        color: tone || c.text, cursor: 'pointer',
        fontSize: 11, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap',
    };
}

/**
 * Button that opens a panel anchored under its right-hand edge.
 *
 *   width  minimum panel width; the content may widen it up to 420 px
 *   tone   colour for a button that reports a condition rather than settings
 */
export function PopoverButton({ c, label, title, tone, width = 250, icon, children }) {
    const [open, setOpen] = useState(false);
    return h('div', { style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            type: 'button', title, 'aria-expanded': open,
            onClick: () => setOpen(current => !current),
            style: triggerStyle(c, { open, tone }),
        },
            icon,
            label,
            h('svg', { width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none' },
                h('path', {
                    d: 'M2 3.5l3 3 3-3', stroke: 'currentColor',
                    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
                })),
        ),
        // Full-viewport catcher: a click anywhere else closes the panel.
        open && h('div', {
            onClick: () => setOpen(false),
            style: { position: 'fixed', inset: 0, zIndex: 49 },
        }),
        open && h('div', { style: panelStyle(c, width) }, children),
    );
}

// A cog: teeth around a hub, not spokes radiating from a disc.
const GEAR = h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
    h('path', {
        d: 'M6.75 1.6h2.5l.32 1.85 1.16.67 1.75-.66 1.25 2.16-1.43 1.22v1.32l1.43 1.22-1.25 2.16-1.75-.66-1.16.67-.32 1.85h-2.5l-.32-1.85-1.16-.67-1.75.66-1.25-2.16 1.43-1.22V7.62L2.27 6.4l1.25-2.16 1.75.66 1.16-.67.32-1.85z',
        stroke: 'currentColor', strokeWidth: 1.2, strokeLinejoin: 'round',
    }),
    h('circle', { cx: 8, cy: 8, r: 2.1, stroke: 'currentColor', strokeWidth: 1.2 }));

function footerButtonStyle(c, enabled) {
    return {
        flex: 1, height: 26, padding: '0 8px',
        border: `1px solid ${c.border}`, borderRadius: 5,
        backgroundColor: 'transparent', color: enabled ? c.text : c.textDim,
        cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
        fontSize: 11, fontWeight: 500, fontFamily: FONT, whiteSpace: 'nowrap',
    };
}

/**
 * Save the panel above as the values this window opens with, or go back to the
 * shipped ones. The values are written to the preferences file, which lives in
 * Documents rather than in the app's data folder, so they survive a reinstall.
 */
function DefaultsFooter({ c, t, windowId }) {
    const designCtx = useContext(DesignContext);
    const analysisSettings = useAnalysisSettings();
    const text = t.analysisChrome;
    const stored = hasSavedWindowDefaults(windowId, analysisSettings);
    const error = analysisSettings?.saveError;

    return h('div', {
        style: {
            marginTop: 8, paddingTop: 8, borderTop: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', gap: 6,
        },
    },
        h('div', { style: { display: 'flex', gap: 6 } },
            h('button', {
                type: 'button', title: text.saveDefaultsTip,
                onClick: () => saveWindowDefaults(windowId, designCtx?.design, analysisSettings),
                style: footerButtonStyle(c, true),
            }, text.saveDefaults),
            h('button', {
                type: 'button', title: text.restoreDefaultsTip, disabled: !stored,
                onClick: () => restoreWindowDefaults(windowId, analysisSettings),
                style: footerButtonStyle(c, stored),
            }, text.restoreDefaults),
        ),
        // These are the same values Settings → Analysis edits, so the same
        // message is shown here when the write fails.
        error && h('div', { role: 'alert', style: { color: c.error, lineHeight: 1.4 } },
            error === 'unavailable' ? text.defaultsUnavailable : text.defaultsFailed(error)),
    );
}

/** The window's settings, everything that is not a curve switch. */
export function SettingsMenu({ c, t, windowId, label, title, width, children }) {
    const defaults = windowId && t && canSaveWindowDefaults(windowId)
        ? h(DefaultsFooter, { c, t, windowId })
        : null;
    return h(PopoverButton, { c, label, title: title || label, width, icon: GEAR },
        children, defaults);
}

/**
 * One setting inside a settings panel: its name, then its control. The name column
 * is fixed so the controls line up down the panel.
 *
 * A row keeps its controls on one line and lets the panel widen to fit them; a
 * range broken across two lines is harder to read than a wider panel. Pass
 * `wrap` for a row whose control is a growing list, such as the angle chips.
 */
export function SettingRow({ c, label, wrap = false, children }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '3px 0', minHeight: 28,
        },
    },
        h('span', {
            style: {
                width: 68, flexShrink: 0, color: c.textDim,
                fontSize: 11, fontWeight: 500,
            },
        }, label),
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 6,
                flexWrap: wrap ? 'wrap' : 'nowrap',
                minWidth: 0, flex: 1,
            },
        }, children),
    );
}

/** Rule between groups of settings in a settings panel. */
export function SettingDivider({ c }) {
    return h('div', { style: { height: 1, background: c.border, margin: '6px 0' } });
}

/**
 * Conditions attached to the result: a material evaluated outside its data
 * range, a derivative taken across a table knot, samples off the vertical
 * scale. Renders nothing when there are none, so a clean result costs no room.
 *
 *   notices  [{ label, detail, tone? }] - `tone` overrides the warning colour
 */
export function NoticeBadge({ c, notices, label }) {
    const items = (notices || []).filter(Boolean);
    if (!items.length) return null;
    const colorFor = tone => tone === 'error' ? c.error
        : tone === 'success' ? c.success
        : tone === 'info' ? c.accent
        : (tone && tone !== 'warning' ? tone : c.warning);
    const badgeNotice = items.find(notice => notice.tone === 'error')
        || items.find(notice => !notice.tone || notice.tone === 'warning')
        || items[0];
    const tone = colorFor(badgeNotice.tone);
    return h(PopoverButton, {
        c, tone, width: 280,
        label: `${items.length}`,
        title: label,
        icon: h('span', { style: { fontSize: 13, lineHeight: 1 } }, '⚠'),
    },
        items.map((notice, index) => h('div', {
            key: index,
            style: {
                padding: '5px 0',
                borderTop: index ? `1px solid ${c.border}` : undefined,
            },
        },
            h('div', { style: { fontWeight: 600, color: colorFor(notice.tone) } },
                notice.label),
            notice.detail && h('div', {
                style: { marginTop: 2, color: c.textDim, lineHeight: 1.45 },
            }, notice.detail),
        )),
    );
}
