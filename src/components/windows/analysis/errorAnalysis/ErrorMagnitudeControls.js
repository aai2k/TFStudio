import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

function NumberBox({ value, onNum, inputStyle, width = 55, fallback = 0 }) {
    const onChange = (raw) => {
        const text = String(raw).trim();
        const parsed = parseFloat(raw);
        onNum(text === '' || !Number.isFinite(parsed) ? fallback : parsed);
    };
    return h(DebouncedInput, {
        value: String(value),
        onChange,
        style: { ...inputStyle, marginLeft: 6, width },
    });
}

function KeepOpticalThicknessControl({ controller, c, ea }) {
    const { rmsReN, rmsImN, keepOPT, setKeepOPT } = controller;
    const indexErrorsEnabled = rmsReN > 0 || rmsImN > 0;
    return h('label', {
        style: {
            display: 'flex', alignItems: 'center', gap: 4,
            cursor: indexErrorsEnabled ? 'pointer' : 'not-allowed',
            color: indexErrorsEnabled ? c.text : c.textDim,
            opacity: indexErrorsEnabled ? 1 : 0.5, fontSize: 11,
        },
        title: indexErrorsEnabled
            ? ea.keepOPTTip
            : (ea.keepOPTDisabledTip || 'Only affects index-error trials. Set σ Re(n) or σ Im(n) first — with thickness errors alone, keeping n·d constant cancels the perturbation (nominal plot).'),
    },
        h(Checkbox, {
            c, checked: keepOPT && indexErrorsEnabled, disabled: !indexErrorsEnabled,
            onChange: (event) => setKeepOPT(event.target.checked),
        }),
        ea.keepOPT,
    );
}

export function ErrorMagnitudeControls({ controller, c, ea }) {
    const {
        distribution, rmsAbsNm, setRmsAbsNm, rmsRelPct, setRmsRelPct,
        rmsReN, setRmsReN, rmsImN, setRmsImN, perMaterial, setPerMaterial,
    } = controller;
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
    const labelForDistribution = (text) => distribution === 'gaussian'
        ? text
        : (text || '').replace('σ', '±');

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel + 'aa', flexShrink: 0,
        }
    },
        h('span', { style: { ...labelStyle, color: c.text, fontWeight: 600 } }, ea.thickness + ':'),
        h('label', {
            style: labelStyle,
            title: ea.rmsAbsTip || 'Standard deviation of the absolute thickness error (nm). Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.',
        }, labelForDistribution(ea.rmsAbs),
            h(NumberBox, { value: rmsAbsNm, onNum: setRmsAbsNm, inputStyle, width: 55, fallback: 0 }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'nm'),
        ),
        h('label', {
            style: labelStyle,
            title: ea.rmsRelTip || 'Relative thickness error (% of layer thickness d), added to σ abs. Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.',
        }, labelForDistribution(ea.rmsRel),
            h(NumberBox, { value: rmsRelPct, onNum: setRmsRelPct, inputStyle, width: 55, fallback: 0 }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, '%'),
        ),
        h('div', { style: { width: 1, height: 18, background: c.border } }),
        h('span', { style: { ...labelStyle, color: c.text, fontWeight: 600 } }, ea.indices + ':'),
        h('label', {
            style: labelStyle,
            title: ea.rmsReNTip || 'Error on the real part of the refractive index n. Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.',
        }, labelForDistribution(ea.rmsReN),
            h(NumberBox, { value: rmsReN, onNum: setRmsReN, inputStyle, width: 55, fallback: 0 }),
        ),
        h('label', {
            style: labelStyle,
            title: ea.rmsImNTip || 'Error on the imaginary part of the refractive index k (extinction). Exact meaning depends on the distribution selector; for Gaussian ~68% of layers stay within ±this value.',
        }, labelForDistribution(ea.rmsImN),
            h(NumberBox, { value: rmsImN, onNum: setRmsImN, inputStyle, width: 55, fallback: 0 }),
        ),
        h('label', {
            style: { display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', color: c.text, fontSize: 11 },
            title: ea.perMaterialTip,
        },
            h(Checkbox, { c, checked: perMaterial, onChange: (event) => setPerMaterial(event.target.checked) }),
            ea.perMaterial,
        ),
        h(KeepOpticalThicknessControl, { controller, c, ea }),
    );
}

export function DistributionNote({ distribution, c, ea }) {
    const notes = {
        uniform: ea.sigmaNoteUniform || 'The value you enter is taken as the hard ± bound B (the largest possible deviation), NOT as σ: deviations are spread uniformly over [−B, +B], so none exceeds B and the realized RMS (effective σ) = B/√3 ≈ 0.58·B.',
        truncated: ea.sigmaNoteTruncated || 'The value you enter is taken as the hard ± bound B = 3σ (so σ = B/3), NOT as σ directly: a Gaussian bell clipped so no deviation exceeds ±B; realized RMS ≈ B/3.',
        gaussian: ea.sigmaNoteGaussian || 'σ is one standard deviation: about 68% of layer deviations stay within ±σ and ~32% exceed it (Gaussian tails are unbounded). Thickness error per layer = σ abs + σ rel·d.',
    };
    return h('div', {
        style: {
            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel + 'aa', flexShrink: 0,
            fontSize: 10.5, color: c.textDim, lineHeight: 1.4,
            borderLeft: `2px solid ${c.accent}`,
        }
    }, notes[distribution] || notes.gaussian);
}
