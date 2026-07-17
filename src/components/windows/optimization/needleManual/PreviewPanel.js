// Insertion preview panel: picked geometry, predicted optical merit, and the
// Apply button.

import { matDisplayName, matColor } from '../synthesisShared/synthesisHelpers.js';

const { createElement: h } = React;

export function PreviewPanel({ selected, hostInfo, dNew, dRange, predictedOMF, omf0, onDNew, onApply, busy, c, t }) {
    const tn = t.needleManual;
    if (!selected) {
        return h('div', { style: { padding: '12px 12px', color: c.textDim, fontSize: 12, fontStyle: 'italic' } }, tn.clickHint);
    }

    const name  = matDisplayName(selected.materialId);
    const dMF   = (predictedOMF != null && omf0 != null) ? (predictedOMF - omf0) : null;
    const dMFColor = dMF == null ? c.text : (dMF < 0 ? c.success : c.error);

    const geom = selected.intra
        ? tn.geomIntra(name, selected.layerK + 1, matDisplayName(hostInfo.hostMat),
            hostInfo.d1.toFixed(1), dNew.toFixed(1), hostInfo.d2.toFixed(1))
        : tn.geomGap(name, selected.z.toFixed(1), hostInfo.gapLabel);

    return h('div', { style: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 7 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { width: 12, height: 12, borderRadius: 2, background: matColor(selected.materialId), display: 'inline-block' } }),
            h('span', { style: { fontSize: 13, fontWeight: 700, color: c.text } }, name),
            h('span', { style: { fontSize: 11, color: c.textDim } }, `z = ${selected.z.toFixed(1)} nm`),
        ),
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.4 } }, geom),
        // Thickness slider
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' } }, tn.dNew),
            h('input', {
                type: 'range', min: dRange[0], max: dRange[1], step: 0.5, value: dNew, disabled: busy,
                onChange: e => onDNew(parseFloat(e.target.value)),
                style: { flex: 1 }
            }),
            h('input', {
                type: 'number', min: dRange[0], max: dRange[1], step: 0.5, value: +dNew.toFixed(2), disabled: busy,
                onChange: e => { const v = parseFloat(e.target.value); if (!isNaN(v)) onDNew(v); },
                style: { width: 64, padding: '1px 4px', fontSize: 11, textAlign: 'right', background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2 }
            }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, 'nm'),
        ),
        // Optical merit block. The needle scan is optical-only (constraints are
        // dropped), and a freshly inserted thin needle always starts below MNT, so
        // the preview reports OMF (constraint-free) — the full MF's transient
        // penalty would swamp the optical gain the insertion actually delivers.
        // Constraints are re-imposed by the DLS refine after Apply.
        h('div', { style: { display: 'flex', gap: 16, fontSize: 11, color: c.textDim } },
            h('span', null, tn.omf0, ' ', h('b', { style: { color: c.text } }, omf0 == null ? '—' : omf0.toFixed(6))),
            h('span', null, tn.omfPred, ' ', h('b', { style: { color: c.text } }, predictedOMF == null ? '—' : predictedOMF.toFixed(6))),
            h('span', null, tn.dMF, ' ', h('b', { style: { color: dMFColor } }, dMF == null ? '—' : (dMF < 0 ? '' : '+') + dMF.toFixed(6))),
        ),
        h('div', null,
            h('button', {
                onClick: onApply, disabled: busy,
                style: {
                    padding: '4px 16px', fontSize: 12, border: 'none', borderRadius: 3,
                    background: busy ? c.border : c.success, color: '#fff',
                    cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
                }
            }, tn.apply)
        )
    );
}
