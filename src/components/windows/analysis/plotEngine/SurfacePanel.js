import {
    POLARIZATIONS, SURFACE_MODES, Z_QUANTITIES, SURFACE_RENDERS, COLORSCALES,
    buildAxisTargetOptions, parseAxisVar,
} from '../../../../utils/physics/plotQuantities.js';
import { SurfaceAxisGroup } from './SurfaceAxisGroup.js';

const { createElement: h } = React;

function panelStyles(c) {
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '2px 4px', fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    return {
        selStyle: { ...inputStyle, width: '100%' },
        numStyle: { ...inputStyle, width: 60 },
        lbl: { color: c.textDim, fontSize: 10, marginBottom: 2 },
        block: { padding: '8px 10px', borderBottom: `1px solid ${c.border}` },
        sectionTitle: {
            fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: 'uppercase',
            letterSpacing: 0.4, marginBottom: 6,
        },
    };
}

function QuantitySection({ spec, onUpdate, optical, isMF, styles, c, pe }) {
    return h('div', { style: styles.block },
        h('div', { style: styles.sectionTitle }, pe.quantity || 'Quantity (Z)'),
        h('select', { value: spec.z, onChange: (e) => onUpdate({ z: e.target.value }), style: styles.selStyle },
            Z_QUANTITIES.map(v => h('option', { key: v, value: v }, v === 'MF' ? (pe.zMF || 'Merit Function') : v))),
        optical && h('div', { style: { display: 'flex', gap: 6, marginTop: 6 } },
            h('div', { style: { flex: 1 } },
                h('div', { style: styles.lbl }, pe.channel || 'Polarization'),
                h('select', {
                    value: spec.polarization,
                    onChange: (e) => onUpdate({ polarization: e.target.value }),
                    style: styles.selStyle,
                }, POLARIZATIONS.map(v => h('option', { key: v, value: v }, v)))),
            h('div', { style: { flex: 1 } },
                h('div', { style: styles.lbl }, pe.surface || 'Surface'),
                h('select', {
                    value: spec.surfaceMode,
                    onChange: (e) => onUpdate({ surfaceMode: e.target.value }),
                    style: styles.selStyle,
                }, SURFACE_MODES.map(v => h('option', { key: v, value: v }, v)))),
        ),
        isMF && h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 6, lineHeight: 1.4 } },
            pe.mfHint || 'MF is plotted over two layer parameters — the optimizer landscape. Axes must be layer thickness / n / k.'),
    );
}

function AxesSection({ spec, design, onUpdate, targetOptions, styles, c, pe }) {
    const common = { spec, design, onUpdate, targetOptions, styles, c, pe };
    return h('div', { style: styles.block },
        h('div', { style: styles.sectionTitle }, pe.axes || 'Axes'),
        h(SurfaceAxisGroup, { ...common, which: 'x' }),
        h(SurfaceAxisGroup, { ...common, which: 'y' }),
    );
}

function FixedParameters({ spec, onUpdate, needFixedLambda, needFixedAOI, styles, pe }) {
    if (!needFixedLambda && !needFixedAOI) return null;
    return h('div', { style: styles.block },
        h('div', { style: styles.sectionTitle }, pe.fixed || 'Fixed parameters'),
        needFixedLambda && h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
            h('span', { style: { ...styles.lbl, marginBottom: 0, width: 60 } }, pe.fixedLambda || 'λ (nm)'),
            h('input', {
                type: 'number', value: spec.fixedLambda_nm, step: 10, min: 100, style: styles.numStyle,
                onChange: (e) => onUpdate({ fixedLambda_nm: parseFloat(e.target.value) || 550 }),
            })),
        needFixedAOI && h('div', { style: { display: 'flex', alignItems: 'center', gap: 6 } },
            h('span', { style: { ...styles.lbl, marginBottom: 0, width: 60 } }, pe.fixedAOI || 'AOI (°)'),
            h('input', {
                type: 'number', value: spec.fixedAOI_deg, step: 5, min: 0, max: 89, style: styles.numStyle,
                onChange: (e) => onUpdate({ fixedAOI_deg: parseFloat(e.target.value) || 0 }),
            })),
    );
}

function Appearance({ spec, onUpdate, styles, pe }) {
    return h('div', { style: styles.block },
        h('div', { style: styles.sectionTitle }, pe.appearance || 'Appearance'),
        h('div', { style: { display: 'flex', gap: 6 } },
            h('div', { style: { flex: 1 } },
                h('div', { style: styles.lbl }, pe.render || 'Render'),
                h('select', { value: spec.render, onChange: (e) => onUpdate({ render: e.target.value }), style: styles.selStyle },
                    SURFACE_RENDERS.map(v => h('option', { key: v, value: v },
                        v === 'surface' ? (pe.renderSurface || '3D surface') : (pe.renderHeatmap || 'Heatmap'))))),
            h('div', { style: { flex: 1 } },
                h('div', { style: styles.lbl }, pe.colorscale || 'Colors'),
                h('select', { value: spec.colorscale, onChange: (e) => onUpdate({ colorscale: e.target.value }), style: styles.selStyle },
                    COLORSCALES.map(v => h('option', { key: v, value: v }, v)))),
        ),
    );
}

function computeLabel(computing, progress, pe) {
    if (!computing) return pe.compute || '▶ Compute surface';
    if (progress && progress.total) return `${pe.computing || 'Computing…'} ${progress.done}/${progress.total}`;
    return pe.computing || 'Computing…';
}

function gridLabel(spec, pe) {
    const nx = Math.max(2, Math.min(400, Math.round(spec.xSteps || 2)));
    const ny = Math.max(2, Math.min(400, Math.round(spec.ySteps || 2)));
    return (pe.gridSize || 'Grid') + `: ${nx} × ${ny} = ${nx * ny} ${pe.points || 'points'}`;
}

function ComputeFooter({ spec, onCompute, computing, progress, result, c, pe }) {
    return h('div', { style: { padding: '8px 10px', borderTop: `1px solid ${c.border}`, background: c.panel } },
        h('button', {
            onClick: onCompute, disabled: computing,
            style: {
                width: '100%', padding: '6px 10px', background: computing ? c.border : c.accent,
                color: '#fff', border: 'none', borderRadius: 3, fontSize: 12, fontWeight: 600,
                cursor: computing ? 'default' : 'pointer', fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        }, computeLabel(computing, progress, pe)),
        h('div', { style: { fontSize: 10, color: c.textDim, marginTop: 5, textAlign: 'center' } }, gridLabel(spec, pe)),
        result && !result.ok && h('div', {
            style: {
                fontSize: 10, color: c.danger || '#ef5350', marginTop: 4,
                textAlign: 'center', lineHeight: 1.3,
            },
        }, result.error),
    );
}

export function SurfacePanel({ spec, onUpdate, onCompute, computing, progress, design, result, c, t }) {
    const pe = (t && t.plotEngine) || {};
    const styles = panelStyles(c);
    const isMF = spec.z === 'MF';
    const optical = !isMF;
    const targetOptions = buildAxisTargetOptions(design, optical);
    const xKind = parseAxisVar(spec.xVar).kind;
    const yKind = parseAxisVar(spec.yVar).kind;
    const needFixedLambda = optical && xKind !== 'lambda' && yKind !== 'lambda';
    const needFixedAOI = optical && xKind !== 'aoi' && yKind !== 'aoi';

    return h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%' } },
        h('div', { style: { flex: 1, minHeight: 0, overflowY: 'auto' } },
            h(QuantitySection, { spec, onUpdate, optical, isMF, styles, c, pe }),
            h(AxesSection, { spec, design, onUpdate, targetOptions, styles, c, pe }),
            h(FixedParameters, { spec, onUpdate, needFixedLambda, needFixedAOI, styles, pe }),
            h(Appearance, { spec, onUpdate, styles, pe }),
        ),
        h(ComputeFooter, { spec, onCompute, computing, progress, result, c, pe }),
    );
}
