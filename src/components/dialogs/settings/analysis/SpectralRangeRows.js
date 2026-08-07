// The shared spectral range, shown in whichever spectral unit is selected.
//
// Values are stored in nanometres because the physics engine always works in
// vacuum wavelength; only the display converts. cm⁻¹, THz and eV are reciprocal
// in λ, so converting a range in those units reverses its ends — the writes
// below re-order the pair so the stored nm range always runs low to high.
import { SPECTRAL_UNITS, fromNm, toNm } from '../../../../utils/physics/spectralAxis.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
import { EnumRow } from './FieldRows.js';
import { selectStyle } from '../ui.js';

const { createElement: h } = React;

const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0' };

const STEP_DECIMALS = { nm: 2, um: 4, cm1: 0, THz: 2, eV: 4 };

function displayValue(nm, unit) {
    const decimals = SPECTRAL_UNITS[unit]?.decimals ?? 0;
    return Number(fromNm(nm, unit).toFixed(decimals));
}

function ValueRow({ c, label, value, step, onCommit }) {
    return h('div', { style: rowStyle },
        h('span', { style: { flex: 1, fontSize: '13px', color: c.text } }, label),
        h('input', {
            type: 'number',
            value,
            step,
            onChange: (e) => {
                const parsed = parseFloat(e.target.value);
                if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed);
            },
            style: { ...selectStyle(c), width: '120px', padding: '6px 8px' },
        }));
}

export const SpectralRangeRows = ({ resolved, onChange, c, t }) => {
    const unit = resolved.enums.spectralUnit;
    const meta = SPECTRAL_UNITS[unit] || SPECTRAL_UNITS.nm;
    const { lambdaStart, lambdaEnd, lambdaStep } = resolved.numbers;
    const spec = ANALYSIS_DEFAULTS.shared.numbers;

    // Write both ends together so a reciprocal unit cannot leave start > end.
    const commitEdge = (edge) => (entered) => {
        const asNm = toNm(entered, unit);
        const other = edge === 'start' ? lambdaEnd : lambdaStart;
        const low = Math.min(asNm, other);
        const high = Math.max(asNm, other);
        const clamp = (v, s) => Math.min(Math.max(v, s.min), s.max);
        onChange('numbers', 'lambdaStart', Number(clamp(low, spec.lambdaStart).toFixed(4)));
        onChange('numbers', 'lambdaEnd', Number(clamp(high, spec.lambdaEnd).toFixed(4)));
    };

    // The step is an interval, not a position, so it is a difference in nm and
    // has no meaningful reciprocal-unit form. It stays in nm and says so.
    const commitStep = (entered) => {
        const clamped = Math.min(Math.max(entered, spec.lambdaStep.min), spec.lambdaStep.max);
        onChange('numbers', 'lambdaStep', clamped);
    };

    const decimals = STEP_DECIMALS[unit] ?? 2;
    const edgeStep = Math.pow(10, -decimals) * 10;

    return h('div', null,
        h(EnumRow, {
            c,
            label: t.settings.analysis.fields.spectralUnit,
            value: unit,
            spec: ANALYSIS_DEFAULTS.shared.enums.spectralUnit,
            onChange: (value) => onChange('enums', 'spectralUnit', value),
        }),
        h(ValueRow, {
            c,
            label: t.settings.analysis.rangeFrom(meta.short),
            value: displayValue(lambdaStart, unit),
            step: edgeStep,
            onCommit: commitEdge('start'),
        }),
        h(ValueRow, {
            c,
            label: t.settings.analysis.rangeTo(meta.short),
            value: displayValue(lambdaEnd, unit),
            step: edgeStep,
            onCommit: commitEdge('end'),
        }),
        h(ValueRow, {
            c,
            label: t.settings.analysis.fields.lambdaStep,
            value: lambdaStep,
            step: spec.lambdaStep.step,
            onCommit: commitStep,
        }),
        unit !== 'nm' && h('span', {
            style: { display: 'block', fontSize: '11px', color: c.textDim, marginTop: '6px' },
        }, t.settings.analysis.storedInNm(displayValue(lambdaStart, 'nm'), displayValue(lambdaEnd, 'nm')))
    );
};
