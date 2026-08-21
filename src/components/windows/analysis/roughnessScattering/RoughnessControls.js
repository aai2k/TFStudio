import { ActionButton, ChoiceGroup, FieldLabel, NumInput, RangeField } from '../chrome/controls.js';
import { ControlRow, EditorBody, EditorGroupTitle, FieldGrid } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

/**
 * Which scale the scattered fraction is read on. The spectral range and the
 * geometry are settings; the roughness itself is edited in the strip below the
 * plot, because there is one value per interface.
 */
export function RoughnessControls({ c, t, rs, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(RoughnessSetup, { key: 'setup', c, t, rs, state }),
        ],
    },
        h(ChoiceGroup, {
            label: rs.scale, ariaLabel: rs.scale,
            activeId: state.units, onSelect: state.setUnits, c,
            items: [
                { id: 'ppm', label: 'ppm' },
                { id: 'frac', label: 'frac' },
            ],
        }),
        h(ChoiceGroup, {
            label: rs.polarization, ariaLabel: rs.polarization,
            activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: 'avg' },
                { id: 's', label: 's' },
                { id: 'p', label: 'p' },
            ],
        }),
    );
}

function RoughnessSetup({ c, t, rs, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'roughnessScattering', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm',
                from: {
                    value: state.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaStart,
                },
                to: {
                    value: state.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: state.setLambdaEnd,
                },
            }),
        ),
        h(SettingRow, { c, label: rs.step },
            h(NumInput, {
                value: state.lambdaStep, min: 0.1, max: 1000, step: 1, c, width: 60,
                onChange: state.setLambdaStep,
            }),
        ),
        h(SettingRow, { c, label: rs.aoi },
            h(NumInput, {
                value: state.aoi, min: 0, max: 89, step: 1, c, width: 60,
                onChange: state.setAoi,
            }),
        ),
    );
}

/** Mode switch and Clear, in the editor strip's header. */
export function RoughnessEditorActions({ c, rs, state }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(ChoiceGroup, {
            ariaLabel: rs.modeSection, activeId: state.rough.mode, onSelect: state.setMode, c,
            items: [
                { id: 'uniform', label: rs.uniform },
                { id: 'perInterface', label: rs.perInterface },
            ],
        }),
        h(ActionButton, { c, label: rs.clear, onClick: state.clearAll }),
    );
}

/**
 * The roughness itself: one figure applied to every interface, or a value per
 * interface. Which interfaces are listed follows the design's evaluation mode,
 * since only the sides being evaluated contribute to sigma_eff.
 */
export function RoughnessEditor({ c, rs, state }) {
    const { rough } = state;
    return h(EditorBody, { c },
        rough.mode === 'uniform'
            ? h('div', null,
                h(FieldGrid, null,
                    h(SettingRow, { c, label: 'σ' },
                        h(NumInput, {
                            value: rough.sigma, min: 0, max: 100, step: 0.1, c, width: 68,
                            onChange: state.setUniformSigma,
                        }),
                        h(FieldLabel, { c }, 'nm'),
                    ),
                ),
                h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '2px 0' } },
                    rs.uniformHelp),
            )
            : h(InterfaceSigmas, { c, rs, state }),
    );
}

function InterfaceSigmas({ c, rs, state }) {
    const sides = state.activeSides.filter(side => side === 'front' || state.hasBack);
    return sides.map(side => {
        const key = side === 'back' ? 'backSigmas' : 'sigmas';
        const sideLabels = side === 'back' ? state.labels.back : state.labels.front;
        const heading = side === 'back'
            ? rs.backInterfaces
            : (sides.length > 1 ? rs.frontInterfaces : null);
        return h('div', { key: side },
            heading && h(EditorGroupTitle, { c }, heading),
            h(FieldGrid, { minWidth: 260 },
                sideLabels.map((label, index) => h(SigmaRow, {
                    key: index, c, label: label.label,
                    value: state.rough[key]?.[index] ?? state.rough.sigma ?? 0,
                    onChange: value => state.setInterfaceSigma(side, index, value),
                })),
            ),
        );
    });
}

// Interface names are the two materials meeting there, so they are far longer
// than a settings label and take the width the row can spare instead of a
// fixed column.
function SigmaRow({ c, label, value, onChange }) {
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0', minHeight: 26 },
    },
        h('span', {
            style: {
                flex: 1, minWidth: 0, color: c.text, fontSize: 11,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            },
            title: label,
        }, label),
        h(NumInput, { value, min: 0, max: 100, step: 0.1, c, width: 68, onChange }),
        h(FieldLabel, { c }, 'nm'),
    );
}
