// Left sidebar: material pool selection + scan/refine settings.

import { Checkbox } from '../../../ui/Checkbox.js';
import { MaterialPoolPanel } from '../synthesisShared/synthesisHelpers.js';

const { createElement: h } = React;

export function LeftSidebar({
    catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
    excludedMats, onToggleMat,
    deltaNm, dMin, nIntra, refineAfter, dlsIter,
    onDeltaNm, onDMin, onNIntra, onRefineAfter, onDlsIter,
    showSideRadio, requestedSide, onRequestedSide,
    busy, c, t,
}) {
    const tn = t.needleManual;

    const numRow = (label, value, onChange, min, step = 1) =>
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 } },
            h('span', { style: { fontSize: 11, color: c.textDim } }, label),
            h('input', {
                type: 'number', value, min, step, disabled: busy,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onChange(v); },
                style: {
                    width: 58, padding: '1px 4px', fontSize: 11, textAlign: 'right',
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`,
                    borderRadius: 2, opacity: busy ? 0.5 : 1,
                }
            })
        );

    return h('div', {
        style: {
            width: 200, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            display: 'flex', flexDirection: 'column', background: c.panel, overflow: 'hidden',
        }
    },
        h(MaterialPoolPanel, {
            catalogs, selectedCats, onToggleCat, onSelectAllCats, onClearCats,
            excludedMats, onToggleMat, running: busy, c,
            labels: { materialPool: tn.materialPool, poolAll: tn.poolAll, poolClear: tn.poolClear },
            warnLabel: t.pool.warn,
        }),
        // Settings
        h('div', { style: { padding: '6px 8px', flexShrink: 0 } },
            h('div', { style: { fontSize: 10, fontWeight: 700, color: c.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 } }, tn.settings),
            showSideRadio && h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 5 } },
                h('span', { style: { fontSize: 11, color: c.textDim } }, tn.side),
                ['front', 'back'].map(sd => h('label', {
                    key: sd, style: { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 11, cursor: busy ? 'default' : 'pointer' }
                },
                    h('input', { type: 'radio', name: 'nm-side', checked: requestedSide === sd, disabled: busy, onChange: () => onRequestedSide(sd) }),
                    sd === 'front' ? tn.front : tn.back
                ))
            ),
            numRow(tn.deltaNm, deltaNm, v => onDeltaNm(Math.max(0.05, v)), 0.05, 0.1),
            numRow(tn.dMin,    dMin,    v => onDMin(Math.max(0.1, v)),     0.1,  1.0),
            numRow(tn.profileRes, nIntra, v => onNIntra(Math.max(2, Math.min(60, Math.round(v)))), 2, 1),
            h('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: c.textDim, margin: '4px 0 3px' } },
                h(Checkbox, { c, checked: refineAfter, disabled: busy, onChange: e => onRefineAfter(e.target.checked) }),
                tn.refineAfter),
            refineAfter && numRow(tn.dlsIter, dlsIter, v => onDlsIter(Math.max(10, Math.round(v))), 10)
        )
    );
}
