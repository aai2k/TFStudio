import {
    BUILTIN_SOURCES,
    BUILTIN_DETECTORS,
} from '../../../../utils/physics/spectralWeightings.js';

const { createElement: h } = React;

function controlStyles(c) {
    return {
        label: {
            color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
            whiteSpace: 'nowrap',
        },
        input: {
            background: c.inputBg || c.hover, color: c.text,
            border: `1px solid ${c.border}`, borderRadius: 3,
            padding: '1px 4px', fontSize: 12,
            fontFamily: 'system-ui, -apple-system, sans-serif',
        },
    };
}

export function EvaluationControls(props) {
    const { params, setParams, c, t } = props;
    const iv = t.integralValues;
    const styles = controlStyles(c);
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        },
    },
        h('label', { style: styles.label }, iv.lambdaRange,
            h('input', {
                type: 'number', value: params.lambdaStart, min: 100, max: 3000, step: 10,
                onChange: event => setParams(current => ({ ...current, lambdaStart: parseFloat(event.target.value) || 100 })),
                style: { ...inputStyle, marginLeft: 6, width: 60 },
            }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, '–'),
            h('input', {
                type: 'number', value: params.lambdaEnd, min: 100, max: 3000, step: 10,
                onChange: event => setParams(current => ({ ...current, lambdaEnd: parseFloat(event.target.value) || 2500 })),
                style: { ...inputStyle, width: 60 },
            }),
        ),
        h('label', { style: styles.label }, iv.step,
            h('input', {
                type: 'number', value: params.lambdaStep, min: 0.5, max: 50, step: 0.5,
                onChange: event => setParams(current => {
                    const value = parseFloat(event.target.value);
                    return { ...current, lambdaStep: value > 0 ? value : 5 };
                }),
                style: { ...inputStyle, marginLeft: 6, width: 50 },
            }),
        ),
        h('label', { style: styles.label }, iv.aoi,
            h('input', {
                type: 'number', value: params.theta, min: 0, max: 89, step: 1,
                onChange: event => setParams(current => ({ ...current, theta: parseFloat(event.target.value) || 0 })),
                style: { ...inputStyle, marginLeft: 6, width: 50 },
            }),
        ),
        h('label', { style: styles.label }, iv.pol,
            h('select', {
                value: params.polarization,
                onChange: event => setParams(current => ({ ...current, polarization: event.target.value })),
                style: { ...inputStyle, marginLeft: 6, width: 70 },
            },
                h('option', { value: 'avg' }, 'avg'),
                h('option', { value: 's' }, 's'),
                h('option', { value: 'p' }, 'p'),
            ),
        ),
    );
}

function EditTableButton(props) {
    const { onClick, table, c, iv } = props;
    return h('button', {
        onClick,
        style: {
            padding: '2px 8px', fontSize: 11, cursor: 'pointer',
            border: `1px solid ${c.border}`, borderRadius: 3,
            background: 'transparent', color: c.text, outline: 'none',
        },
    }, `${iv.editTable}${table?.length ? ` (${table.length})` : ''}`);
}

export function CustomBuilder(props) {
    const { builder, setBuilder, onAdd, openEditor, c, t } = props;
    const iv = t.integralValues;
    const styles = controlStyles(c);
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel + 'aa', flexShrink: 0,
        },
    },
        h('span', { style: { ...styles.label, color: c.text, fontWeight: 600 } }, iv.customBuilderTitle),
        h('label', { style: styles.label }, iv.channel,
            h('select', {
                value: builder.char,
                onChange: event => setBuilder({ ...builder, char: event.target.value }),
                style: { ...styles.input, marginLeft: 4, width: 50 },
            },
                h('option', { value: 'T' }, 'T'),
                h('option', { value: 'R' }, 'R'),
                h('option', { value: 'A' }, 'A'),
            ),
        ),
        h('label', { style: styles.label }, iv.source,
            h('select', {
                value: builder.source.id,
                onChange: event => setBuilder({ ...builder, source: { ...builder.source, id: event.target.value } }),
                style: { ...styles.input, marginLeft: 4, width: 160 },
            },
                BUILTIN_SOURCES.map(source =>
                    h('option', { key: source.id, value: source.id }, source.label)),
            ),
        ),
        builder.source.id === 'blackbody' && h('label', { style: styles.label },
            iv.sourceT,
            h('input', {
                type: 'number', value: builder.source.T ?? 5778,
                min: 100, max: 30000, step: 50,
                onChange: event => setBuilder({
                    ...builder,
                    source: { ...builder.source, T: parseFloat(event.target.value) || 5778 },
                }),
                style: { ...styles.input, marginLeft: 4, width: 60 },
            }),
            h('span', { style: { marginLeft: 2, color: c.textDim } }, iv.sourceT_K),
        ),
        builder.source.id === 'custom' && h(EditTableButton, {
            onClick: () => openEditor('source'), table: builder.source.table, c, iv,
        }),
        h('label', { style: styles.label }, iv.detector,
            h('select', {
                value: builder.detector.id,
                onChange: event => setBuilder({ ...builder, detector: { ...builder.detector, id: event.target.value } }),
                style: { ...styles.input, marginLeft: 4, width: 180 },
            },
                BUILTIN_DETECTORS.map(detector =>
                    h('option', { key: detector.id, value: detector.id }, detector.label)),
            ),
        ),
        builder.detector.id === 'custom' && h(EditTableButton, {
            onClick: () => openEditor('detector'), table: builder.detector.table, c, iv,
        }),
        h('label', { style: styles.label }, iv.band,
            h('input', {
                type: 'number', value: builder.bandMin, min: 0, max: 30000, step: 10,
                onChange: event => setBuilder({ ...builder, bandMin: parseFloat(event.target.value) || 0 }),
                style: { ...styles.input, marginLeft: 4, width: 60 },
            }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, iv.bandTo),
            h('input', {
                type: 'number', value: builder.bandMax, min: 0, max: 30000, step: 10,
                onChange: event => setBuilder({ ...builder, bandMax: parseFloat(event.target.value) || 0 }),
                style: { ...styles.input, width: 60 },
            }),
            h('span', { style: { marginLeft: 4, color: c.textDim } }, iv.bandNm),
        ),
        h('button', {
            onClick: onAdd, title: iv.addCustomTitle,
            style: {
                padding: '3px 12px', fontSize: 11, cursor: 'pointer',
                border: `1px solid ${c.accent}`, borderRadius: 3,
                background: c.accent + '22', color: c.text, outline: 'none',
                fontFamily: 'system-ui', fontWeight: 600,
            },
        }, iv.addCustom),
    );
}
