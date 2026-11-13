import { ConeBadge, EvalModeBadge, coneText, evalModeWord } from '../../../SurfaceModeBar.js';
import { EnvironmentSelect } from './environmentChoice.js';

const { createElement: h } = React;

// What the badges read: the design of the environment shown, and under All
// the first environment's, with a line per environment for their hovers. The
// Cone badge reads the first environment that computes under a cone, so it
// is there while any of them does.
function badgeDesigns(design, environment, t) {
    const views = environment?.views;
    if (!views || views.length < 2) return { evalOf: views?.[0].design ?? design, coneOf: views?.[0].design ?? design };
    const none = t.environments.noCone;
    return {
        evalOf: views[0].design,
        coneOf: (views.find(view => view.coned) ?? views[0]).design,
        evalDetail: views.map(view => `${view.label}: ${evalModeWord(view.design, t)}`),
        coneDetail: views.map(view => `${view.label}: ${coneText(view.design, t) ?? none}`),
    };
}

/**
 * The thin row under the plot and over the Results strip. At its left, on a
 * design with environments, the Environment droplist choosing which one the
 * window computes; at its right the read-only badges saying what the result
 * is computed for: the surface, and, in a window that averages over it
 * (`cone`), the illumination cone while one is on. The badges report Design
 * Editor settings rather than offer them, so they stay out of the control row.
 *
 * `environment` is the window's chrome/environmentChoice.js answer; a window
 * with no environment choice passes none and draws no droplist. The badges
 * read the environment shown, each environment having a back side and a cone
 * of its own; under All the first environment's, each environment's in their
 * hover. A window that computes one side it chooses itself shows no Eval
 * badge (`evalBadge` false), so its row holds the droplist alone and is drawn
 * only on a design with environments.
 */
export function BadgeRow({ c, t, design, environment, cone = false, evalBadge = true }) {
    if (!evalBadge && !environment?.shown) return null;
    const shown = badgeDesigns(design, environment, t);
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
            evalBadge && h(EvalModeBadge, { design: shown.evalOf, detail: shown.evalDetail, c, t, style }),
            cone && h(ConeBadge, { design: shown.coneOf, detail: shown.coneDetail, c, t, style }),
        ),
    );
}
