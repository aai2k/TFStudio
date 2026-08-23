import { Checkbox } from '../../../ui/Checkbox.js';
import { DebouncedInput } from '../../../ui/DebouncedInput.js';

const { createElement: h, Fragment } = React;

export function CleanerControls({
    c, dc, design, dMin, setDMin, mergeAdjacent, setMergeAdjacent,
    cleanBack, setCleanBack, reoptimize, setReoptimize,
    reoptIters, setReoptIters, applying, ops, apply,
    mode, setMode, meritBudget, setMeritBudget, meritIters, setMeritIters,
    meritDMin, setMeritDMin,
    meritBusy, analyzeMerit, autoEliminate, cancelMerit,
}) {
    const labelStyle = {
        color: c.textDim, fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const checkboxLabel = {
        display: 'flex', alignItems: 'center', gap: 4,
        cursor: 'pointer', color: c.text, fontSize: 11,
    };

    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            padding: '6px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0,
        }
    },
        h('select', {
            value: mode || 'threshold', onChange: event => setMode(event.target.value),
            style: { ...inputStyle, width: 155, height: 24 },
        },
            h('option', { value: 'threshold' }, dc.thresholdMode),
            h('option', { value: 'merit' }, dc.meritMode),
        ),
        mode !== 'merit' && h(Fragment, null,
            h('label', { style: labelStyle }, dc.minThickness,
                h(DebouncedInput, {
                    min: 0, max: 200, step: 0.5, value: dMin, inputMode: 'decimal',
                    onChange: raw => setDMin(Math.max(0, Number.parseFloat(raw) || 0)),
                    style: { ...inputStyle, marginLeft: 6, width: 60 }
                }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'nm')
            ),
            h('label', { style: checkboxLabel },
                h(Checkbox, {
                    c, checked: mergeAdjacent,
                    onChange: e => setMergeAdjacent(e.target.checked),
                }),
                dc.mergeAdjacent
            ),
        ),
        h('label', { style: checkboxLabel },
            h(Checkbox, {
                c, checked: cleanBack,
                onChange: e => setCleanBack(e.target.checked),
            }),
            dc.cleanBack
        ),
        mode !== 'merit' && h(Fragment, null,
            h('label', { style: checkboxLabel,
                title: design.meritOperands?.length ? '' : dc.reoptimizeNoOperands,
            },
                h(Checkbox, {
                    c, checked: reoptimize && design.meritOperands?.length > 0,
                    disabled: !design.meritOperands?.length,
                    onChange: e => setReoptimize(e.target.checked),
                }),
                dc.reoptimize
            ),
            reoptimize && design.meritOperands?.length > 0 && h('label', { style: labelStyle }, dc.reoptIters,
                h(DebouncedInput, {
                    min: 1, max: 500, step: 10, value: reoptIters, inputMode: 'numeric',
                    onChange: raw => setReoptIters(Math.max(1, Math.min(500, Number.parseInt(raw, 10) || 80))),
                    style: { ...inputStyle, marginLeft: 6, width: 55 }
                })
            ),
        ),
        mode === 'merit' && h(Fragment, null,
            h('label', { style: labelStyle }, dc.meritBudget,
                h(DebouncedInput, {
                    min: 0, step: 0.001, value: meritBudget, inputMode: 'decimal',
                    onChange: raw => setMeritBudget(Math.max(0, Number.parseFloat(raw) || 0)),
                    style: { ...inputStyle, marginLeft: 6, width: 72 },
                })
            ),
            h('label', { style: labelStyle }, dc.meritIters,
                h(DebouncedInput, {
                    min: 1, max: 250, step: 10, value: meritIters, inputMode: 'numeric',
                    onChange: raw => setMeritIters(Math.max(1, Math.min(250, Number.parseInt(raw, 10) || 1))),
                    style: { ...inputStyle, marginLeft: 6, width: 55 },
                })
            ),
            h('label', { style: labelStyle }, dc.meritDMin,
                h(DebouncedInput, {
                    min: 0.001, max: 200, step: 0.1, value: meritDMin, inputMode: 'decimal',
                    onChange: raw => setMeritDMin(Math.max(0.001, Number.parseFloat(raw) || 0.001)),
                    style: { ...inputStyle, marginLeft: 6, width: 62 },
                }),
                h('span', { style: { color: c.textDim, marginLeft: 2 } }, dc.unitNm)
            ),
        ),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            mode === 'merit' && meritBusy && h('button', {
                onClick: cancelMerit,
                style: {
                    padding: '3px 10px', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${c.error}`, borderRadius: 3,
                    background: 'transparent', color: c.error, outline: 'none',
                },
            }, dc.cancelAnalysis),
            mode === 'merit' && h('button', {
                onClick: analyzeMerit, disabled: meritBusy || !design.meritOperands?.length,
                style: {
                    padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    background: 'transparent', color: c.text, outline: 'none',
                    opacity: meritBusy ? 0.5 : 1,
                }
            }, meritBusy ? dc.analyzing : dc.analyzeLayers),
            mode === 'merit' && h('button', {
                onClick: autoEliminate, disabled: meritBusy || !design.meritOperands?.length,
                style: {
                    padding: '3px 12px', fontSize: 12, cursor: 'pointer',
                    border: `1px solid ${c.accent}`, borderRadius: 3,
                    background: c.accent + '33', color: c.accent, outline: 'none', fontWeight: 600,
                    opacity: meritBusy ? 0.5 : 1,
                },
            }, dc.eliminateBudget),
            mode !== 'merit' && h('button', {
                onClick: apply, disabled: applying || ops.length === 0,
                style: {
                    padding: '3px 14px', fontSize: 12, cursor: ops.length ? 'pointer' : 'not-allowed',
                    border: `1px solid ${ops.length ? c.accent : c.border}`, borderRadius: 3,
                    background: ops.length ? c.accent + '33' : 'transparent',
                    color: ops.length ? c.accent : c.textDim,
                    outline: 'none', fontWeight: 600, opacity: applying ? 0.5 : 1,
                },
            }, applying ? dc.applying : `${dc.apply} (${ops.length})`)
        )
    );
}
