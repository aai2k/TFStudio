// The centred "this window cannot be drawn" pane: a warning mark, a title, one
// line of explanation, whatever detail the caller wants under it, and a single
// action. Both the unavailable-materials notice and the window error boundary
// draw one, so the layout lives here and cannot drift between them.
//
// Any extra props are spread onto the root, which is how each caller adds its
// own `data-*` hook for the tests that read the rendered markup.

const { createElement: h } = React;

export function NoticePane({ c, title, body, detail, action, ...attrs }) {
    return h('div', {
        role: 'alert', ...attrs,
        style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 10, height: '100%', padding: 24,
            boxSizing: 'border-box', textAlign: 'center', color: c.text,
            backgroundColor: c.bg, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h('div', { style: { color: c.error, fontSize: 28 } }, '⚠'),
        h('strong', { style: { fontSize: 14 } }, title),
        h('div', { style: { maxWidth: 480, color: c.textDim, fontSize: 12, lineHeight: 1.5 } }, body),
        detail,
        action,
    );
}
