import { Checkbox } from '../../../ui/Checkbox.js';
import { NumberField } from '../../../ui/numberField.js';
import { CLEANER_REFINERS } from './sessionState.js';

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

// The refiner the re-optimize pass runs, named as the Refinement window names
// its methods (`tr` is its strings).
function RefinerSelect({ c, tr, value, onChange, disabled }) {
    return h('select', {
        value, disabled, 'aria-label': tr.method, title: tr.methodNotes[value] || '',
        onChange: e => onChange(e.target.value),
        style: {
            background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2,
            fontSize: 11, padding: '2px 4px', cursor: disabled ? 'default' : 'pointer',
        },
    }, CLEANER_REFINERS.map(m => h('option', { key: m, value: m, title: tr.methodNotes[m] || '' }, tr.methods[m])));
}

export function CleanerControls({
    c, dc, tr, units, design, dMin, setDMin, mergeAdjacent, setMergeAdjacent,
    cleanBack, setCleanBack, reoptimize, setReoptimize,
    reoptIters, setReoptIters, reoptMethod, setReoptMethod, applying, progress, ops, apply, stop,
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
            h(NumberField, { spin: true, c,
                min: 0, max: 200, step: 0.5, value: dMin, disabled: applying,
                onChange: setDMin,
                style: { ...inputStyle, marginLeft: 6, width: 60 }
            }),
            h('span', { style: { color: c.textDim, marginLeft: 2 } }, units.nm)
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
        reoptimize && design.meritOperands?.length > 0 && h(RefinerSelect, {
            c, tr, value: reoptMethod, onChange: setReoptMethod, disabled: applying,
        }),
        reoptimize && design.meritOperands?.length > 0 && h('label', { style: labelStyle }, dc.reoptIters,
            h(NumberField, { spin: true, c,
                min: 1, max: 500, step: 10, integer: true, value: reoptIters, disabled: applying,
                onChange: setReoptIters,
                style: { ...inputStyle, marginLeft: 6, width: 55 }
            })
        ),
        h(ApplyGroup, { c, dc, applying, progress, ops, apply, stop })
    );
}
