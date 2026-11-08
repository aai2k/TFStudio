import {
    ActionButton, CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { SidePanel } from '../../analysis/chrome/layout.js';
import { X_UNITS, X_UNIT_KEYS } from '../../../../utils/io/spectrumTable.js';
import { InlineRow, PanelSection } from '../chrome/panel.js';
import { deltaConventionItems } from './model.js';

const { createElement: h } = React;

const unitItems = units => [X_UNITS.NM, X_UNITS.UM, X_UNITS.EV].map(id => ({ id, label: units[X_UNIT_KEYS[id]] }));

function MeasuredPanel({ controller, c, mx, units }) {
    const { curves, expSelected, setExpSelected, expXUnit, setExpXUnit, onExportMeasured } = controller;
    return h(PanelSection, { c, title: mx.sourceMeasured },
        curves.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11, fontStyle: 'italic' } }, mx.noCurves)
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
                ...curves.map(curve => h(CheckField, {
                    key: curve.id, c,
                    label: `${curve.name} (${curve.quantity === 'PSI' ? 'Ψ' : 'Δ'}, ${curve.aoi ?? 0}°)`,
                    checked: expSelected[curve.id] !== false,
                    onChange: event => setExpSelected(curve.id, event.target.checked),
                })),
            ),
        h(InlineRow, { c, label: mx.unitLabel },
            h(ChoiceGroup, { c, activeId: expXUnit, onSelect: setExpXUnit, items: unitItems(units) }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: mx.exportMeasured, onClick: onExportMeasured, disabled: !curves.length }),
        ),
    );
}

function CalculatedPanel({ controller, c, mx, units }) {
    const {
        expStart, setExpStart, expEnd, setExpEnd, expStep, setExpStep,
        expAoi, setExpAoi, expXUnit, setExpXUnit, onExportCalculated,
        expDeltaConvention, setExpDeltaConvention, missingMaterialIds,
    } = controller;
    if (missingMaterialIds.length > 0) {
        return h(PanelSection, { c, title: mx.sourceCalculated },
            h('div', { role: 'alert', style: { color: c.error, fontSize: 11.5, lineHeight: 1.5 } },
                mx.errMaterials(missingMaterialIds.join(', '))),
        );
    }
    return h(PanelSection, { c, title: mx.sourceCalculated },
        h('div', { style: { fontSize: 11, color: c.textDim, lineHeight: 1.45 } }, mx.exportCalculatedDesc),
        h(InlineRow, { c, label: mx.rangeLabel },
            h(RangeField, {
                c, unit: units.nm,
                from: { value: expStart, onChange: setExpStart, positive: true, step: 10 },
                to: { value: expEnd, onChange: setExpEnd, positive: true, step: 10 },
            }),
            h(FieldLabel, { c }, mx.stepLabel),
            h(NumInput, { value: expStep, onChange: setExpStep, positive: true, step: 0.5, c, width: 56 }),
        ),
        h(InlineRow, { c, label: mx.aoiLabel },
            h(NumInput, { value: expAoi, onChange: setExpAoi, min: 0, max: 89.9, step: 0.1, c, width: 64 }),
            h('span', { style: { color: c.textDim, fontSize: 11 } }, '°'),
        ),
        h(InlineRow, { c, label: mx.unitLabel },
            h(ChoiceGroup, { c, activeId: expXUnit, onSelect: setExpXUnit, items: unitItems(units) }),
        ),
        // The sign Δ is written in: the one the instrument's software reads.
        // Its own setting, not the one an opened file was read under.
        h(InlineRow, { c, label: mx.deltaConventionLabel },
            h(ChoiceGroup, {
                c, activeId: expDeltaConvention, onSelect: setExpDeltaConvention,
                items: deltaConventionItems(mx),
            }),
        ),
        h(InlineRow, { c },
            h(ActionButton, { c, label: mx.exportCalculated, onClick: onExportCalculated }),
        ),
    );
}

export function ExportTab({ controller, c, mx, units }) {
    const { expSource, setExpSource } = controller;
    return h('div', {
        className: 'tfs-spectrum-import-container',
        style: { flex: 1, minHeight: 0, minWidth: 0 },
    },
        h(SidePanel, { c, width: '100%' },
            h(PanelSection, { c, title: mx.exportWhat },
                h(ChoiceGroup, {
                    c, activeId: expSource, onSelect: setExpSource,
                    items: [
                        { id: 'measured', label: mx.sourceMeasured },
                        { id: 'calculated', label: mx.sourceCalculated },
                    ],
                }),
            ),
            expSource === 'measured'
                ? h(MeasuredPanel, { controller, c, mx, units })
                : h(CalculatedPanel, { controller, c, mx, units }),
        ),
    );
}
