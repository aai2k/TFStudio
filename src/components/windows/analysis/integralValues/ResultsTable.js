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
    const { custom, styles, c, onPatch } = props;
    const stopRow = event => event.stopPropagation();
    const focus = event => { event.target.style.border = `1px solid ${c.border}`; };
    const blur = event => { event.target.style.border = '1px solid transparent'; };
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
        h('input', {
            type: 'number', value: custom.band[0], onClick: stopRow,
            onChange: event => {
                const value = parseFloat(event.target.value);
                if (Number.isFinite(value)) onPatch(custom.key, { band: [value, custom.band[1]] });
            },
            onFocus: focus, onBlur: blur,
            style: { ...styles.edit, width: 56 },
        }),
        h('span', { style: { color: c.textDim } }, '–'),
        h('input', {
            type: 'number', value: custom.band[1], onClick: stopRow,
            onChange: event => {
                const value = parseFloat(event.target.value);
                if (Number.isFinite(value)) onPatch(custom.key, { band: [custom.band[0], value] });
            },
            onFocus: focus, onBlur: blur,
            style: { ...styles.edit, width: 56 },
        }),
        h('span', { style: { color: c.textDim, fontSize: 10 } }, 'nm'),
    );
}

function RemoveButton(props) {
    const { definition, onRemove, c, iv } = props;
    return h('button', {
        onClick: event => { event.stopPropagation(); onRemove(definition.key); },
        title: iv.removeRow,
        style: {
            padding: '0 6px', fontSize: 11, cursor: 'pointer',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.textDim,
            outline: 'none',
        },
    }, '×');
}

function ResultRow(props) {
    const { definition, result, index, selected, setSelected, onPatch, onRemove, styles, c, iv } = props;
    const custom = definition.builtin ? null : definition._custom;
    const band = definition.weighting.lamMin === definition.weighting.lamMax
        ? '—'
        : `${definition.weighting.lamMin.toFixed(0)}–${definition.weighting.lamMax.toFixed(0)} nm`;
    return h('tr', {
        onClick: () => setSelected(definition.key),
        style: {
            cursor: 'pointer',
            background: selected ? c.accent + '22'
                : (index % 2 === 0 ? 'transparent' : c.panel + '55'),
        },
        title: definition.weighting.reference,
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
        h('td', { style: { ...styles.td, color: c.text } },
            result ? result.value.toFixed(5) : '—'),
        h('td', { style: { ...styles.td, color: c.textDim } },
            result ? (result.value * 100).toFixed(3) : '—'),
        h('td', { style: { ...styles.td, color: c.textDim } },
            result ? formatMinMax(result.min, result.lamAtMin) : '—'),
        h('td', { style: { ...styles.td, color: c.textDim } },
            result ? formatMinMax(result.max, result.lamAtMax) : '—'),
        h('td', {
            style: { ...styles.td, textAlign: 'left', color: c.textDim, padding: '2px 4px' },
        }, custom
            ? h(EditableBand, { custom, styles, c, onPatch })
            : band),
        h('td', { style: { ...styles.td, textAlign: 'center', padding: '0 4px' } },
            custom ? h(RemoveButton, { definition, onRemove, c, iv }) : null),
    );
}

export function ResultsTable(props) {
    const { integrals, results, selectedKey, setSelectedKey, onPatch, onRemove, c, t } = props;
    const iv = t.integralValues;
    const styles = tableStyles(c);
    return h('div', {
        style: {
            flex: '0 0 660px', minHeight: 0, overflow: 'auto',
            background: c.bg, borderRight: `1px solid ${c.border}`,
        },
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
