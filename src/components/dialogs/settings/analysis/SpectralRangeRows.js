// A spectral range shown in whichever spectral unit is selected.
//
// Values are stored in nanometres because the physics engine always works in
// vacuum wavelength; only the display converts. cm⁻¹, THz and eV are reciprocal
// in λ, so converting a range in those units reverses its ends — the writes
// below re-order the pair so the stored nm range always runs low to high.
import { SPECTRAL_UNITS, fromNm, toNm } from '../../../../utils/physics/spectralAxis.js';
import { EnumRow } from './FieldRows.js';
import { selectStyle } from '../ui.js';

const { createElement: h } = React;

const rowStyle = { display: 'flex', alignItems: 'center', gap: '12px', padding: '6px 0' };

const STEP_DECIMALS = { nm: 2, um: 4, cm1: 0, THz: 2, eV: 4 };

// The unit's own decimals, or more for a small value so it keeps three
// significant figures: 0.3 nm is not shown as 0.
function displayValue(nm, unit) {
    const value = fromNm(nm, unit);
    const decimals = Math.max(SPECTRAL_UNITS[unit]?.decimals ?? 0, 2 - Math.floor(Math.log10(Math.abs(value))));
    return Number(value.toFixed(Math.min(100, decimals)));
}

// Commits on blur or Enter. Committing per keystroke is worse here than
// anywhere else: the two ends are written as a pair, so a half-typed 9 on its
// way to 900 would be taken as 9 and swapped with the other end before the
// next digit arrived. Zero or less reverts, like unparseable text.
function ValueRow({ c, label, value, step, onCommit }) {
    const { useState, useEffect } = React;
    const [raw, setRaw] = useState(String(value));
    useEffect(() => { setRaw(String(value)); }, [value]);

    const commit = () => {
        const parsed = parseFloat(raw);
        // The prop is recomputed from what the commit stored, so reverting to it
        // here shows the accepted value.
        setRaw(String(value));
        if (Number.isFinite(parsed) && parsed > 0) onCommit(parsed);
    };

    return h('div', { style: rowStyle },
        h('span', { style: { flex: 1, fontSize: '13px', color: c.text } }, label),
        h('input', {
            type: 'number',
            className: 'tfs-number',
            value: raw,
            step,
            onChange: (e) => setRaw(e.target.value),
            onBlur: commit,
            onKeyDown: (e) => { if (e.key === 'Enter') commit(); },
            style: { ...selectStyle(c), width: '120px', padding: '6px 8px', textAlign: 'right' },
        }));
}

// `registry` is the owning window's entry, so the arrow-key steps are the ones
// that window declares rather than a set shared by every window.
export const SpectralRangeRows = ({ registry, resolved, onChange, c, t }) => {
    const unit = resolved.enums.spectralUnit;
    const meta = SPECTRAL_UNITS[unit] || SPECTRAL_UNITS.nm;
    const { lambdaStart, lambdaEnd, lambdaStep } = resolved.numbers;
    const spec = registry.numbers;

    // Write both ends together so a reciprocal unit cannot leave start > end.
    // Rounded to twelve significant figures, which drops float residue from the
    // unit conversion and keeps a wavelength of any size.
    const commitEdge = (edge) => (entered) => {
        const asNm = toNm(entered, unit);
        const other = edge === 'start' ? lambdaEnd : lambdaStart;
        onChange('numbers', 'lambdaStart', Number(Math.min(asNm, other).toPrecision(12)));
        onChange('numbers', 'lambdaEnd', Number(Math.max(asNm, other).toPrecision(12)));
    };

    // The step is an interval, not a position, so it is a difference in nm and
    // has no meaningful reciprocal-unit form. It stays in nm and says so.
    const commitStep = (entered) => onChange('numbers', 'lambdaStep', entered);

    const decimals = STEP_DECIMALS[unit] ?? 2;
    const edgeStep = Math.pow(10, -decimals) * 10;

    return h('div', null,
        h(EnumRow, {
            c,
            label: t.settings.analysis.fields.spectralUnit,
            value: unit,
            spec: registry.enums.spectralUnit,
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
