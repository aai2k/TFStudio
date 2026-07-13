/**
 * Integral Values - weighted averages of T(lambda), R(lambda), and A(lambda).
 * Spectrum evaluation follows the active surface mode and cone configuration;
 * weighting and integration are implemented in the physics utility modules.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { EvaluationControls, CustomBuilder } from './Controls.js';
import { ResultsTable } from './ResultsTable.js';
import { ChartPanel, Placeholder, StatusBar } from './Panels.js';
import { SpectrumTableEditor } from './SpectrumTableEditor.js';
import { hasLayersForMode } from './integralModel.js';
import { useIntegralValues } from './useIntegralValues.js';

const { createElement: h } = React;

function editorTable(model) {
    if (!model.editor.open) return null;
    if (model.editor.target === 'source') return model.builder.source.table;
    if (model.editor.target === 'detector') return model.builder.detector.table;
    return null;
}

function editorLabel(model, iv) {
    if (model.editor.target === 'source') return iv.source;
    if (model.editor.target === 'detector') return iv.detector;
    return '';
}

export function IntegralValues(props) {
    const { c, theme, t } = props;
    const iv = t.integralValues;
    const { design, evalMode } = useDesign();
    const model = useIntegralValues(design, evalMode);

    if (!design) return h(Placeholder, { message: iv.noDesign, c });
    if (!hasLayersForMode(design, evalMode)) {
        return h(Placeholder, { message: iv.noLayers, c });
    }

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        },
    },
        h(EvaluationControls, { params: model.params, setParams: model.setParams, c, t }),
        h(CustomBuilder, {
            builder: model.builder,
            setBuilder: model.setBuilder,
            onAdd: model.onAddCustom,
            openEditor: model.openEditor,
            c,
            t,
        }),
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' } },
            h(ResultsTable, {
                integrals: model.integrals,
                results: model.results,
                selectedKey: model.selKey,
                setSelectedKey: model.setSelKey,
                onPatch: model.onPatchCustom,
                onRemove: model.onRemoveCustom,
                c,
                t,
            }),
            h(ChartPanel, {
                spectrum: model.spectrum,
                selected: model.selected,
                selectedResult: model.selectedResult,
                c,
                theme,
                t,
            }),
        ),
        h(StatusBar, {
            design,
            spectrum: model.spectrum,
            params: model.params,
            customCount: model.customDefs.length,
            c,
            t,
        }),
        h(SpectrumTableEditor, {
            open: model.editor.open,
            initialTable: editorTable(model),
            label: editorLabel(model, iv),
            onApply: model.applyTable,
            onCancel: () => model.setEditor({ open: false, target: null }),
            c,
            t,
        }),
    );
}
