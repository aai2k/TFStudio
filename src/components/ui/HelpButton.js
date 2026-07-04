const { createElement: h, useState } = React;

// Small "?" button — opens the bundled help site in the default browser,
// scrolled to the page for `anchor` (a Starlight slug like
// 'analysis/optical-evaluation'). Locale follows the app's current language;
// fall back to 'en' if a per-locale page is missing.
//
// Placement: tab-bar right corner (DockingLayout) + Help ribbon button +
// MenuBar's Help → Documentation. Sized for a 30px tab bar.
export function HelpButton({ c, anchor, locale, size, title }) {
    const [hov, setHov] = useState(false);
    const d = size || 18;

    const onClick = (e) => {
        e && e.stopPropagation && e.stopPropagation();
        if (window.electronAPI && window.electronAPI.openHelp) {
            window.electronAPI.openHelp({ anchor: anchor || 'index', locale: locale || 'en' });
        }
    };

    return h('button', {
        onClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        title: title || 'Help for this feature',
        style: {
            width: d, height: d, padding: 0,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            border: `1px solid ${hov ? c.accent : c.border}`,
            borderRadius: '50%',
            backgroundColor: hov ? c.accent + '22' : 'transparent',
            color: hov ? c.accent : c.textDim,
            fontSize: Math.round(d * 0.62),
            fontFamily: 'system-ui, -apple-system, sans-serif',
            fontWeight: 600,
            lineHeight: 1,
            cursor: 'pointer',
            outline: 'none',
            transition: 'background-color 0.1s, color 0.1s, border-color 0.1s',
            flexShrink: 0,
            userSelect: 'none'
        }
    }, '?');
}
