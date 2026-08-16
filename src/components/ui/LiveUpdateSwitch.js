import { useDesign } from '../../state/DesignContext.js';

const { createElement: h } = React;

/**
 * Toggles whether open windows follow a running optimizer.
 *
 * The setting is global, so every window showing this switch shows the same
 * state and flipping it anywhere applies everywhere. Turning it off does not
 * stop windows updating on ordinary edits; it only decides how much of a run
 * they draw.
 */
export function LiveUpdateSwitch({ c, label, title }) {
    const { liveUpdate, setLiveUpdate } = useDesign();
    return h('button', {
        onClick: () => setLiveUpdate(!liveUpdate),
        role: 'switch', 'aria-checked': liveUpdate, title,
        style: {
            height: 28, display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '0 2px', border: 'none', backgroundColor: 'transparent',
            color: c.text, cursor: 'pointer', outline: 'none', flexShrink: 0,
            fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    },
        h('span', {
            style: {
                width: 28, height: 16, padding: 2, display: 'flex', alignItems: 'center',
                justifyContent: liveUpdate ? 'flex-end' : 'flex-start', borderRadius: 9,
                backgroundColor: liveUpdate ? c.accent : c.borderStrong,
                transition: 'background-color 0.15s',
            },
        }, h('span', {
            style: {
                width: 12, height: 12, borderRadius: '50%', backgroundColor: c.accentText,
                boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
            },
        })),
        label,
    );
}
