/**
 * The button of an in-window tab strip: one of a row of named pages over a
 * body that switches between them.
 *
 * Distinct from the segmented controls elsewhere in the app, which switch a
 * setting rather than a page, and from the docking tabs, which switch windows.
 *
 * `tour`, when given, is the button's `data-tour` anchor for tutorial steps.
 */

const { createElement: h } = React;

export function TabBtn({ active, onClick, c, title, tour, children }) {
    return h('button', {
        type: 'button', onClick, 'aria-pressed': active, title, 'data-tour': tour,
        style: {
            height: 28, padding: '0 12px', border: 'none', borderRadius: 5,
            borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            outline: 'none', cursor: 'pointer', background: active ? c.accent + '20' : 'transparent',
            color: active ? c.text : c.textDim, fontSize: 11, fontWeight: active ? 600 : 500,
            fontFamily: 'system-ui, -apple-system, sans-serif', userSelect: 'none',
        },
    }, children);
}
