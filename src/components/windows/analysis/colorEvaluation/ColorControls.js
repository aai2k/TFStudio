import { DIAGRAM_IDS, ILLUMINANTS, OBSERVERS } from '../../../../utils/physics/colorimetry.js';
import { ANALYSIS_DEFAULTS } from '../../../../constants/analysisDefaults.js';
// The illuminant designations are standard names; only their descriptions are translated.
import { describedLabel } from '../../../../utils/physics/spectralWeightings.js';
import { TabBtn } from '../../../ui/tabBtn.js';
import { CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField, ResponseChoice, SelectField } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { AoiChips } from '../opticalEvaluation/AoiChips.js';
import { ANGLE_CAP } from './angles.js';

const { createElement: h } = React;
const EXPOSURES = ANALYSIS_DEFAULTS.colorEvaluation.enums.exposure;
const ANGLE_MODES = ANALYSIS_DEFAULTS.colorEvaluation.enums.angleMode;

/**
 * Which spectrum the colour is computed from, together with the controls used
 * constantly while judging the colour. Observer, illuminant, sampling, how the
 * colour patches are shown and what the diagram draws besides the colour stay
 * in Settings. The angles are a list, as Optical Evaluation's angle chips, or a
 * range in equal steps.
 */
export function ColorControls({ c, t, ce, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(ColorSetup, { key: 'setup', c, t, ce, state }),
        ],
    },
        h(ResponseChoice, { c, t, activeId: state.characteristic, onSelect: state.setCharacteristic }),
        h(ChoiceGroup, {
            label: ce.pol, ariaLabel: ce.pol,
            activeId: state.pol, onSelect: state.setPol, c,
            items: [
                { id: 'avg', label: ce.polAvg },
                { id: 's', label: 's' },
                { id: 'p', label: 'p' },
            ],
        }),
        h(ToolbarField, { c, label: ce.aoi },
            h(ChoiceGroup, {
                ariaLabel: ce.aoi, activeId: state.angleMode, onSelect: state.setAngleMode, c,
                items: ANGLE_MODES.options.map(id => ({ id, label: ce.angleModes[id] })),
            }),
            state.angleMode === 'range'
                ? h(AngleRange, { c, ce, state })
                : h(AoiChips, { values: state.thetas, onChange: state.setThetas, c, oe: t.opticalEval, max: ANGLE_CAP }),
        ),
    );
}

// A range of angles, degrees: the first, the last and the step between them.
function AngleRange({ c, ce, state }) {
    const { angleStart, angleEnd, angleStep } = ANALYSIS_DEFAULTS.colorEvaluation.numbers;
    const field = (spec, value, onChange) => ({ value, min: spec.min, max: spec.max, step: spec.step, onChange });
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 } },
        h(RangeField, {
            c, width: 48,
            from: field(angleStart, state.angleStart, state.setAngleStart),
            to: field(angleEnd, state.angleEnd, state.setAngleEnd),
        }),
        h(FieldLabel, { c }, ce.angleStep),
        h(NumInput, { ...field(angleStep, state.angleStep, state.setAngleStep), c, width: 44 }),
    );
}

/**
 * Which diagram the colour is drawn on, as tabs over the plot. The diagrams
 * are views of one result rather than settings, so they sit on the plot they
 * change instead of wrapping off the control row on a narrow dock.
 */
export function DiagramTabs({ c, ce, state }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, flexWrap: 'wrap',
            padding: '0 8px', borderBottom: `1px solid ${c.border}`,
        },
    },
        DIAGRAM_IDS.map(id => h(TabBtn, {
            key: id, c, active: state.diagram === id, title: ce.diagramTitles[id],
            onClick: () => state.setDiagram(id),
        }, ce.diagrams[id])),
    );
}

// Shrinks to the row when its angle chips would run past it, so the chips wrap
// onto more lines and + stays in reach. The label and the List or Range switch
// keep their width.
function ToolbarField({ c, label, children }) {
    return h('div', {
        style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 1 },
    }, h(FieldLabel, { c }, label), children);
}

// What the diagram draws besides the colour, each switched on its own.
const DISPLAY_KEYS = ['showWavelengths', 'showWhite', 'showPlanckian', 'showSrgb'];

function ColorSetup({ c, t, ce, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'colorEvaluation', label: t.analysisChrome.settings, width: 320,
    },
        h(SettingRow, { c, label: ce.observer },
            h(SelectField, {
                value: state.observer, onChange: state.setObserver, c, width: 160,
                options: OBSERVERS,
            }),
        ),
        h(SettingRow, { c, label: ce.illuminant },
            h(SelectField, {
                value: state.illuminant, onChange: state.setIllum, c, width: 160,
                options: ILLUMINANTS.map(entry => ({ id: entry.id, label: describedLabel(entry, t.illuminants) })),
            }),
        ),
        h(SettingRow, { c, label: ce.step },
            h(NumInput, {
                value: state.step, positive: true, step: 1, c, width: 60,
                onChange: state.setStep,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: ce.exposure },
            h(SelectField, {
                value: state.exposure, onChange: state.setExposure, c, width: 160,
                options: EXPOSURES.options.map(id => ({ id, label: ce.exposures[id] })),
            }),
        ),
        h(SettingRow, { c, label: ce.show },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                DISPLAY_KEYS.map(key => h(CheckField, {
                    key, c, label: ce.display[key], checked: state[key],
                    onChange: event => state.setDisplay(key, event.target.checked),
                })),
            ),
        ),
        h(SettingDivider, { c }),
        h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.5, padding: '6px 0 2px' } },
            ce.refNote),
    );
}
