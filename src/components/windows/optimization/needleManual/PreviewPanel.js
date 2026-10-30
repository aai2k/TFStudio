// Insertion preview panel: picked geometry, predicted optical merit, and the
// Apply button, with Stop beside it while the starting thickness of a pick is
// searched for or the refine after Apply runs.

import { matFriendlyName, matColor } from '../synthesisShared/synthesisHelpers.js';
import { NumberField } from '../../../ui/numberField.js';
import { provisionalMark } from '../provisionalMark.js';

const { createElement: h } = React;

// Materials are named and coloured as `design` resolves them. `picking` is on
// while the starting thickness is searched for, `stoppable` while Stop shows.
export function PreviewPanel({
    selected, hostInfo, dNew, dRange, predictedOMF, omf0, predictedProvisional, omf0Provisional, evaluationBusy,
    picking, onDNew, onApply, onStop, busy, stoppable, design, c, t,
}) {
    const tn = t.needleManual;
    if (!selected) {
        return h('div', { style: { padding: '12px 12px', color: c.textDim, fontSize: 12, fontStyle: 'italic' } }, tn.clickHint);
    }

    const name  = matFriendlyName(selected.materialId, design);
    const geom = selected.intra
        ? tn.geomIntra(name, hostInfo.hostNumber, matFriendlyName(hostInfo.hostMat, design),
            hostInfo.d1.toFixed(1), dNew.toFixed(1), hostInfo.d2.toFixed(1))
        : tn.geomGap(name, selected.z.toFixed(1), hostInfo.gapLabel);

    return h('div', { style: { padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 7 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('span', { style: { width: 12, height: 12, borderRadius: 2, background: matColor(selected.materialId, design), display: 'inline-block' } }),
            h('span', { style: { fontSize: 13, fontWeight: 700, color: c.text } }, name),
            h('span', { style: { fontSize: 11, color: c.textDim } }, `z = ${selected.z.toFixed(1)} ${t.units.nm}`),
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
            h(NumberField, {
                min: dRange[0], max: dRange[1], step: 0.5, value: +dNew.toFixed(2), disabled: busy,
                onChange: onDNew,
                style: { width: 64, padding: '1px 4px', fontSize: 11, textAlign: 'right', background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 2 }
            }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, t.units.nm),
        ),
        picking
            ? h('div', { style: { fontSize: 11, color: c.textDim } }, tn.picking)
            : h(MeritLine, { predictedOMF, omf0, predictedProvisional, omf0Provisional, evaluationBusy, c, t }),
        h(ApplyRow, { onApply, onStop, busy, stoppable, c, tn })
    );
}

// Optical merit block. The needle scan is optical-only (constraints are
// dropped), and a freshly inserted thin needle always starts below MNT, so
// the preview reports OMF (constraint-free): the full MF's transient
// penalty would swamp the optical gain the insertion actually delivers.
// Constraints are re-imposed by the refine after Apply. A value read with a
// row at its default step in place of its own Step is marked until the value
// at the rows' own Steps comes (provisionalMark.js).
function MeritLine({ predictedOMF, omf0, predictedProvisional, omf0Provisional, evaluationBusy, c, t }) {
    const tn = t.needleManual;
    if (evaluationBusy) {
        return h('div', { style: { fontSize: 11, color: c.textDim } }, t.analysisEvaluation.computing);
    }
    const dMF   = (predictedOMF != null && omf0 != null) ? (predictedOMF - omf0) : null;
    const dMFColor = dMF == null ? c.text : (dMF < 0 ? c.success : c.error);
    const tip = t.meritFunctionEditor.provisionalTip;
    const item = (label, text, provisional, color) => {
        const mark = provisionalMark(provisional && text !== '—', tip);
        return h('span', { title: mark.title, style: { opacity: mark.opacity } },
            label, ' ', h('b', { style: { color } }, mark.prefix + text));
    };
    return h('div', { style: { display: 'flex', gap: 16, fontSize: 11, color: c.textDim } },
        item(tn.omf0, omf0 == null ? '—' : omf0.toFixed(6), omf0Provisional, c.text),
        item(tn.omfPred, predictedOMF == null ? '—' : predictedOMF.toFixed(6), predictedProvisional, c.text),
        item(tn.dMF, dMF == null ? '—' : (dMF < 0 ? '' : '+') + dMF.toFixed(6),
            omf0Provisional || predictedProvisional, dMFColor),
    );
}

function ApplyRow({ onApply, onStop, busy, stoppable, c, tn }) {
    return h('div', { style: { display: 'flex', gap: 6 } },
        h('button', {
            onClick: onApply, disabled: busy,
            style: {
                padding: '4px 16px', fontSize: 12, border: 'none', borderRadius: 3,
                background: busy ? c.border : c.success, color: '#fff',
                cursor: busy ? 'default' : 'pointer', fontWeight: 600, fontFamily: 'inherit', opacity: busy ? 0.6 : 1,
            }
        }, tn.apply),
        stoppable && h(StopButton, { onStop, c, tn })
    );
}

// The window's Stop, beside Apply and, while the profile scan runs, beside
// Compute P-function.
export function StopButton({ onStop, c, tn, style = null }) {
    return h('button', {
        onClick: onStop,
        style: {
            padding: '4px 16px', fontSize: 12, cursor: 'pointer',
            border: `1px solid ${c.error}`, borderRadius: 3,
            background: c.error + '33', color: c.error,
            fontWeight: 600, fontFamily: 'inherit', ...style,
        }
    }, tn.stop);
}
