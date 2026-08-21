import {
    CheckField, ChoiceGroup, FieldLabel, NumInput, RangeField, SelectField, ToggleButton,
} from '../chrome/controls.js';
import { ControlRow, EditorBody, FieldGrid } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';
import { useAnalysisColors } from '../../../../state/AnalysisSettingsContext.js';

const { createElement: h } = React;

/**
 * Which characteristic the trials are drawn for and whether the realized
 * extremes are shown. The spectral range and the run size are settings; the
 * error magnitudes are edited in the strip below the plot, beside the trial
 * count that was drawn with them.
 */
export function ErrorControls({ c, t, ea, state, notices, trailing }) {
    const colors = useAnalysisColors('errorAnalysis');
    return h(ControlRow, {
        c,
        trailing: [
            ...trailing,
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(ErrorSetup, { key: 'setup', c, t, ea, state }),
        ],
    },
        h(ChoiceGroup, {
            ariaLabel: 'T/R/A', activeId: state.char, onSelect: state.setChar, c,
            items: [
                { id: 'T', label: 'T' },
                { id: 'R', label: 'R' },
                { id: 'A', label: 'A' },
            ],
        }),
        // A layer of the plot rather than a choice, so it reads as a pressed
        // button beside the T/R/A switches instead of a bare tick box.
        h(ToggleButton, {
            c, label: ea.envelope, active: state.showEnvelope, title: ea.envelopeTip,
            color: colors[state.char],
            onClick: () => state.setShowEnvelope(!state.showEnvelope),
        }),
    );
}

const DISTRIBUTION_NOTE = {
    uniform: 'sigmaNoteUniform',
    truncated: 'sigmaNoteTruncated',
    gaussian: 'sigmaNoteGaussian',
};

function ErrorSetup({ c, t, ea, state }) {
    const { params, setParams } = state;
    const patch = next => setParams(previous => ({ ...previous, ...next }));
    return h(SettingsMenu, {
        c, t, windowId: 'errorAnalysis', label: t.analysisChrome.settings, width: 300,
    },
        h(SettingRow, { c, label: ea.lambdaRange },
            h(RangeField, {
                c, unit: 'nm', width: 60,
                from: {
                    value: params.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: value => patch({ lambdaStart: value }),
                },
                to: {
                    value: params.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: value => patch({ lambdaEnd: value }),
                },
            }),
        ),
        h(SettingRow, { c, label: ea.step },
            h(NumInput, {
                value: params.lambdaStep, min: 0.5, max: 50, step: 1, c, width: 60,
                onChange: value => patch({ lambdaStep: value > 0 ? value : 5 }),
            }),
        ),
        h(SettingRow, { c, label: ea.aoi },
            h(NumInput, {
                value: params.theta, min: 0, max: 89, step: 1, c, width: 60,
                onChange: value => patch({ theta: value }),
            }),
        ),
        h(SettingRow, { c, label: ea.pol },
            h(ChoiceGroup, {
                ariaLabel: ea.pol, activeId: params.polarization, c,
                onSelect: value => patch({ polarization: value }),
                items: [
                    { id: 'avg', label: 'avg' },
                    { id: 's', label: 's' },
                    { id: 'p', label: 'p' },
                ],
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: ea.nTrials },
            h(NumInput, {
                value: state.nTrials, min: 1, max: 100000, step: 50, c, width: 72,
                onChange: value => state.setNTrials(Math.max(1, Math.floor(value))),
            }),
        ),
        h(SettingRow, { c, label: ea.corridor },
            h(NumInput, {
                value: state.corridorSigma, min: 0.1, max: 10, step: 0.5, c, width: 60,
                title: ea.corridorTip,
                onChange: value => state.setCorridorSigma(value > 0 ? value : 1),
            }),
            h(FieldLabel, { c }, 'σ'),
        ),
    );
}

/** One line naming what a run would be drawn with, for the strip's header. */
export function errorEditorSummary(state, ea) {
    const parts = [];
    if (state.rmsAbsNm > 0) parts.push(`${ea.rmsAbs} ${state.rmsAbsNm} nm`);
    if (state.rmsRelPct > 0) parts.push(`${ea.rmsRel} ${state.rmsRelPct} %`);
    if (state.rmsReN > 0) parts.push(`${ea.rmsReN} ${state.rmsReN}`);
    if (state.rmsImN > 0) parts.push(`${ea.rmsImN} ${state.rmsImN}`);
    if (parts.length === 0) return ea.noErrors;
    return `${state.nTrials} × ${parts.join(' · ')}`;
}

/**
 * What a trial is drawn from: how the deviations are distributed and how large
 * they are. These sit below the plot rather than in the settings panel because
 * they are the experiment, not the view of it.
 */
export function ErrorEditor({ c, ea, state }) {
    // Uniform and truncated draws have a hard bound, so the entered figure is a
    // ± limit rather than a standard deviation and the labels say so.
    const magnitudeLabel = text => (state.distribution === 'gaussian'
        ? text
        : String(text || '').replace('σ', '±'));
    const indexErrors = state.rmsReN > 0 || state.rmsImN > 0;
    return h(EditorBody, { c },
        h(FieldGrid, { minWidth: 250 },
            h(SettingRow, { c, label: ea.nTrials },
                h(NumInput, {
                    value: state.nTrials, min: 1, max: 100000, step: 50, c, width: 72,
                    onChange: value => state.setNTrials(Math.max(1, Math.floor(value))),
                }),
            ),
            h(SettingRow, { c, label: ea.distribution },
                h(SelectField, {
                    value: state.distribution, c, width: 150, title: ea.distributionTip,
                    options: [
                        { id: 'gaussian', label: ea.distGaussian },
                        { id: 'uniform', label: ea.distUniform },
                        { id: 'truncated', label: ea.distTruncated },
                    ],
                    onChange: value => {
                        state.setDistribution(value);
                        // A bounded draw has a meaningful hard envelope, so show it.
                        if (value === 'uniform' || value === 'truncated') state.setShowEnvelope(true);
                    },
                }),
            ),
        ),
        h('div', { style: { color: c.textDim, fontSize: 10, lineHeight: 1.45, padding: '2px 0 4px' } },
            ea[DISTRIBUTION_NOTE[state.distribution] || DISTRIBUTION_NOTE.gaussian]),
        h(SettingDivider, { c }),
        h(FieldGrid, { minWidth: 250 },
            h(SettingRow, { c, label: magnitudeLabel(ea.rmsAbs) },
                h(NumInput, {
                    value: state.rmsAbsNm, min: 0, max: 1000, step: 0.1, c, width: 72,
                    title: ea.rmsAbsTip, onChange: state.setRmsAbsNm,
                }),
                h(FieldLabel, { c }, 'nm'),
            ),
            h(SettingRow, { c, label: magnitudeLabel(ea.rmsRel) },
                h(NumInput, {
                    value: state.rmsRelPct, min: 0, max: 100, step: 0.1, c, width: 72,
                    title: ea.rmsRelTip, onChange: state.setRmsRelPct,
                }),
                h(FieldLabel, { c }, '%'),
            ),
            h(SettingRow, { c, label: magnitudeLabel(ea.rmsReN) },
                h(NumInput, {
                    value: state.rmsReN, min: 0, max: 2, step: 0.001, c, width: 72,
                    title: ea.rmsReNTip, onChange: state.setRmsReN,
                }),
            ),
            h(SettingRow, { c, label: magnitudeLabel(ea.rmsImN) },
                h(NumInput, {
                    value: state.rmsImN, min: 0, max: 2, step: 0.001, c, width: 72,
                    title: ea.rmsImNTip, onChange: state.setRmsImN,
                }),
            ),
            h(SettingRow, { c, label: '' },
                h(CheckField, {
                    c, label: ea.perMaterial, checked: state.perMaterial, title: ea.perMaterialTip,
                    onChange: event => state.setPerMaterial(event.target.checked),
                }),
            ),
            h(SettingRow, { c, label: '' },
                h(CheckField, {
                    c, label: ea.keepOPT,
                    // Keeping n·d fixed only means anything when the index is being
                    // perturbed; with thickness errors alone it cancels the trial.
                    checked: state.keepOPT && indexErrors, disabled: !indexErrors,
                    title: indexErrors ? ea.keepOPTTip : ea.keepOPTDisabledTip,
                    onChange: event => state.setKeepOPT(event.target.checked),
                }),
            ),
        ),
    );
}
