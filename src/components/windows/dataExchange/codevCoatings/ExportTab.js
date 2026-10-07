import { CODEV_LIMITS } from '../../../../utils/io/codevCoatingFile.js';
import {
    ActionButton, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import {
    FilePreview, InlineRow, PanelSection, TextInput,
} from '../chrome/panel.js';
import { AnglesField } from './AnglesField.js';
import { analysisWavelengths, sideStack } from './exportModel.js';

const { createElement: h } = React;

// The side written, and the commands named after the design or taken from it.
function StackOptions({ c, z, side, setSide, title, setTitle, saveName, setSaveName, refNm, setRefNm }) {
    return h(React.Fragment, null,
        h(InlineRow, { c, label: z.side },
            h(ChoiceGroup, {
                c, activeId: side, onSelect: setSide,
                items: [{ id: 'front', label: z.sideFront }, { id: 'back', label: z.sideBack }],
            }),
        ),
        h(InlineRow, { c, label: z.titleField },
            h(TextInput, { c, value: title, onChange: setTitle, width: 240, maxLength: CODEV_LIMITS.title })),
        h(InlineRow, { c, label: z.saveName },
            h(TextInput, { c, value: saveName, onChange: setSaveName, width: 160 })),
        h(InlineRow, { c, label: z.refWavelength },
            h(NumInput, { value: refNm, onChange: setRefNm, positive: true, step: 10, c, width: 70 })),
    );
}

// From, to and step of the WL list, with the count they give; past CODE V's
// limit the count is shown as the refusal Generate would give.
function WavelengthRow({ c, z, gStart, setGStart, gEnd, setGEnd, gStep, setGStep }) {
    const { count } = analysisWavelengths(gStart, gEnd, gStep);
    const tooMany = count > CODEV_LIMITS.wavelengths;
    return h(InlineRow, { c, label: z.wavelengths },
        h(RangeField, {
            c,
            from: { value: gStart, onChange: setGStart, positive: true, step: 10 },
            to: { value: gEnd, onChange: setGEnd, positive: true, step: 10 },
        }),
        h(FieldLabel, { c }, z.step),
        h(NumInput, { value: gStep, onChange: setGStep, positive: true, step: 5, c, width: 56 }),
        h('span', { style: { fontSize: 11, color: tooMany ? c.error : c.textDim } },
            tooMany ? z.errTooManyWavelengths(count, CODEV_LIMITS.wavelengths) : z.wavelengthCount(count)),
    );
}

function ExportOptions(props) {
    const { c, z, design, side, preview, onGenerate, onSave } = props;
    return h(PanelSection, { c, title: z.exportTitle },
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } },
            z.exportHint(sideStack(design, side).layers.length)),
        h(StackOptions, props),
        h(WavelengthRow, props),
        h(AnglesField, props),
        h(InlineRow, { c },
            h(ActionButton, { c, label: z.generate, onClick: onGenerate }),
            h(ActionButton, { c, label: z.saveBtn, onClick: onSave, disabled: !preview }),
        ),
    );
}

export function ExportTab(props) {
    const { c, z, missingMaterialIds, preview } = props;
    if (missingMaterialIds.length > 0) {
        return h(PanelSection, { c, title: z.exportTitle },
            h('div', { role: 'alert', style: { color: c.error, fontSize: 11.5, lineHeight: 1.5 } },
                z.exportBlocked(missingMaterialIds.join(', '))),
        );
    }
    return h('div', { style: { flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' } },
        h(ExportOptions, props),
        h(FilePreview, { c, title: z.preview, text: preview }),
    );
}
