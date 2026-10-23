import { weightingText } from '../../../../utils/physics/integralValues/builtinWeightings.js';
import { customIntegralReference } from './integralModel.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { useNumberField } from '../../../ui/numberField.js';

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
        edit: {
            background: 'transparent', color: c.text,
            border: '1px solid transparent', borderRadius: 2,
            padding: '0 2px', fontSize: 11, width: 60,
            fontVariantNumeric: 'tabular-nums', textAlign: 'right',
            outline: 'none',
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

// Shown beside a band that has no value so the missing value explains itself:
// the weighting's range for a custom band outside it, otherwise the wavelengths
// the spectrum spans. Up to 3 decimals, trailing zeros dropped.
function SpanNote(props) {
    const { result, weighting, c, iv } = props;
    if (result?.covered !== false) return null;
    const outside = !(weighting.lamMin < weighting.lamMax) && weighting.range;
    const [from, to] = outside || result.spectrumSpan || [];
    if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
    const nm = value => String(Number(value.toFixed(3)));
    const note = outside ? iv.weightingSpan : iv.spectrumSpan;
    return h('span', { style: { color: c.warning, marginLeft: 6 } }, note(nm(from), nm(to)));
}

function EditableName(props) {
    const { custom, selected, styles, c, onPatch } = props;
    return h('input', {
        type: 'text', value: custom.label,
        onClick: event => event.stopPropagation(),
        onChange: event => onPatch(custom.key, { label: event.target.value }),
        onFocus: event => { event.target.style.border = `1px solid ${c.border}`; },
        onBlur: event => { event.target.style.border = '1px solid transparent'; },
        style: {
            ...styles.edit, width: 'calc(100% - 4px)', textAlign: 'left',
            color: selected ? c.accent : c.text,
            fontWeight: selected ? 600 : 400,
        },
    });
}

function EditableBand(props) {
    const { custom, styles, c, onPatch, units } = props;
    const stopRow = event => event.stopPropagation();
    const focus = event => { event.target.style.border = `1px solid ${c.border}`; };
    const blur = event => { event.target.style.border = '1px solid transparent'; };
    const from = useNumberField({
        value: custom.band[0], onChange: value => onPatch(custom.key, { band: [value, custom.band[1]] }),
    });
    const to = useNumberField({
        value: custom.band[1], onChange: value => onPatch(custom.key, { band: [custom.band[0], value] }),
    });
    // Leaving the box both takes the value and drops the focus border.
    const bandBox = field => h('input', {
        ...field, onClick: stopRow, onFocus: focus,
        onBlur: event => { blur(event); field.onBlur(); },
        style: { ...styles.edit, width: 56 },
    });
    return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 2 } },
        h('select', {
            value: custom.char, onClick: stopRow,
            onChange: event => onPatch(custom.key, { char: event.target.value }),
            style: { ...styles.edit, width: 38, textAlign: 'left' },
            onFocus: focus, onBlur: blur,
        },
            h('option', { value: 'T' }, 'T'),
            h('option', { value: 'R' }, 'R'),
            h('option', { value: 'A' }, 'A'),
        ),
        bandBox(from),
        h('span', { style: { color: c.textDim } }, '–'),
        bandBox(to),
        h('span', { style: { color: c.textDim, fontSize: 10 } }, units.nm),
    );
}

function RemoveButton(props) {
    const { definition, onRemove, c, iv } = props;
    return h('button', {
        onClick: event => { event.stopPropagation(); onRemove(definition.key); },
        title: iv.removeRow,
        style: {
            padding: '0 6px', cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', verticalAlign: 'middle',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.textDim,
            outline: 'none',
        },
    }, tablerIcon('trash', 13));
}

function ResultRow(props) {
    const { definition, result, index, selected, setSelected, onPatch, onRemove, styles, c, iv, units } = props;
    const custom = definition.builtin ? null : definition._custom;
    const available = Number.isFinite(result?.value);
    const band = definition.weighting.lamMin === definition.weighting.lamMax
        ? '—'
        : `${definition.weighting.lamMin.toFixed(0)}–${definition.weighting.lamMax.toFixed(0)} ${units.nm}`;
    return h('tr', {
        onClick: () => setSelected(definition.key),
        style: {
            cursor: 'pointer',
            background: selected ? c.accent + '22'
                : (index % 2 === 0 ? 'transparent' : c.panel + '55'),
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
        }, custom
            ? h(EditableName, { custom, selected, styles, c, onPatch })
            : definition.label),
        h('td', { style: { ...styles.td, color: available ? c.text : c.warning } },
            valueText(result, available, iv)),
        h('td', { style: { ...styles.td, color: c.textDim } },
            available ? (result.value * 100).toFixed(3) : '—'),
        h('td', { style: { ...styles.td, color: c.textDim } },
            result ? formatMinMax(result.min, result.lamAtMin) : '—'),
        h('td', { style: { ...styles.td, color: c.textDim } },
            result ? formatMinMax(result.max, result.lamAtMax) : '—'),
        h('td', {
            style: { ...styles.td, textAlign: 'left', color: c.textDim, padding: '2px 4px' },
        }, custom
            ? h(EditableBand, { custom, styles, c, onPatch, units })
            : band,
            h(SpanNote, { result, weighting: definition.weighting, c, iv })),
        h('td', { style: { ...styles.td, textAlign: 'center', padding: '0 4px' } },
            custom ? h(RemoveButton, { definition, onRemove, c, iv }) : null),
    );
}

export function ResultsTable(props) {
    const { integrals, results, selectedKey, setSelectedKey, onPatch, onRemove, c, t } = props;
    const iv = t.integralValues;
    const styles = tableStyles(c);
    return h('div', {
        style: { height: 200, overflow: 'auto', background: c.bg, flexShrink: 0 },
    },
        h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
            h('thead', null,
                h('tr', null,
                    h('th', { style: { ...styles.th, textAlign: 'left' } }, iv.col_integral),
                    h('th', { style: styles.th }, iv.col_value),
                    h('th', { style: styles.th }, '%'),
                    h('th', { style: styles.th }, iv.col_min),
                    h('th', { style: styles.th }, iv.col_max),
                    h('th', { style: { ...styles.th, textAlign: 'left' } }, iv.col_band),
                    h('th', { style: { ...styles.th, width: 28 } }, iv.col_actions),
                ),
            ),
            h('tbody', null,
                results
                    ? integrals.map((definition, index) => h(ResultRow, {
                        key: definition.key,
                        definition,
                        result: results[definition.key],
                        index,
                        selected: definition.key === selectedKey,
                        setSelected: setSelectedKey,
                        onPatch,
                        onRemove,
                        styles,
                        c,
                        iv,
                        units: t.units,
                    }))
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
