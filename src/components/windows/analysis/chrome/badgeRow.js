import { ConeBadge, EvalModeBadge } from '../../../SurfaceModeBar.js';
import { EnvironmentSelect } from './environmentChoice.js';

const { createElement: h } = React;

/**
 * The thin row under the plot and over the Results strip. At its left, on a
 * design with environments, the Environment droplist choosing which one the
 * window computes; at its right the read-only badges saying what the result
 * is computed for: the surface, and, in a window that averages over it
 * (`cone`), the illumination cone while one is on. The badges report Design
 * Editor settings rather than offer them, so they stay out of the control row.
 *
 * `environment` is the window's chrome/environmentChoice.js answer; a window
 * with no environment choice passes none and draws no droplist.
 */
export function BadgeRow({ c, t, design, environment, cone = false }) {
    // No border above it and the chart's paper colour, so the row reads as the
    // foot of the plot; the badges are a little shorter than elsewhere so the
    // row takes as little of the plot's height as it can.
    const style = { padding: '1px 8px' };
    return h('div', {
        style: {
            display: 'flex', flexWrap: 'wrap', alignItems: 'center',
            gap: 6, rowGap: 3, padding: '0 10px 3px',
            backgroundColor: c.panel,
            flexShrink: 0, userSelect: 'none',
        },
    },
        environment && h(EnvironmentSelect, { c, t, environment }),
        h('div', { style: { marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 } },
            h(EvalModeBadge, { design, c, t, style }),
            cone && h(ConeBadge, { design, c, t, style }),
        ),
    );
}
