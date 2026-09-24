import {
    ActionButton, ChoiceGroup, CurveToggleGroup, FieldLabel, NumInput, RangeField, SelectField,
} from '../chrome/controls.js';
import { ControlRow, EditorBody, EditorGroupTitle, FieldGrid } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h } = React;

// Same shape as Optical Evaluation's. There is no A group: the rough design
// carries its scatter loss as absorption in the transition layers, so its A
// would mix the two. The second axis shows the loss against the smooth design.
const CURVE_GROUPS = [
    { q: 'T', members: [{ pol: 'avg', key: 'T' }, { pol: 's', key: 'Ts' }, { pol: 'p', key: 'Tp' }] },
    { q: 'R', members: [{ pol: 'avg', key: 'R' }, { pol: 's', key: 'Rs' }, { pol: 'p', key: 'Rp' }] },
];

/**
 * Which curves are drawn and which scale the specular loss is read on. The
 * spectral range and the geometry are settings; the roughness itself is edited
 * in the strip below the plot, because there is one value per interface.
 */
export function RoughnessControls({ c, t, rs, state, notices }) {
    const colors = useAnalysisColors('roughnessScattering');
    const labels = { avg: rs.polAvg, s: 's', p: 'p' };
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(RoughnessSetup, { key: 'setup', c, t, rs, state }),
        ],
    },
        CURVE_GROUPS.map(group => h(CurveToggleGroup, {
            key: group.q, c,
            quantity: group.q,
            color: colors[group.members[0].key],
            members: group.members,
            active: state.showCurves,
            onToggle: state.toggleCurve,
            labels,
        })),
        h(ChoiceGroup, {
            label: rs.scale, ariaLabel: rs.scale,
            activeId: state.units, onSelect: state.setUnits, c,
            items: [
                { id: 'ppm', label: 'ppm' },
                { id: 'frac', label: 'frac' },
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

const rangeItems = rs => [
    { id: 'short', label: rs.rangeShort },
    { id: 'long', label: rs.rangeLong },
];

/**
 * The roughness itself: one σ and kind applied to every interface, or a pair
 * per interface. Which interfaces are listed follows the design's evaluation
 * mode, since only the sides being evaluated are roughened. The two kinds and
 * the limits of the long-range model are stated under the fields, because the
 * choice between them decides whether any light is lost at all.
 */
export function RoughnessEditor({ c, rs, state }) {
    const { rough } = state;
    return h(EditorBody, { c },
        rough.mode === 'uniform'
            ? h(FieldGrid, null,
                h(SettingRow, { c, label: 'σ' },
                    h(NumInput, {
                        value: rough.sigma, min: 0, max: 100, step: 0.1, c, width: 68,
                        onChange: state.setUniformSigma,
                    }),
                    h(FieldLabel, { c }, 'nm'),
                ),
                h(SettingRow, { c, label: rs.rangeLabel },
                    h(ChoiceGroup, {
                        ariaLabel: rs.rangeLabel, activeId: rough.range,
                        onSelect: state.setUniformRange, c, items: rangeItems(rs),
                    }),
                ),
            )
            : h(InterfaceRows, { c, rs, state }),
        h(EditorNote, { c }, rs.rangeHelp),
        h(EditorNote, { c }, rs.scopeHelp),
    );
}

function EditorNote({ c, children }) {
    return h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '2px 0' } },
        children);
}

function InterfaceRows({ c, rs, state }) {
    const { rough } = state;
    const sides = state.activeSides.filter(side => side === 'front' || state.hasBack);
    return sides.map(side => {
        const back = side === 'back';
        const sigmas = back ? rough.backSigmas : rough.sigmas;
        const ranges = back ? rough.backRanges : rough.ranges;
        const sideLabels = back ? state.labels.back : state.labels.front;
        const heading = back
            ? rs.backInterfaces
            : (sides.length > 1 ? rs.frontInterfaces : null);
        return h('div', { key: side },
            heading && h(EditorGroupTitle, { c }, heading),
            h(FieldGrid, { minWidth: 320 },
                sideLabels.map((label, index) => h(InterfaceRow, {
                    key: index, c, rs, label: label.label,
                    sigma: sigmas?.[index] ?? rough.sigma ?? 0,
                    range: ranges?.[index] ?? rough.range,
                    onSigma: value => state.setInterfaceSigma(side, index, value),
                    onRange: value => state.setInterfaceRange(side, index, value),
                })),
            ),
        );
    });
}

// Interface names are the two materials meeting there, so they are far longer
// than a settings label and take the width the row can spare instead of a
// fixed column.
function InterfaceRow({ c, rs, label, sigma, range, onSigma, onRange }) {
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
        h(NumInput, { value: sigma, min: 0, max: 100, step: 0.1, c, width: 68, onChange: onSigma }),
        h(FieldLabel, { c }, 'nm'),
        h(SelectField, {
            c, value: range, onChange: onRange, width: 96, title: rs.rangeLabel,
            options: rangeItems(rs),
        }),
    );
}
