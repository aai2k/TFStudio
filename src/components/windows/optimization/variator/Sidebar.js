import { SectionHeader } from './SectionHeader.js';
import { SliderRow } from './SliderRow.js';
import { LayerSliderList } from './LayerSliderList.js';
import { MaterialSliders } from './MaterialSliders.js';
import { resolveMat, matLabel } from './model.js';
import { resolveColor } from '../../../../utils/materials/catalogManager.js';

const { createElement: h } = React;

export function Sidebar(props) {
    const {
        c, v, design, anyVaried, revert,
        baseFrontById, baseBackById, baseSubMm,
        dThkFront, dThkBack, setLayerFront, setLayerBack,
        dSubMm, setSub,
        uniqueMats, dN, dK, setMatDN, setMatDK,
    } = props;
    const subMat = resolveMat(design.substrate?.material);

    return h('div', {
        style: {
            width: 380, minWidth: 320, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            borderRight: `1px solid ${c.border}`,
            backgroundColor: c.bg
        }
    },
        // Sidebar toolbar
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexShrink: 0
            }
        },
            h('span', { style: { fontWeight: 600 } }, v.title || 'Variator'),
            h('span', { style: { color: c.textDim, fontSize: 11 } },
                anyVaried ? (v.varied || 'modified') : (v.atBaseline || 'baseline')),
            h('button', {
                onClick: revert,
                disabled: !anyVaried,
                title: v.revertTip || 'Reset all sliders to baseline',
                style: {
                    marginLeft: 'auto',
                    padding: '3px 10px', fontSize: 11,
                    cursor: anyVaried ? 'pointer' : 'default',
                    border: `1px solid ${anyVaried ? c.accent : c.border}`,
                    borderRadius: 3,
                    backgroundColor: anyVaried ? c.accent + '22' : 'transparent',
                    color: anyVaried ? c.accent : c.textDim,
                    outline: 'none', opacity: anyVaried ? 1 : 0.5,
                }
            }, v.revert || 'Revert')
        ),

        // Slider scroll area
        h('div', {
            style: { flex: 1, minHeight: 0, overflowY: 'auto' }
        },
            // Front layers
            (design.frontLayers || []).length > 0 && h('div', null,
                h(SectionHeader, { label: v.frontLayers || 'Front layers', count: design.frontLayers.length, c }),
                h(LayerSliderList, {
                    layers: design.frontLayers, side: 'front', c, v,
                    baseById: baseFrontById, dThk: dThkFront, onChange: setLayerFront,
                })
            ),

            // Back layers
            (design.backLayers || []).length > 0 && h('div', null,
                h(SectionHeader, { label: v.backLayers || 'Back layers', count: design.backLayers.length, c }),
                h(LayerSliderList, {
                    layers: design.backLayers, side: 'back', c, v,
                    baseById: baseBackById, dThk: dThkBack, onChange: setLayerBack,
                })
            ),

            // Substrate thickness
            h('div', null,
                h(SectionHeader, { label: v.substrate || 'Substrate', c }),
                h(SliderRow, {
                    label: `${matLabel(subMat)} (${baseSubMm.toFixed(3)} mm)`,
                    value: dSubMm,
                    min: -Math.max(0.5, baseSubMm * 0.5),
                    max:  Math.max(0.5, baseSubMm * 0.5),
                    step: 0.01,
                    unit: 'mm',
                    color: resolveColor(subMat), c,
                    onChange: setSub,
                    displayPrecision: 3,
                    resetTip: v.resetRow,
                })
            ),

            // Material n/k offsets — one row per UNIQUE material id
            h(MaterialSliders, { uniqueMats, dN, dK, setMatDN, setMatDK, c, v })
        )
    );
}
