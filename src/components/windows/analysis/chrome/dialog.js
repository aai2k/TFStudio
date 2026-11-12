/**
 * The frame of a dialog a window opens over itself: a title bar with a close
 * button, the body, and a bar of buttons along the foot.
 *
 * It does not close on a press beside it. A dialog holds values typed in by
 * hand, and a stray click should not throw them away; the close button and the
 * dialog's own Cancel are the ways out.
 *
 * Two of these can be open at once, such as the curve editor over the dialog
 * that opened it. They share one layer, so the one drawn later is on top.
 */

import { tablerIcon } from '../../../ui/tablerIcons.js';
import { ActionButton } from './controls.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';

function backdropStyle() {
    return {
        position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
        alignItems: 'center', justifyContent: 'center', padding: 18,
        background: 'rgba(0,0,0,0.6)',
    };
}

function panelStyle(c, width, height) {
    return {
        width, height, display: 'flex', flexDirection: 'column',
        borderRadius: 8, border: `1px solid ${c.border}`, background: c.panel, color: c.text,
        boxShadow: '0 12px 42px rgba(0,0,0,.38)', overflow: 'hidden',
        fontFamily: FONT, fontSize: 12,
    };
}

function barStyle(c, edge) {
    return {
        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
        [edge]: `1px solid ${c.border}`, flexShrink: 0,
    };
}

/**
 *   title       the dialog's title, also its accessible name
 *   onClose     the close button in the title bar; a dialog with a Cancel
 *               passes the same handler
 *   closeTitle  the close button's tooltip
 *   width, height  CSS sizes of the panel; height may be left to the content
 *   footer      what the foot bar holds, laid out from the right
 */
export function DialogFrame({ c, title, onClose, closeTitle, width, height, footer, children }) {
    return h('div', {
        role: 'dialog', 'aria-modal': true, 'aria-label': title, style: backdropStyle(),
    }, h('div', { style: panelStyle(c, width, height) },
        h('div', { style: barStyle(c, 'borderBottom') },
            h('h2', { style: { margin: 0, fontSize: 15, flex: 1, minWidth: 0 } }, title),
            h(ActionButton, { c, title: closeTitle, onClick: onClose }, tablerIcon('x', 16)),
        ),
        children,
        footer && h('div', { style: { ...barStyle(c, 'borderTop'), justifyContent: 'flex-end' } }, footer),
    ));
}
