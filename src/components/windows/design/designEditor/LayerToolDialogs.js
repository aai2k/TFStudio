import {
    designMerit, herpinCollapsePreview, makePerturbationMap,
    perturbDesignSide, quantizeDesignSide,
} from './layerTools.js';
import { makeConeSpec, coneIsActive } from '../../../../utils/physics/optimizer.js';
import { useAnalysisEvaluation } from '../../analysis/useAnalysisEvaluation.js';

const { createElement: h, useMemo, useState } = React;

function DialogFrame({ title, c, children, onClose }) {
    return h('div', {
        style: {
            position: 'fixed', inset: 0, zIndex: 1100, display: 'flex',
            alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.68)',
        },
    }, h('div', {
        style: {
            width: 470, maxWidth: '92vw', maxHeight: '86vh', overflow: 'auto',
            padding: 20, borderRadius: 8, border: `1px solid ${c.border}`,
            background: c.panel, color: c.text, boxShadow: '0 12px 42px rgba(0,0,0,.35)',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
        h('h2', { style: { margin: '0 0 14px', fontSize: 17 } }, title),
        children,
    ));
}

function FormRow({ label, c, children }) {
    return h('label', {
        style: { display: 'flex', alignItems: 'center', gap: 10, margin: '9px 0' },
    }, h('span', { style: { width: 145, color: c.textDim, flexShrink: 0 } }, label), children);
}

function NumberInput({ value, onChange, min, max, step, c, width = 90 }) {
    return h('input', {
        type: 'number', value, min, max, step,
        onChange: event => onChange(event.target.value),
        style: {
            width, height: 25, padding: '0 6px', boxSizing: 'border-box',
            color: c.text, background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 4, outline: 'none', textAlign: 'right',
        },
    });
}

function Footer({ c, strings, onClose, onApply, applyLabel, disabled = false }) {
    const button = primary => ({
        // A native button does not inherit the dialog's font, so every one of
        // them has to ask for it or they render in the browser default.
        font: 'inherit',
        padding: '6px 15px', borderRadius: 5, cursor: disabled && primary ? 'default' : 'pointer',
        border: `1px solid ${primary ? c.accent : c.border}`,
        color: primary ? '#fff' : c.text, background: primary ? c.accent : 'transparent',
        opacity: disabled && primary ? 0.45 : 1,
    });
    return h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 } },
        h('button', { onClick: onClose, style: button(false) }, strings.cancel),
        h('button', { onClick: onApply, disabled, style: button(true) }, applyLabel || strings.apply),
    );
}

function MeritDelta({ before, after, busy, c, strings, computingLabel }) {
    if (busy) {
        return h('div', { style: { marginTop: 12, color: c.textDim } }, computingLabel);
    }
    if (before == null || after == null) {
        return h('div', { style: { marginTop: 12, color: c.textDim } },
            strings.meritUnavailable);
    }
    const delta = after - before;
    return h('div', {
        style: {
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
            marginTop: 12, padding: 9, border: `1px solid ${c.border}`,
            borderRadius: 5, fontVariantNumeric: 'tabular-nums',
        },
    },
        h('span', null, `${strings.mfBefore}  ${before.toFixed(6)}`),
        h('span', null, `${strings.mfAfter}  ${after.toFixed(6)}`),
        h('span', { style: { color: delta > 0 ? c.error : delta < 0 ? c.success : c.text } },
            `Δ ${delta >= 0 ? '+' : ''}${delta.toExponential(3)}`),
    );
}

function useMeritPreview(design, preview) {
    const operands = design?.meritOperands || [];
    const coneActive = operands.length > 0 && coneIsActive(makeConeSpec(design?.cone || {}));
    const payload = useMemo(
        () => ({ design, candidateDesign: preview, operands }),
        [design, preview, operands],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'meritPair', payload);
    const direct = useMemo(() => coneActive ? null : {
        before: designMerit(design),
        after: designMerit(preview),
    }, [coneActive, design, preview]);
    return coneActive ? {
        before: workerResult.data?.before?.mf ?? null,
        after: workerResult.data?.after?.mf ?? null,
        busy: workerResult.busy,
    } : { ...direct, busy: false };
}

export function QuantizeDialog({ design, side, c, t, onApply, onClose }) {
    const strings = t.designEditor.layerTools;
    const [mode, setMode] = useState('step');
    const [rawValue, setRawValue] = useState('0.1');
    const value = Number(rawValue);
    const options = { mode, value, referenceWavelength: design.referenceWavelength || 550 };
    const preview = useMemo(() => {
        try { return quantizeDesignSide(design, side, options); } catch { return design; }
    }, [design, side, mode, value]);
    const { before, after, busy } = useMeritPreview(design, preview);
    const invalid = !Number.isFinite(value) || (mode !== 'decimals' && value <= 0) || (mode === 'decimals' && value < 0);
    const labels = {
        decimals: strings.decimalPlaces, step: strings.controllerStep, qwot: strings.qwotIncrement,
    };
    const sideLabel = side === 'front' ? strings.frontSide : strings.backSide;
    return h(DialogFrame, { title: strings.quantizeTitle, c, onClose },
        h('p', { style: { color: c.textDim, lineHeight: 1.45 } },
            strings.unlockedSide(sideLabel)),
        h(FormRow, { label: strings.method, c }, h('select', {
            value: mode,
            onChange: event => {
                const next = event.target.value;
                setMode(next);
                setRawValue(next === 'decimals' ? '2' : next === 'qwot' ? '1' : '0.1');
            },
            style: { height: 25, color: c.text, background: c.bg, border: `1px solid ${c.border}`, borderRadius: 4 },
        },
            h('option', { value: 'decimals' }, labels.decimals),
            h('option', { value: 'step' }, labels.step),
            h('option', { value: 'qwot' }, labels.qwot),
        )),
        h(FormRow, { label: labels[mode], c },
            h(NumberInput, {
                value: rawValue, onChange: setRawValue, c,
                min: 0, max: mode === 'decimals' ? 8 : undefined,
                step: mode === 'decimals' ? 1 : mode === 'qwot' ? 0.25 : 0.01,
            }),
            mode === 'qwot' && h('span', { style: { color: c.textDim } },
                strings.atReference(design.referenceWavelength || 550)),
        ),
        h(MeritDelta, { before, after, busy, c, strings, computingLabel: t.analysisEvaluation.computing }),
        h(Footer, { c, strings, onClose, disabled: invalid, onApply: () => onApply(preview) }),
    );
}

export function PerturbDialog({ design, side, c, t, onApply, onClose }) {
    const strings = t.designEditor.layerTools;
    const key = side === 'back' ? 'backLayers' : 'frontLayers';
    const [rawPercent, setRawPercent] = useState('2');
    const [sample, setSample] = useState(() => makePerturbationMap(design[key] || []));
    const percent = Number(rawPercent);
    const preview = useMemo(
        () => perturbDesignSide(design, side, percent, sample),
        [design, side, percent, sample],
    );
    const { before, after, busy } = useMeritPreview(design, preview);
    const invalid = !Number.isFinite(percent) || percent <= 0 || percent > 100;
    const sideLabel = side === 'front' ? strings.frontSide : strings.backSide;
    return h(DialogFrame, { title: strings.perturbTitle, c, onClose },
        h('p', { style: { color: c.textDim, lineHeight: 1.45 } },
            strings.perturbDescription(sideLabel)),
        h(FormRow, { label: strings.maximumKick, c },
            h(NumberInput, { value: rawPercent, onChange: setRawPercent, c, min: 0.001, max: 100, step: 0.25 }),
            h('button', {
                onClick: () => setSample(makePerturbationMap(design[key] || [])),
                style: {
                    font: 'inherit',
                    height: 25, padding: '0 9px', color: c.text, background: 'transparent',
                    border: `1px solid ${c.border}`, borderRadius: 4, cursor: 'pointer',
                },
            }, strings.reshuffle),
        ),
        h(MeritDelta, { before, after, busy, c, strings, computingLabel: t.analysisEvaluation.computing }),
        h(Footer, { c, strings, onClose, disabled: invalid, onApply: () => onApply(preview), applyLabel: strings.applyKick }),
    );
}

export function localizedHerpinError(error, strings) {
    const entry = strings.errors?.[error?.code];
    if (typeof entry === 'function') return entry(error.detail);
    return entry || error?.message || String(error);
}

export function HerpinDialog({ design, side, selectedIds, c, t, onApply, onClose }) {
    const strings = t.designEditor.layerTools;
    const result = useMemo(() => {
        try {
            return { preview: herpinCollapsePreview(design, side, selectedIds, design.referenceWavelength || 550), error: null };
        } catch (error) {
            return { preview: null, error: localizedHerpinError(error, strings) };
        }
    }, [design, side, selectedIds, strings]);
    const equivalent = result.preview?.equivalentLayer;
    return h(DialogFrame, { title: strings.herpinTitle, c, onClose },
        h('p', { style: { color: c.textDim, lineHeight: 1.45 } },
            strings.herpinDescription),
        result.error
            ? h('div', {
                style: { padding: 10, color: c.error, border: `1px solid ${c.error}66`, borderRadius: 5 },
            }, result.error)
            : h('div', {
                style: { padding: 10, border: `1px solid ${c.border}`, borderRadius: 5, lineHeight: 1.7 },
            },
                h('div', null, `${strings.selectedLayers}: ${result.preview.group.length}`),
                h('div', null, `${strings.referenceLambda}: ${equivalent.herpin.referenceWavelength} ${strings.nm}`),
                h('div', null, `${strings.herpinIndex}: ${equivalent.herpin.equivalentIndex.toFixed(8)}`),
                h('div', null, `${strings.equivalentThickness}: ${equivalent.thickness.toFixed(6)} ${strings.nm}`),
                h('div', { style: { marginTop: 5, color: c.textDim } },
                    strings.herpinLimit),
            ),
        h(Footer, {
            c, strings, onClose, disabled: !result.preview, applyLabel: strings.collapseGroup,
            onApply: () => onApply(result.preview.design),
        }),
    );
}
