import {
    ActionButton, CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { measuredFitConstraintsInvalid } from './model.js';

const { createElement: h } = React;

function DialogRow({ c, label, children }) {
    return h('div', {
        style: {
            display: 'grid', gridTemplateColumns: '145px minmax(0, 1fr)',
            alignItems: 'center', gap: 10, minHeight: 30,
        },
    }, h(FieldLabel, { c }, label), h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, flexWrap: 'wrap' },
    }, children));
}

function Notice({ tone, children, c }) {
    const color = tone === 'error' ? c.error : c.warning || '#d9a441';
    return h('div', {
        style: {
            padding: '7px 9px', borderRadius: 5, border: `1px solid ${color}77`,
            color, background: color + '10', fontSize: 11, lineHeight: 1.4,
        },
    }, children);
}

export function MeasuredFitDialog({ controller, c, sx }) {
    const {
        fitDialogCurve: curve, fitConfig, setFitOption, fitSnapshot,
        onCreateFitOperand, closeFitDialog, missingMaterialIds,
    } = controller;
    if (!curve) return null;

    const sampledCount = fitSnapshot.sampled?.lambdas?.length || 0;
    const constraintsInvalid = measuredFitConstraintsInvalid(fitConfig);
    const disabled = missingMaterialIds.length > 0 || !fitSnapshot.operand || constraintsInvalid;

    return h('div', {
        role: 'dialog', 'aria-modal': true, 'aria-label': sx.fitTitle,
        onMouseDown: event => { if (event.target === event.currentTarget) closeFitDialog(); },
        style: {
            position: 'fixed', inset: 0, zIndex: 1200, display: 'flex',
            alignItems: 'center', justifyContent: 'center', padding: 18,
            background: 'rgba(0,0,0,0.68)',
        },
    }, h('div', {
        style: {
            width: 520, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto',
            boxSizing: 'border-box', padding: 18, borderRadius: 8,
            border: `1px solid ${c.border}`, background: c.panel, color: c.text,
            boxShadow: '0 12px 42px rgba(0,0,0,.38)',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 } },
            h('h2', { style: { margin: 0, fontSize: 17, flex: 1 } }, sx.fitTitle),
            h(ActionButton, { c, label: '×', onClick: closeFitDialog, title: sx.fitCancel }),
        ),
        h('div', {
            title: curve.name,
            style: {
                marginBottom: 12, padding: '8px 10px', borderRadius: 5,
                background: c.bg, color: c.text, fontWeight: 600,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
        }, sx.fitCurve(curve.name)),

        h(DialogRow, { c, label: sx.fitGridLabel },
            h(ChoiceGroup, {
                c, activeId: fitConfig.mode, onSelect: value => setFitOption('mode', value),
                items: [
                    { id: 'measured', label: sx.fitMeasured, title: sx.fitMeasuredTip },
                    { id: 'thinned', label: sx.fitThinned, title: sx.fitThinnedTip },
                    { id: 'uniform', label: sx.fitUniform, title: sx.fitUniformTip },
                ],
            }),
        ),
        h(DialogRow, { c, label: sx.fitRangeLabel },
            h(RangeField, {
                c, width: 72, unit: 'nm',
                from: {
                    value: fitConfig.rangeMin, min: curve.x[0], max: fitConfig.rangeMax,
                    step: 1, onChange: value => setFitOption('rangeMin', value),
                },
                to: {
                    value: fitConfig.rangeMax, min: fitConfig.rangeMin,
                    max: curve.x[curve.x.length - 1], step: 1,
                    onChange: value => setFitOption('rangeMax', value),
                },
            }),
        ),
        fitConfig.mode === 'thinned' && h(DialogRow, { c, label: sx.fitEveryLabel },
            h(NumInput, {
                c, value: fitConfig.thinEvery, min: 1, max: 1000, step: 1, width: 72,
                onChange: value => setFitOption('thinEvery', Math.round(value)),
            }),
        ),
        fitConfig.mode === 'uniform' && h(DialogRow, { c, label: sx.stepLabel },
            h(NumInput, {
                c, value: fitConfig.stepNm, min: 0.001, max: 1000, step: 0.1, width: 72,
                onChange: value => setFitOption('stepNm', value),
            }),
            h('span', { style: { color: c.textDim } }, 'nm'),
        ),
        h(DialogRow, { c, label: sx.fitWeightLabel },
            h(NumInput, {
                c, value: fitConfig.weight, min: 0, max: 1e9, step: 0.1, width: 72,
                onChange: value => setFitOption('weight', value),
            }),
        ),
        h(DialogRow, { c, label: sx.fitOutputLabel },
            h(ChoiceGroup, {
                c, activeId: fitConfig.outputMode,
                onSelect: value => setFitOption('outputMode', value),
                items: [
                    { id: 'append', label: sx.fitAppend, title: sx.fitAppendTip },
                    { id: 'replace', label: sx.fitReplace, title: sx.fitReplaceTip },
                ],
            }),
        ),

        h('div', {
            style: {
                margin: '12px 0 7px', paddingTop: 11, borderTop: `1px solid ${c.border}`,
            },
        }, h(CheckField, {
            c, label: sx.fitAddConstraints, checked: fitConfig.constraintsEnabled,
            onChange: () => setFitOption('constraintsEnabled', !fitConfig.constraintsEnabled),
            title: sx.fitConstraintsTip,
        })),
        fitConfig.constraintsEnabled && h('div', {
            style: { padding: '2px 0 5px 14px', borderLeft: `2px solid ${c.border}` },
        },
            h(DialogRow, { c, label: sx.fitMinThickness },
                h(NumInput, {
                    c, value: fitConfig.minThicknessNm, min: 0.01, max: 1e6,
                    step: 1, width: 72, onChange: value => setFitOption('minThicknessNm', value),
                }),
                h('span', { style: { color: c.textDim } }, 'nm'),
            ),
            h(DialogRow, { c, label: sx.fitMaxThickness },
                h(NumInput, {
                    c, value: fitConfig.maxThicknessNm, min: 0.01, max: 1e6,
                    step: 10, width: 72, onChange: value => setFitOption('maxThicknessNm', value),
                }),
                h('span', { style: { color: c.textDim } }, 'nm'),
            ),
            h(DialogRow, { c, label: sx.fitConstraintWeight },
                h(NumInput, {
                    c, value: fitConfig.constraintWeight, min: 0, max: 1e9,
                    step: 0.1, width: 72, onChange: value => setFitOption('constraintWeight', value),
                }),
            ),
        ),

        h('div', { style: { marginTop: 9, color: c.textDim, lineHeight: 1.45 } },
            sx.fitSamples(sampledCount)),
        missingMaterialIds.length > 0 && h(Notice, { tone: 'error', c },
            sx.designExportBlocked(missingMaterialIds.join(', '))),
        fitSnapshot.error && h(Notice, { tone: 'error', c },
            sx.fitErrors[fitSnapshot.error] || sx.fitErrors.range),
        constraintsInvalid && h(Notice, { tone: 'error', c }, sx.fitConstraintError),
        fitSnapshot.sampled?.clipped && fitSnapshot.sampled.range && h(Notice, { c },
            sx.fitClipped(fitSnapshot.sampled.range[0], fitSnapshot.sampled.range[1])),
        fitSnapshot.sampled?.stepTooFine && h(Notice, { c },
            sx.fitStepFine(fitSnapshot.sampled.spacingNm)),

        h('div', {
            style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 },
        },
            h(ActionButton, { c, label: sx.fitCancel, onClick: closeFitDialog }),
            h(ActionButton, {
                c, label: sx.fitCreate, onClick: onCreateFitOperand,
                disabled, title: disabled ? sx.fitCreateBlocked : sx.fitCreateTip,
            }),
        ),
    ));
}
