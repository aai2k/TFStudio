import { SensitivityBars } from './SensitivityBars.js';
import { SensitivityControls } from './SensitivityControls.js';
import { SensitivityPlaceholder, SensitivitySummary } from './SensitivityStatus.js';
import { SensitivityTable } from './SensitivityTable.js';
import { useLayerSensitivity } from './useLayerSensitivity.js';

const { createElement: h } = React;

export function LayerSensitivity({ c, theme, t }) {
    const state = useLayerSensitivity();
    const { design, operands, sensHasLayers, result, error, rows, orderedRows } = state;
    const ls = t.layerSensitivity;
    const placeholder = message => h(SensitivityPlaceholder, { message, c });

    if (!design) return placeholder(ls.noDesign);
    if (!sensHasLayers) return placeholder(ls.noLayers);
    if (!operands.length) return placeholder(ls.noOperands);

    const status = h(SensitivitySummary, {
        result, peakRank1: state.peakRank1, frontCount: state.frontCount,
        rowCount: rows.length, ls, c,
    });
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        h(SensitivityControls, { ...state, c, theme, t, status }),
        error
            ? placeholder(`Error: ${error}`)
            : h('div', {
                style: {
                    flex: 1, minHeight: 0, display: 'flex',
                    flexDirection: state.view === 'both' ? 'row' : 'column',
                }
            },
                (state.view === 'table' || state.view === 'both') && h('div', {
                    style: {
                        flex: state.view === 'both' ? '0 0 380px' : 1,
                        minHeight: 0, overflow: 'hidden',
                    }
                }, h(SensitivityTable, {
                    rows: orderedRows, matColorMap: state.matColorMap,
                    frontCount: state.frontCount, c,
                })),
                (state.view === 'chart' || state.view === 'both') && h('div', {
                    style: { flex: 1, minHeight: 0, overflow: 'hidden', background: c.bg }
                }, h(SensitivityBars, {
                    rows: orderedRows, matColorMap: state.matColorMap,
                    scale: state.scale, frontCount: state.frontCount, c,
                })),
            )
    );
}
