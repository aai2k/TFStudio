import {
    ActionButton, ChoiceGroup, NumInput, SelectField,
} from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingDivider, SettingRow, SettingsMenu } from '../chrome/popover.js';
import {
    transformLimitedOmegaWidth, wavelengthWidthFromOmegaWidth,
} from '../../../../utils/physics/pulsePropagation.js';

const { createElement: h } = React;

const dimText = c => ({ color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' });

/**
 * The switches that decide which curve is drawn: time or spectrum, R or T, the
 * polarization, and where the output sits in time. The pulse, its chirp and the
 * geometry live in the Settings panel.
 */
export function PulseControls({ c, t, text, analysis, notices, busy }) {
    const { session, setField } = analysis;
    const responses = session.side === 'whole'
        ? [{ id: 'T', label: text.transmission, color: '#03a9f4' }]
        : [
            { id: 'R', label: text.reflection, color: '#ef5350' },
            { id: 'T', label: text.transmission, color: '#03a9f4' },
        ];
    return h(ControlRow, {
        c,
        trailing: [
            busy && h(ActionButton, { key: 'stop', c, label: text.stop, onClick: analysis.stop }),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(PulseSetup, { key: 'setup', c, t, text, analysis }),
        ],
    },
        h(ChoiceGroup, {
            c, ariaLabel: text.domain, activeId: session.domain,
            onSelect: value => setField('domain', value),
            items: [
                { id: 'time', label: text.domains.time },
                { id: 'spectrum', label: text.domains.spectrum },
            ],
        }),
        h(ChoiceGroup, {
            c, ariaLabel: text.response, activeId: session.target,
            onSelect: value => setField('target', value), items: responses,
        }),
        h(ChoiceGroup, {
            c, label: text.pol, activeId: session.pol, onSelect: value => setField('pol', value),
            items: [{ id: 'avg', label: text.avg }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
        }),
        session.domain === 'time' && h(ChoiceGroup, {
            c, ariaLabel: text.timeAxis, activeId: session.timeAxis,
            onSelect: value => setField('timeAxis', value),
            items: [
                { id: 'removed', label: text.timeAxes.removed, title: text.timeAxisRemovedTip },
                { id: 'absolute', label: text.timeAxes.absolute, title: text.timeAxisAbsoluteTip },
            ],
        }),
    );
}

function ModelSpectrumRows({ c, text, session, setField }) {
    const shaped = session.shape === 'gaussian' || session.shape === 'sech2';
    const equivalentNm = shaped && session.duration > 0
        ? wavelengthWidthFromOmegaWidth(session.centerWavelength,
            transformLimitedOmegaWidth(session.shape, session.duration))
        : NaN;
    return [
        h(SettingRow, { key: 'shape', c, label: text.shape },
            h(SelectField, {
                c, width: 150, value: session.shape, onChange: value => setField('shape', value),
                options: ['gaussian', 'sech2', 'superGaussian'].map(id => ({ id, label: text.shapes[id] })),
            }),
        ),
        shaped && h(SettingRow, { key: 'duration', c, label: text.duration },
            h(NumInput, {
                c, width: 64, positive: true, step: 1, value: session.duration,
                title: text.durationTip, onChange: value => setField('duration', value),
            }),
            Number.isFinite(equivalentNm)
                && h('span', { style: dimText(c) }, text.bandwidthEquivalent(equivalentNm.toFixed(1))),
        ),
        !shaped && h(SettingRow, { key: 'bandwidth', c, label: text.bandwidth },
            h(NumInput, {
                c, width: 64, positive: true, step: 5, value: session.bandwidth,
                title: text.bandwidthTip, onChange: value => setField('bandwidth', value),
            }),
        ),
        !shaped && h(SettingRow, { key: 'order', c, label: text.order },
            h(NumInput, {
                c, width: 64, positive: true, step: 1, value: session.order,
                title: text.orderTip, onChange: value => setField('order', value),
            }),
        ),
    ];
}

function FileSpectrumRow({ c, text, analysis }) {
    const { session, canPick, loadSpectrum, fileError } = analysis;
    const file = session.spectrumFile;
    let status = file ? text.fileRows(file.name, file.rows) : text.noFile;
    if (fileError === 'parse') status = text.fileParseError;
    else if (fileError) status = text.fileReadError(fileError);
    return h(SettingRow, { c, label: text.file, wrap: true },
        h(ActionButton, {
            c, label: text.loadFile, title: text.loadFileTip, disabled: !canPick, onClick: loadSpectrum,
        }),
        h('span', { style: { ...dimText(c), whiteSpace: 'normal' } }, status),
    );
}

function ChirpRows({ c, text, analysis }) {
    const { session, setField, gddTarget, fillGddFromTarget } = analysis;
    const bounces = Math.max(1, Math.round(session.passes));
    return [
        h(SettingRow, { key: 'gdd', c, label: text.gdd },
            h(NumInput, { c, width: 72, step: 10, value: session.gdd, onChange: value => setField('gdd', value) }),
            h(ActionButton, {
                c, label: text.fromTarget, disabled: gddTarget === null, onClick: fillGddFromTarget,
                title: gddTarget === null ? text.noTargetTip : text.fromTargetTip(gddTarget, bounces),
            }),
        ),
        h(SettingRow, { key: 'tod', c, label: text.tod },
            h(NumInput, { c, width: 72, step: 10, value: session.tod, onChange: value => setField('tod', value) }),
        ),
    ];
}

function GeometryRows({ c, text, session, setField }) {
    return [
        h(SettingRow, { key: 'side', c, label: text.side },
            h(ChoiceGroup, {
                c, ariaLabel: text.side, activeId: session.side, onSelect: value => setField('side', value),
                items: [
                    { id: 'front', label: text.front, color: '#1e88e5' },
                    { id: 'back', label: text.back, color: '#e53935' },
                    { id: 'whole', label: text.whole, title: text.wholeTip },
                ],
            }),
        ),
        h(SettingRow, { key: 'aoi', c, label: text.aoi },
            h(NumInput, {
                c, width: 60, min: 0, max: 89, step: 1, value: session.theta,
                onChange: value => setField('theta', value),
            }),
        ),
        h(SettingRow, { key: 'bounces', c, label: text.bounces },
            h(NumInput, {
                c, width: 60, min: 1, step: 1, value: session.passes, title: text.bouncesTip,
                onChange: value => setField('passes', Math.max(1, Math.round(value))),
            }),
        ),
    ];
}

function PulseSetup({ c, t, text, analysis }) {
    const { session, setField } = analysis;
    return h(SettingsMenu, {
        c, t, windowId: 'pulseAnalysis', label: t.analysisChrome.settings, width: 340,
    },
        h(SettingRow, { c, label: text.source },
            h(ChoiceGroup, {
                c, ariaLabel: text.source, activeId: session.source,
                onSelect: value => setField('source', value),
                items: [{ id: 'model', label: text.sourceModel }, { id: 'file', label: text.sourceFile }],
            }),
        ),
        session.source === 'file'
            ? h(FileSpectrumRow, { c, text, analysis })
            : h(ModelSpectrumRows, { c, text, session, setField }),
        h(SettingRow, { c, label: text.center },
            h(NumInput, {
                c, width: 72, positive: true, step: 10, value: session.centerWavelength,
                title: text.centerTip, onChange: value => setField('centerWavelength', value),
            }),
        ),
        h(SettingDivider, { c }),
        h(ChirpRows, { c, text, analysis }),
        h(SettingDivider, { c }),
        h(GeometryRows, { c, text, session, setField }),
    );
}
