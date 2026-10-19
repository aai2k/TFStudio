// The Step and side selects of a Specification row (QRow.js).

import { checkStepKind, budgetSide } from '../../../../utils/synthesis/qualifiers.js';
import { extremumStepNm } from '../../../../utils/physics/optimizer.js';
import { Field, selStyle } from './fields.js';

const { createElement: h } = React;

// The Step of a check (checkStepKind), the flags its merit row takes. A peak,
// centre, FWHM or edge check searches at 1 nm without one; an average or
// integral check takes its grid from the design's fringes, so 1 nm is one of
// its choices.
export function renderStep(q, onF, c, ts, units) {
    const kind = checkStepKind(q);
    if (!kind) return null;
    const flags = kind === 'band' ? [1, 2, 3, 4] : [2, 3, 4];
    const value = flags.includes(q.flag) ? String(q.flag) : '';
    const nm = flag => `${extremumStepNm({ flag })} ${units.nm}`;
    return h(Field, { label: ts.step, c, tip: ts.stepTips[kind] },
        h('select', {
            value, onChange: e => onF('flag', e.target.value ? Number(e.target.value) : undefined),
            style: { ...selStyle(c), width: 82 },
        },
            h('option', { value: '', style: { background: c.panel } }, kind === 'band' ? ts.stepAuto : nm(1)),
            flags.map(f => h('option', { key: f, value: String(f), style: { background: c.panel } }, nm(f))),
        )
    );
}

// Side a thickness budget or layer count adds up
export function renderSide(meta, q, onF, c, ts) {
    return meta.side && h(Field, { label: ts.side, c, tip: ts.sideTip },
        h('select', {
            value: budgetSide(q), onChange: e => onF('side', e.target.value),
            style: { ...selStyle(c), width: 92 },
        },
            h('option', { value: 'front', style: { background: c.panel } }, ts.sideFront),
            h('option', { value: 'back',  style: { background: c.panel } }, ts.sideBack),
            h('option', { value: 'both',  style: { background: c.panel } }, ts.sideBoth),
        )
    );
}
