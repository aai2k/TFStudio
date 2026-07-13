import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { SpecVerdict } from '../../../SpecVerdict.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

function numberField(value, onNumber, style, fallback = 0) {
    return h(DebouncedInput, {
        value: String(value),
        onChange: valueText => {
            const text = String(valueText).trim();
            const number = text === '' ? fallback : parseFloat(valueText);
            onNumber(Number.isFinite(number) ? number : fallback);
        },
        style,
    });
}

export function SensitivityControls(props) {
    const {
        c, t, design, mode, setMode, relPct, setRelPct, absDeltaNm, setAbsDeltaNm,
        includeLocked, setIncludeLocked, view, setView, scale, setScale,
        specDesigns, resolveMat, status,
    } = props;
    const ls = t.layerSensitivity;
    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segmentStyle = active => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        }
    },
        h('div', { style: { display: 'flex', gap: 2 } },
            h('button', { onClick: () => setMode('relative'), style: segmentStyle(mode === 'relative') }, ls.modeRelative),
            h('button', { onClick: () => setMode('absolute'), style: segmentStyle(mode === 'absolute') }, ls.modeAbsolute),
        ),
        mode === 'relative' && h('label', { style: labelStyle }, ls.relLabel,
            numberField(relPct, setRelPct, { ...inputStyle, marginLeft: 6 }),
            h('span', { style: { marginLeft: 2 } }, '%')
        ),
        mode === 'absolute' && h('label', { style: labelStyle }, ls.absLabel,
            numberField(absDeltaNm, setAbsDeltaNm, { ...inputStyle, marginLeft: 6 }),
            h('span', { style: { marginLeft: 2 } }, 'nm')
        ),
        h('label', {
            style: {
                display: 'flex', alignItems: 'center', gap: 4,
                cursor: 'pointer', color: c.text, fontSize: 11,
            }
        },
            h(Checkbox, {
                c, checked: includeLocked, onChange: event => setIncludeLocked(event.target.checked),
            }),
            ls.includeLocked
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            h('button', { onClick: () => setView('chart'), style: segmentStyle(view === 'chart') }, ls.viewChart),
            h('button', { onClick: () => setView('table'), style: segmentStyle(view === 'table') }, ls.viewTable),
            h('button', { onClick: () => setView('both'), style: segmentStyle(view === 'both') }, ls.viewBoth),
        ),
        (view === 'chart' || view === 'both') && h('div', { style: { display: 'flex', gap: 2 } },
            h('button', {
                onClick: () => setScale('normalized'),
                style: segmentStyle(scale === 'normalized'),
                title: ls.scaleNormalizedTip,
            }, ls.scaleNormalized),
            h('button', {
                onClick: () => setScale('absolute'),
                style: segmentStyle(scale === 'absolute'),
                title: ls.scaleAbsoluteTip,
            }, ls.scaleAbsolute),
        ),
        design && h(EvalModeBadge, { design, c, t }),
        design?.qualifiers?.length > 0 && h(SpecVerdict, {
            designs: specDesigns, resolveMat, c, t, label: 'Spec @ ±Δd:',
        }),
        status
    );
}
