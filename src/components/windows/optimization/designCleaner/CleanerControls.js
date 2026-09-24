import { Checkbox } from '../../../ui/Checkbox.js';

const { createElement: h } = React;

// Apply, and while the re-optimize pass runs, its step count and best merit
// with a Stop button. Stop keeps the cleanup and the best point reached.
function ApplyGroup({ c, dc, applying, progress, ops, apply, stop }) {
    return h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
        progress && h('span', {
            style: { fontSize: 11, color: c.accent || '#ffa726', fontStyle: 'italic' }
        }, dc.refining(progress.step, progress.iters, progress.mf)),
        progress && h('button', {
            onClick: stop,
            style: {
                padding: '3px 14px', fontSize: 12, cursor: 'pointer',
                border: `1px solid ${c.error}`, borderRadius: 3,
                background: c.error + '33', color: c.error,
                outline: 'none', fontWeight: 600,
            }
        }, dc.stop),
        h('button', {
            onClick: apply, disabled: applying || ops.length === 0,
            style: {
                padding: '3px 14px', fontSize: 12, cursor: ops.length ? 'pointer' : 'not-allowed',
                border: `1px solid ${ops.length ? c.accent : c.border}`, borderRadius: 3,
                background: ops.length ? c.accent + '33' : 'transparent',
                color: ops.length ? c.accent : c.textDim,
                outline: 'none', fontWeight: 600,
                opacity: applying ? 0.5 : 1,
            }
        }, applying ? dc.applying : `${dc.apply} (${ops.length})`)
    );
}

export function CleanerControls({
    c, dc, design, dMin, setDMin, mergeAdjacent, setMergeAdjacent,
    cleanBack, setCleanBack, reoptimize, setReoptimize,
    reoptIters, setReoptIters, applying, progress, ops, apply, stop,
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
        h('label', { style: labelStyle }, dc.minThickness,
            h('input', {
                type: 'number', min: 0, max: 200, step: 0.5, value: dMin, disabled: applying,
                onChange: e => setDMin(parseFloat(e.target.value) || 0),
                style: { ...inputStyle, marginLeft: 6, width: 60 }
            }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, 'nm')
        ),
        h('label', { style: checkboxLabel },
            h(Checkbox, {
                c, checked: mergeAdjacent, disabled: applying,
                onChange: e => setMergeAdjacent(e.target.checked),
            }),
            dc.mergeAdjacent
        ),
        h('label', { style: checkboxLabel },
            h(Checkbox, {
                c, checked: cleanBack, disabled: applying,
                onChange: e => setCleanBack(e.target.checked),
            }),
            dc.cleanBack
        ),
        h('label', { style: checkboxLabel,
            title: design.meritOperands?.length ? '' : dc.reoptimizeNoOperands,
        },
            h(Checkbox, {
                c, checked: reoptimize && design.meritOperands?.length > 0,
                disabled: applying || !design.meritOperands?.length,
                onChange: e => setReoptimize(e.target.checked),
            }),
            dc.reoptimize
        ),
        reoptimize && design.meritOperands?.length > 0 && h('label', { style: labelStyle }, dc.reoptIters,
            h('input', {
                type: 'number', min: 1, max: 500, step: 10, value: reoptIters, disabled: applying,
                onChange: e => setReoptIters(parseInt(e.target.value) || 80),
                style: { ...inputStyle, marginLeft: 6, width: 55 }
            })
        ),
        h(ApplyGroup, { c, dc, applying, progress, ops, apply, stop })
    );
}
