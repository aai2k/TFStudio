/**
 * Under the diagram, a line per angle: a patch of the colour at that angle, at
 * the window's exposure, and the values compared from angle to angle, so they
 * read without opening the results strip. The lines are one table, so each
 * value sits under the same value at the other angles.
 */

import { environmentColor } from '../../../../constants/analysisDefaults.js';
import { formatTheta } from '../opticalEvaluation/model.js';
import { exposedRgb } from './colorModel.js';
import { linePairs } from './resultsModel.js';

const { createElement: h } = React;

// Wider than tall, so the patch reads as a sample of the colour beside its
// numbers rather than as a bullet.
const PATCH = { width: 36, height: 22 };
const CELL_PAD = 3;
// Six lines in view at most, the rest scrolled to, so a long range of angles
// does not take the diagram's room.
const LINES_IN_VIEW = 6;
const LINE_HEIGHT = PATCH.height + 2 * CELL_PAD;
// The strip's padding above and below the lines and its top border, which its
// height includes.
const STRIP_PAD = 6;
const STRIP_BORDER = 1;
const STRIP_EDGES = 2 * STRIP_PAD + STRIP_BORDER;

// The type size of the results tables, and gaps kept small, so a line of eight
// values fits a window docked at half the screen.
export function AngleLines({ reports, exposure, ce, units, c, colors }) {
    const cell = { padding: `${CELL_PAD}px 0`, whiteSpace: 'nowrap', verticalAlign: 'middle' };
    const name = { ...cell, color: c.textDim, paddingRight: 4 };
    const value = { ...cell, color: c.text, textAlign: 'right', paddingRight: 11 };
    // The padding is the gap before the next pair. After the last value it
    // would be blank the strip scrolls sideways to reach.
    const lastValue = { ...value, paddingRight: 0 };
    // Shrinks before the diagram does, down to one line, and scrolls the rest.
    return h('div', {
        style: {
            flex: '0 1 auto', minHeight: LINE_HEIGHT + STRIP_EDGES, maxHeight: LINES_IN_VIEW * LINE_HEIGHT + STRIP_EDGES,
            overflow: 'auto', padding: `${STRIP_PAD}px 8px`,
            borderTop: `${STRIP_BORDER}px solid ${c.border}`, backgroundColor: c.panel,
        },
    },
        h('table', { style: { borderCollapse: 'collapse', fontSize: 11, fontVariantNumeric: 'tabular-nums' } },
            h('tbody', null, reports.map(({ theta, report, env }, index) => h('tr', { key: index },
                // Under All, the environment of the line, in its colour on the diagram.
                env && h('td', {
                    style: { ...cell, paddingRight: 12, fontWeight: 600, color: environmentColor(colors, env.number) },
                }, env.label),
                h('td', { style: { ...cell, paddingRight: 12 } },
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 } },
                        h('span', {
                            style: {
                                ...PATCH, flexShrink: 0, borderRadius: 4,
                                background: exposedRgb(report, exposure), border: `1px solid ${c.border}`,
                            },
                        }),
                        `${formatTheta(theta)}°`)),
                linePairs(report, ce, units).flatMap((pair, i, pairs) => [
                    h('td', { key: `${pair.key}-name`, style: name, title: pair.title }, pair.label),
                    h('td', { key: pair.key, style: i === pairs.length - 1 ? lastValue : value }, pair.value),
                ]),
            ))),
        ),
    );
}
