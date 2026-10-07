import { CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import { Btn, Label, Num, Seg } from '../zemaxCoatings/ui.js';
import { AnglesField } from './AnglesField.js';
import { analysisWavelengths, sideStack } from './exportModel.js';
import { Field, TextField, WarningList } from './parts.js';

const { createElement: h } = React;

function ExportOptions({ c, z, side, setSide, title, setTitle, saveName, setSaveName, refNm, setRefNm }) {
    return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-end' } },
        h(Field, { c, label: z.side },
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: side === 'front', onClick: () => setSide('front'), c, position: 'first' }, z.sideFront),
                h(Seg, { active: side === 'back', onClick: () => setSide('back'), c, position: 'last' }, z.sideBack),
            ),
        ),
        h(Field, { c, label: z.titleField },
            h(TextField, { c, value: title, onChange: setTitle, width: 220, maxLength: CODEV_LIMITS.title })),
        h(Field, { c, label: z.saveName },
            h(TextField, { c, value: saveName, onChange: setSaveName, width: 140 })),
        h(Field, { c, label: z.refWavelength },
            h(Num, { value: refNm, onChange: setRefNm, positive: true, step: 10, c, width: 70 })),
    );
}

function WavelengthGrid({ c, z, gStart, setGStart, gEnd, setGEnd, gStep, setGStep }) {
    const { count } = analysisWavelengths(gStart, gEnd, gStep);
    const tooMany = count > CODEV_LIMITS.wavelengths;
    return h(Field, { c, label: z.wavelengths },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' } },
            h(Label, { c }, z.from), h(Num, { value: gStart, onChange: setGStart, positive: true, step: 10, c, width: 64 }),
            h(Label, { c }, z.to), h(Num, { value: gEnd, onChange: setGEnd, positive: true, step: 10, c, width: 64 }),
            h(Label, { c }, z.step), h(Num, { value: gStep, onChange: setGStep, positive: true, step: 5, c, width: 56 }),
            h('span', { style: { fontSize: 11, color: tooMany ? c.error : c.textDim } },
                tooMany ? z.errTooManyWavelengths(count, CODEV_LIMITS.wavelengths) : z.wavelengthCount(count)),
        ),
    );
}

function Preview({ c, z, preview }) {
    return h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120 } },
        h(Label, { c }, z.preview),
        h('textarea', {
            value: preview, readOnly: true, spellCheck: false,
            style: {
                flex: 1, marginTop: 4, width: '100%', resize: 'none',
                background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4,
                fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10.5, padding: 8, outline: 'none', whiteSpace: 'pre',
            },
        }),
    );
}

export function ExportTab(props) {
    const { c, z, design, side, preview, exportWarnings, onGenerate, onSave, missingMaterialIds } = props;
    if (missingMaterialIds.length > 0) {
        return h('div', {
            role: 'alert',
            style: { color: c.error, fontSize: 11.5, lineHeight: 1.5 },
        }, z.exportBlocked(missingMaterialIds.join(', ')));
    }
    const layerCount = sideStack(design, side).layers.length;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, height: '100%' } },
        h('div', { style: { fontSize: 12, fontWeight: 600 } }, z.exportTitle),
        h('div', { style: { fontSize: 10.5, color: c.textDim } }, z.exportHint(layerCount)),
        h(ExportOptions, props),
        h(WavelengthGrid, props),
        h(AnglesField, props),
        h('div', { style: { display: 'flex', gap: 8 } },
            h(Btn, { onClick: onGenerate, c, primary: true }, z.generate),
            h(Btn, { onClick: onSave, c, disabled: !preview }, z.saveBtn),
        ),
        h(WarningList, { c, z, warnings: exportWarnings }),
        h(Preview, { c, z, preview }),
    );
}
