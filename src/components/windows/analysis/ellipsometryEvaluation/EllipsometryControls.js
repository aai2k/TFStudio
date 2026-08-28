import { ChoiceGroup, NumInput, RangeField, ToggleButton } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';

const { createElement: h } = React;

const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

/** Which of Ψ and Δ are plotted; the sweep that produces them is a setting. */
export function EllipsometryControls({ c, t, text, state, curveColors, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(EllipsometrySetup, { key: 'setup', c, t, text, state }),
        ],
    },
        h(CurveSwitch, {
            c, label: 'Ψ', color: curveColors.psi, on: state.showPsi,
            // The last curve standing cannot be switched off: an empty plot is
            // never what was meant, and there is no other way back to a curve.
            last: !state.showDelta,
            onToggle: () => state.setShowPsi(current => !current),
        }),
        h(CurveSwitch, {
            c, label: 'Δ', color: curveColors.delta, on: state.showDelta,
            last: !state.showPsi,
            onToggle: () => state.setShowDelta(current => !current),
        }),
    );
}

function CurveSwitch({ c, label, color, on, last, onToggle }) {
    return h(ToggleButton, {
        c, label, color, active: on, disabled: on && last, onClick: onToggle,
    },
        h('span', {
            style: {
                width: 14, height: 0, flexShrink: 0,
                borderTop: `2px solid ${on ? color : c.textDim}`,
            },
        }),
    );
}

/**
 * The sweep: what is varied and over what range, and the conditions held fixed
 * while it runs.
 */
function EllipsometrySetup({ c, t, text, state }) {
    const spectral = state.mode === 'spectral';
    return h(SettingsMenu, {
        c, t, windowId: 'ellipsometryEvaluation', label: t.analysisChrome.settings, width: 320,
    },
        h(SettingRow, { c, label: text.mode },
            h(ChoiceGroup, {
                ariaLabel: text.mode, activeId: state.mode, onSelect: state.setMode, c,
                items: [
                    { id: 'spectral', label: text.spectral },
                    { id: 'angular', label: text.angular },
                ],
            }),
        ),
        h(SettingRow, { c, label: text.side },
            h(ChoiceGroup, {
                ariaLabel: text.side, activeId: state.side, onSelect: state.setSide, c,
                items: [
                    { id: 'front', label: text.modeFront, color: SIDE_COLORS.front },
                    { id: 'back', label: text.modeBack, color: SIDE_COLORS.back },
                ],
            }),
        ),
        h(SettingDivider, { c }),
        spectral
            ? h(React.Fragment, null,
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
                h(SettingRow, { c, label: text.lamStep },
                    h(NumInput, {
                        value: state.lambdaStep, min: 0.1, max: 1000, step: 1, c, width: 60,
                        onChange: state.setLambdaStep,
                    }),
                ),
                h(SettingRow, { c, label: text.aoi },
                    h(NumInput, {
                        value: state.thetaDeg, min: 0, max: 89, step: 1, c, width: 60,
                        onChange: state.setThetaDeg,
                    }),
                ),
            )
            : h(React.Fragment, null,
                h(SettingRow, { c, label: text.aoi },
                    h(RangeField, {
                        c, unit: '°', width: 56,
                        from: {
                            value: state.angleStart, min: 0, max: 89.5, step: 1,
                            onChange: state.setAngleStart,
                        },
                        to: {
                            value: state.angleEnd, min: 0, max: 89.5, step: 1,
                            onChange: state.setAngleEnd,
                        },
                    }),
                ),
                h(SettingRow, { c, label: text.aoiStep },
                    h(NumInput, {
                        value: state.angleStep, min: 0.05, max: 45, step: 0.5, c, width: 60,
                        onChange: state.setAngleStep,
                    }),
                ),
                h(SettingRow, { c, label: text.wavelength },
                    h(NumInput, {
                        value: state.lambdaNm, min: 100, max: 30000, step: 10, c, width: 72,
                        onChange: state.setLambdaNm,
                    }),
                ),
            ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: text.deltaConv },
            h(ChoiceGroup, {
                ariaLabel: text.deltaConv,
                activeId: state.deltaConvention, onSelect: state.setDeltaConvention, c,
                items: [
                    { id: 'azzam', label: text.deltaAzzam, title: text.deltaAzzamTip },
                    { id: 'reversed', label: text.deltaReversed, title: text.deltaReversedTip },
                ],
            }),
        ),
    );
}
