import { EvalModeBadge } from '../../../SurfaceModeBar.js';
import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h } = React;

function NumberBox({ value, onNum, inputStyle, width = 55, marginLeft = 6, fallback = 0, int = false, title }) {
    const onChange = (raw) => {
        const text = String(raw).trim();
        const parsed = int ? parseInt(raw, 10) : parseFloat(raw);
        onNum(text === '' || !Number.isFinite(parsed) ? fallback : parsed);
    };
    return h(DebouncedInput, {
        value: String(value),
        title,
        onChange,
        style: { ...inputStyle, marginLeft, width },
    });
}

function segmentButtonStyle(active, c) {
    return {
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
}

export function PrimaryControls({ controller, c, t, ea }) {
    const {
        design, params, setParams, char, setChar, nTrials, setNTrials,
        corridorSigma, setCorridorSigma, distribution, setDistribution,
        showEnvelope, setShowEnvelope, running, stop, handleRun,
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
    const runBtnStyle = {
        padding: '3px 14px', fontSize: 12, cursor: 'pointer',
        border: `1px solid ${c.accent}`, borderRadius: 3,
        background: c.accent + '33', color: c.accent,
        outline: 'none', fontFamily: 'system-ui, -apple-system, sans-serif',
        fontWeight: 600,
    };
    const onDistributionChange = (event) => {
        const value = event.target.value;
        setDistribution(value);
        if (value === 'uniform' || value === 'truncated') setShowEnvelope(true);
    };

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        }
    },
        h(EvalModeBadge, { design, c, t }),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            ['T', 'R', 'A'].map((characteristic) => h('button', {
                key: characteristic,
                onClick: () => setChar(characteristic),
                style: segmentButtonStyle(char === characteristic, c),
            }, characteristic)),
        ),
        h('label', { style: labelStyle }, ea.lambdaRange,
            h(NumberBox, {
                value: params.lambdaStart,
                onNum: (value) => setParams((previous) => ({ ...previous, lambdaStart: value })),
                inputStyle, width: 60, fallback: 100,
            }),
            h('span', { style: { margin: '0 4px', color: c.textDim } }, '–'),
            h(NumberBox, {
                value: params.lambdaEnd,
                onNum: (value) => setParams((previous) => ({ ...previous, lambdaEnd: value })),
                inputStyle, width: 60, marginLeft: 0, fallback: 800,
            }),
        ),
        h('label', { style: labelStyle }, ea.step,
            h(NumberBox, {
                value: params.lambdaStep,
                onNum: (value) => setParams((previous) => ({ ...previous, lambdaStep: value > 0 ? value : 5 })),
                inputStyle, width: 50, fallback: 5,
            }),
        ),
        h('label', { style: labelStyle }, ea.aoi,
            h(NumberBox, {
                value: params.theta,
                onNum: (value) => setParams((previous) => ({ ...previous, theta: value })),
                inputStyle, width: 50, fallback: 0,
            }),
        ),
        h('label', { style: labelStyle }, ea.pol,
            h('select', {
                value: params.polarization,
                onChange: (event) => setParams((previous) => ({ ...previous, polarization: event.target.value })),
                style: { ...inputStyle, marginLeft: 6, width: 70 },
            },
                h('option', { value: 'avg' }, 'avg'),
                h('option', { value: 's' }, 's'),
                h('option', { value: 'p' }, 'p'),
            ),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('label', { style: labelStyle }, ea.nTrials,
            h(NumberBox, {
                value: nTrials, onNum: (value) => setNTrials(Math.max(1, value)),
                inputStyle, width: 60, fallback: 1, int: true,
            }),
        ),
        h('label', {
            style: labelStyle,
            title: ea.corridorTip || 'Shaded band = mean ± k·σ of the spectrum across trials (k below). Display only — changing k re-draws the band without re-running the Monte Carlo, and does not affect the yield. k≈1 ≈ 68% only for Gaussian.',
        }, ea.corridor,
            h(NumberBox, {
                value: corridorSigma, onNum: (value) => setCorridorSigma(value > 0 ? value : 1),
                inputStyle, width: 50, fallback: 1,
            }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'σ'),
        ),
        h('label', {
            style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4 },
            title: ea.distributionTip,
        },
            ea.distribution,
            h('select', {
                value: distribution,
                onChange: onDistributionChange,
                style: { ...inputStyle, marginLeft: 6, width: 120, cursor: 'pointer' },
            },
                h('option', { value: 'gaussian' }, ea.distGaussian),
                h('option', { value: 'uniform' }, ea.distUniform),
                h('option', { value: 'truncated' }, ea.distTruncated),
            ),
        ),
        h('label', {
            style: { ...labelStyle, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' },
            title: ea.envelopeTip || 'Overlay the realized min/max envelope (the extreme spectra across all trials). For Uniform/Truncated this is the true hard bound; for Gaussian it has no fixed limit and widens with the number of trials.',
        },
            h(Checkbox, { c, checked: showEnvelope, onChange: (event) => setShowEnvelope(event.target.checked) }),
            h('span', null, ea.envelope || 'min/max'),
        ),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            running
                ? h('button', { onClick: stop, style: { ...runBtnStyle, borderColor: '#ef5350', color: '#ef5350', background: '#ef535033' } }, ea.stop)
                : h('button', { onClick: handleRun, style: runBtnStyle }, ea.run),
        ),
    );
}
