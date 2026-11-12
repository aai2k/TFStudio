import { environmentColor } from '../../../../constants/analysisDefaults.js';
import { weightingText } from '../../../../utils/physics/integralValues/builtinWeightings.js';
import { customIntegralReference, customIntegralWeighting } from './integralModel.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';

const { createElement: h } = React;

function tableStyles(c) {
    return {
        th: {
            padding: '4px 8px', fontWeight: 600, fontSize: 11,
            borderBottom: `1px solid ${c.border}`,
            position: 'sticky', top: 0, backgroundColor: c.panel,
            textAlign: 'right', whiteSpace: 'nowrap', color: c.textDim,
        },
        td: {
            padding: '3px 8px', fontSize: 11,
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', textAlign: 'right',
        },
    };
}

function formatMinMax(value, wavelength) {
    return Number.isFinite(value) && Number.isFinite(wavelength)
        ? `${(value * 100).toFixed(2)}% @${wavelength.toFixed(0)}`
        : '—';
}

function valueText(result, available, iv) {
    if (!result) return '—';
    return available ? result.value.toFixed(5) : iv.notAvailable;
}

// A wavelength as written in the table: up to 3 decimals, trailing zeros dropped.
const nm = value => String(Number(value.toFixed(3)));

// Shown beside a band that has no value so the missing value explains itself:
// the weighting's range for a custom band outside it, otherwise the wavelengths
// the spectrum spans.
function SpanNote(props) {
    const { result, weighting, c, iv } = props;
    if (result?.covered !== false) return null;
    const outside = !(weighting.lamMin < weighting.lamMax) && weighting.range;
    const [from, to] = outside || result.spectrumSpan || [];
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const note = outside ? iv.weightingSpan : iv.spectrumSpan;
    return h('span', { style: { color: c.warning, marginLeft: 6 } }, note(nm(from), nm(to)));
}

// A built-in row's band is its weighting's; a custom row's is the band it was
// given, also when its weighting does not reach it.
function bandText(definition, custom, units) {
    if (custom) return `${nm(custom.band[0])}–${nm(custom.band[1])} ${units.nm}`;
    const { lamMin, lamMax } = definition.weighting;
    return lamMin === lamMax ? '—' : `${lamMin.toFixed(0)}–${lamMax.toFixed(0)} ${units.nm}`;
}

// The name of a custom row, then dimmed what it integrates.
function CustomName({ custom, c, iv }) {
    return h(React.Fragment, null,
        custom.label,
        h('span', { style: { color: c.textDim, fontWeight: 400, marginLeft: 10 } },
            customIntegralWeighting(custom, iv.customReference)),
    );
}

function RowButton({ icon, title, onClick, c }) {
    return h('button', {
        type: 'button', title,
        onClick: event => { event.stopPropagation(); onClick(); },
        style: {
            padding: '0 6px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.textDim,
            outline: 'none',
        },
    }, tablerIcon(icon, 13));
}

function CustomRowButtons({ definition, onEdit, onRemove, c, iv }) {
    return h('span', { style: { display: 'inline-flex', gap: 4 } },
        h(RowButton, { icon: 'pencil', title: iv.editRow, onClick: () => onEdit(definition.key), c }),
        h(RowButton, { icon: 'trash', title: iv.removeRow, onClick: () => onRemove(definition.key), c }),
    );
}

// An environment's name after a square of its colour on the plot.
function EnvironmentName({ env, colors }) {
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h('span', {
            style: { width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: environmentColor(colors, env.number) },
        }),
        env.label);
}

// A result's cells: the weighted average, as a fraction and in percent, and
// the lowest and highest value over the band.
function valueCells(result, styles, c, iv) {
    const available = Number.isFinite(result?.value);
    const dim = { ...styles.td, color: c.textDim };
    return [
        h('td', { key: 'value', style: { ...styles.td, color: available ? c.text : c.warning } },
            valueText(result, available, iv)),
        h('td', { key: 'percent', style: dim }, available ? (result.value * 100).toFixed(3) : '—'),
        h('td', { key: 'min', style: dim }, result ? formatMinMax(result.min, result.lamAtMin) : '—'),
        h('td', { key: 'max', style: dim }, result ? formatMinMax(result.max, result.lamAtMax) : '—'),
    ];
}

// A row's background: the selection's, or every other integral shaded.
const rowShade = (selected, index, c) => {
    if (selected) return c.accent + '22';
    return index % 2 === 0 ? 'transparent' : c.panel + '55';
};

// One row of an integral. Under All an integral has a row per environment,
// `env` naming it: the integral's name, its band with the note on a band the
// spectrum does not span, which every environment shares on one grid, and its
// buttons go on its first row (`first`); the first row of each integral after
// the first is ruled off from the one above, and every row of the integral is
// selected with it.
function ResultRow(props) {
    const { definition, result, env, first = true, index, selected, setSelected, onEdit, onRemove, styles, c, colors, iv, units } = props;
    const custom = definition.builtin ? null : definition._custom;
    const name = custom ? h(CustomName, { custom, c, iv }) : definition.label;
    return h('tr', {
        onClick: () => setSelected(definition.key),
        // A custom row opens its dialog on a double-click, as its pencil does.
        onDoubleClick: custom ? () => onEdit(definition.key) : undefined,
        style: {
            cursor: 'pointer',
            background: rowShade(selected, index, c),
            borderTop: env && first && index > 0 ? `1px solid ${c.border}` : undefined,
        },
        title: custom
            ? customIntegralReference(custom, iv.customReference)
            : weightingText(definition.weighting, iv.weightings).reference,
    },
        h('td', {
            style: {
                ...styles.td, textAlign: 'left',
                color: selected ? c.accent : c.text,
                fontWeight: selected ? 600 : 400,
            },
        }, first ? name : null),
        env && h('td', { style: { ...styles.td, textAlign: 'left', color: c.text } }, h(EnvironmentName, { env, colors })),
        ...valueCells(result, styles, c, iv),
        h('td', {
            style: { ...styles.td, textAlign: 'left', color: c.textDim, padding: '2px 4px' },
        }, first && bandText(definition, custom, units),
            first && h(SpanNote, { result, weighting: definition.weighting, c, iv })),
        h('td', { style: { ...styles.td, textAlign: 'center', padding: '0 4px' } },
            first && custom ? h(CustomRowButtons, { definition, onEdit, onRemove, c, iv }) : null),
    );
}

// The rows of every integral: one each, or under All (`sets`) one per
// environment, each integral's environments together.
function tableRows({ integrals, results, sets, selectedKey, ...shared }) {
    const row = (definition, index, result, env = null, first = true) => h(ResultRow, {
        ...shared, key: env ? `${definition.key}-${env.number}` : definition.key,
        definition, result, env, first, index, selected: definition.key === selectedKey,
    });
    if (sets) {
        return integrals.flatMap((definition, index) =>
            sets.map((set, k) => row(definition, index, set.results[definition.key], set.env, k === 0)));
    }
    return integrals.map((definition, index) => row(definition, index, results[definition.key]));
}

/**
 * The integrals and their values. A click selects a row for the plot; a custom
 * row's pencil or a double-click on it calls `onEdit(key)`, and its trash
 * `onRemove(key)`. Under All, `sets` holds each environment's `{ env, results }`
 * and the table lists every integral in each, the environment in a column of
 * its own after the integral.
 */
export function ResultsTable(props) {
    const { integrals, results, sets, colors, selectedKey, setSelectedKey, onEdit, onRemove, c, t } = props;
    const iv = t.integralValues;
    const styles = tableStyles(c);
    const header = (label, extra = {}) => h('th', { style: { ...styles.th, ...extra } }, label);
    return h('div', {
        style: { height: 200, overflow: 'auto', background: c.bg, flexShrink: 0 },
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null,
                h('tr', null,
                    header(iv.col_integral, { textAlign: 'left' }),
                    sets && header(t.environments.environment, { textAlign: 'left' }),
                    header(iv.col_value),
                    header('%'),
                    header(iv.col_min),
                    header(iv.col_max),
                    header(iv.col_band, { textAlign: 'left' }),
                    header(iv.col_actions, { width: 28 }),
                ),
            ),
            h('tbody', null,
                results
                    ? tableRows({
                        integrals, results, sets, selectedKey,
                        setSelected: setSelectedKey, onEdit, onRemove, styles, c, colors, iv, units: t.units,
                    })
                    : h('tr', null,
                        h('td', {
                            colSpan: 7,
                            style: { ...styles.td, color: c.textDim, padding: 16, textAlign: 'center' },
                        }, iv.computing),
                    ),
            ),
        ),
    );
}
