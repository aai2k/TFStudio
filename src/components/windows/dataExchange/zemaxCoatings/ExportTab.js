import {
    ActionButton, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import {
    FilePreview, InlineRow, PanelSection, TextInput,
} from '../chrome/panel.js';

const { createElement: h } = React;

function ExportOptions(props) {
    const {
        c, z, design, thMode, setThMode, scope, setScope, coatName, setCoatName, refNm,
        gStart, setGStart, gEnd, setGEnd, gStep, setGStep, preview, onGenerate, onSave,
    } = props;
    return h(PanelSection, { c, title: z.exportTitle },
        h('div', { style: { fontSize: 11, color: c.textDim } }, z.frontLayerCount((design.frontLayers || []).length)),
        h(InlineRow, { c, label: z.thicknessMode },
            h(ChoiceGroup, {
                c, activeId: thMode, onSelect: setThMode,
                items: [{ id: 'absolute', label: z.thicknessAbs }, { id: 'relative', label: z.thicknessRel }],
            }),
        ),
        h('div', { style: { fontSize: 10.5, color: c.textDim, lineHeight: 1.45 } },
            thMode === 'absolute' ? z.thicknessAbsHint : `${z.thicknessRelHint}  (λ₀ = ${refNm} nm)`),
        h(InlineRow, { c, label: z.materialScope },
            h(ChoiceGroup, {
                c, activeId: scope, onSelect: setScope,
                items: [{ id: 'used', label: z.scopeUsed }, { id: 'all', label: z.scopeAll }],
            }),
        ),
        h(InlineRow, { c, label: z.coatingName },
            h(TextInput, { c, value: coatName, onChange: setCoatName, width: 200 }),
        ),
        h(InlineRow, { c, label: z.sampleGrid },
            h(RangeField, {
                c,
                from: { value: gStart, onChange: setGStart, positive: true, step: 10 },
                to: { value: gEnd, onChange: setGEnd, positive: true, step: 10 },
            }),
            h(FieldLabel, { c }, z.step),
            h(NumInput, { value: gStep, onChange: setGStep, positive: true, step: 5, c, width: 56 }),
        ),
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
