import { yieldBand } from '../../../../utils/physics/errorAnalysis/mcResult.js';

const { createElement: h } = React;

/** Theme colour for a specification yield, by the band it falls in. */
export function yieldColor(c, value) {
    const band = yieldBand(value);
    if (band === 'pass') return c.success;
    if (band === 'warn') return c.warning;
    return band === 'fail' ? c.error : c.textDim;
}

export function chip(txt, color, tip, key) {
    return h('span', {
        key, title: tip,
        style: {
            fontSize: 10, fontWeight: 600, color,
            padding: '1px 6px', borderRadius: 9,
            background: `${color}1a`, border: `1px solid ${color}55`,
            whiteSpace: 'nowrap',
        }
    }, txt);
}

export function tableStyles(c) {
    return {
        th: {
            padding: '3px 8px', fontWeight: 600, fontSize: 11, color: c.textDim,
            textAlign: 'right', position: 'sticky', top: 0, background: c.panel,
            borderBottom: `1px solid ${c.border}`, whiteSpace: 'nowrap',
        },
        td: {
            padding: '2px 8px', fontSize: 11, textAlign: 'right',
            fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
        },
    };
}
