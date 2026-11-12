/**
 * The results strip under the diagram: the colour at each angle as a table in
 * one colour space at a time, or in every space for a single angle, how far
 * each angle's colour is from the first angle's, and a patch of each angle's
 * colour. Under All the same for each environment and angle, the Differences
 * measured against the first environment at the same angle.
 */

import { environmentColor } from '../../../../constants/analysisDefaults.js';
import { RESULT_ROW_HEIGHT, ResultsGrid } from '../../../ui/ResultsSection.js';
import { TabBtn } from '../../../ui/tabBtn.js';
import { SelectField } from '../chrome/controls.js';
import { formatTheta } from '../opticalEvaluation/model.js';
import { exposedRgb, formatValue } from './colorModel.js';
import { acrossEnvironments, tableSpaceOptions } from './resultsModel.js';

const { createElement: h } = React;

// The strip's body is as tall as the results table the other windows open.
const BODY_HEIGHT = 185;
const VIEW_IDS = ['table', 'differences', 'patch'];

// A patch is square and as wide as its share of the row, between these: a
// handful of angles and the reference white share one row, and more wrap onto
// rows the strip scrolls through. The narrowest still has room for its Y.
const PATCH_MIN = 52;
const PATCH_MAX = 84;
const PATCH_GAP = 10;

// Under All (`envRow`) a patch's environment is written over it in its colour,
// cut short to the patch's width, its full name on hover; the reference
// white's line is left blank, so every patch of a row starts level.
function Patch({ c, color, label, sub, env, envRow }) {
    return h('div', {
        style: { minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 },
    },
        envRow && h('div', {
            title: env?.label,
            style: {
                fontSize: 10, fontWeight: 600, color: env?.ink, maxWidth: '100%',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
        }, env?.label ?? ' '),
        h('div', {
            style: {
                width: '100%', aspectRatio: '1 / 1', borderRadius: 6, background: color, boxSizing: 'border-box',
                border: `1px solid ${c.border}`, boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.06)',
            },
        }),
        h('div', { style: { fontSize: 11, color: c.text, fontWeight: 600, textAlign: 'center' } }, label),
        h('div', { style: { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap' } }, sub),
    );
}

// The patches are cells of one grid, so every row holds patches of one size.
// The grid is no wider than its patches at their widest, which keeps a few
// patches together at the left rather than spread across the strip.
function PatchView({ reports, state, ce, c, colors }) {
    const count = reports.length + 1;
    const envRow = Boolean(reports[0].env);
    return h('div', {
        style: { height: BODY_HEIGHT, overflow: 'auto', backgroundColor: c.bg, boxSizing: 'border-box', padding: '12px 14px' },
    },
        h('div', {
            style: {
                display: 'grid', gap: PATCH_GAP, alignItems: 'start',
                gridTemplateColumns: `repeat(auto-fit, minmax(${PATCH_MIN}px, 1fr))`,
                maxWidth: count * PATCH_MAX + (count - 1) * PATCH_GAP,
            },
        },
            reports.map(({ theta, report, env }, index) => h(Patch, {
                key: index, c, color: exposedRgb(report, state.exposure),
                label: `${formatTheta(theta)}°`, sub: `Y = ${formatValue(report.XYZ.Y, 2)}`,
                env: env && { label: env.label, ink: environmentColor(colors, env.number) }, envRow,
            })),
            h(Patch, { c, color: 'rgb(255,255,255)', label: ce.refWhite, sub: state.illuminant, envRow }),
        ),
    );
}

// One angle's Table: a row per colour space, each quantity's name just before
// its value. The pairs keep a common least width, so the short ones line up
// from row to row.
function SpaceList({ rows, c }) {
    return h('div', { style: { height: BODY_HEIGHT, overflowY: 'auto', backgroundColor: c.bg } },
        h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
            h('tbody', null, rows.map((row, index) => h('tr', {
                key: row.id,
                style: { height: RESULT_ROW_HEIGHT, backgroundColor: index % 2 === 0 ? 'transparent' : c.panel + '55' },
            },
                h('td', { style: { width: '1%', whiteSpace: 'nowrap', padding: '2px 16px 2px 8px', color: c.text } }, row.space),
                h('td', { style: { whiteSpace: 'nowrap', padding: '2px 8px', fontVariantNumeric: 'tabular-nums' } },
                    row.pairs.map(pair => h('span', {
                        key: pair.label, style: { display: 'inline-block', minWidth: '13ch', marginRight: 12 },
                    },
                        h('span', { style: { color: c.textDim } }, pair.label),
                        h('span', { style: { color: c.text, marginLeft: 6 } }, pair.value),
                    ))),
            ))),
        ),
    );
}

function ViewTabs({ state, ce, c, single, first, firstEnv }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px', flexWrap: 'wrap',
            borderBottom: `1px solid ${c.border}`, backgroundColor: c.bg,
        },
    },
        VIEW_IDS.map(id => h(TabBtn, {
            key: id, c, active: state.resultsView === id, onClick: () => state.setResultsView(id),
        }, ce.views[id])),
        // One angle's Table shows every space, so there is none to pick.
        state.resultsView === 'table' && !single && h('div', { style: { marginLeft: 'auto', padding: '2px 0' } },
            h(SelectField, {
                value: state.tableSpace, onChange: state.setTableSpace, c, width: 190,
                title: ce.tableSpaceTitle, options: tableSpaceOptions(ce),
            })),
        // What the Differences view measures against: the first angle, or under
        // All the first environment at the same angle.
        state.resultsView === 'differences' && h('span', {
            style: { marginLeft: 'auto', fontSize: 11, color: c.textDim, padding: '0 4px' },
        }, firstEnv ? ce.againstEnvironment(firstEnv) : ce.againstFirst(formatTheta(first))),
    );
}

/**
 * The body of the results strip for the colour at each angle. `table` is what
 * the Table or Differences view shows (resultsModel.js, viewTable), worked out
 * by the window, whose header counts its rows.
 */
export function ResultsViews({ reports, table, state, ce, c, colors }) {
    const single = reports.length === 1;
    let body;
    if (state.resultsView === 'patch') body = h(PatchView, { reports, state, ce, c, colors });
    else if (!table.columns) body = h(SpaceList, { rows: table.rows, c });
    else body = h(ResultsGrid, { ...table, c, height: BODY_HEIGHT });
    const firstEnv = acrossEnvironments(reports) ? reports[0].env.label : null;
    return h(React.Fragment, null,
        h(ViewTabs, { state, ce, c, single, first: reports[0].theta, firstEnv }), body);
}
