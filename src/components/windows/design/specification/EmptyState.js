import { btnStyle } from './fields.js';

const { createElement: h } = React;

export function EmptyState({ c, ts, addQualifier }) {
    const suggested = ['T_AVG', 'CENTRAL_LAMBDA', 'FWHM', 'INTEGRAL'];
    return h('div', {
        style: {
            padding: 32, textAlign: 'center', color: c.textDim, fontSize: 12,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        }
    },
        h('div', { style: { fontSize: 13, color: c.text, opacity: 0.6 } },
          ts.emptyTitle || 'No design requirements yet.'),
        h('div', null, ts.emptyHint || 'Add specifications your design must satisfy (T/R/A levels, central wavelength, FWHM, integral targets, etc.).'),
        h('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 } },
            suggested.map(k => h('button', {
                key: k, onClick: () => addQualifier(k),
                style: { ...btnStyle(c), background: c.bg },
            }, '+ ' + ((ts.kinds && ts.kinds[k]) || k)))
        )
    );
}
