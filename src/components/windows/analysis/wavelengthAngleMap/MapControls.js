import { COLORSCALES } from '../../../../utils/physics/plotQuantities.js';
import { ChoiceGroup, NumInput, RangeField, SelectField } from '../chrome/controls.js';
import { ControlRow } from '../chrome/layout.js';
import { NoticeBadge, SettingRow, SettingDivider, SettingsMenu } from '../chrome/popover.js';
import { axisSteps } from './mapSpec.js';

const { createElement: h } = React;

/** "Computing 4/9" while a sweep is in flight, nothing when it is not. */
function SweepStatus({ c, wam, computing, progress }) {
    if (!computing) return null;
    const label = progress?.total
        ? wam.computingProgress(progress.done, progress.total)
        : wam.computing;
    return h('span', {
        style: { fontSize: 11, color: c.textDim, whiteSpace: 'nowrap' },
    }, label);
}

/**
 * What the map shows, on one row: the quantity, the polarization it is read in,
 * and whether it is drawn flat or as a surface. The two ranges are settings.
 */
export function MapControls({ c, t, wam, state, notices }) {
    return h(ControlRow, {
        c,
        trailing: [
            h(SweepStatus, {
                key: 'status', c, wam,
                computing: state.computing, progress: state.progress,
            }),
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            h(MapSetup, { key: 'setup', c, t, wam, state }),
        ],
    },
        h(ChoiceGroup, {
            ariaLabel: wam.channel, activeId: state.channel, c,
            onSelect: value => state.set('channel', value),
            items: [
                { id: 'T', label: 'T' },
                { id: 'R', label: 'R' },
                { id: 'A', label: 'A' },
            ],
        }),
        h(ChoiceGroup, {
            label: wam.polarization, ariaLabel: wam.polarization, activeId: state.pol, c,
            onSelect: value => state.set('pol', value),
            items: [
                { id: 'avg', label: wam.polAvg },
                { id: 's', label: 's' },
                { id: 'p', label: 'p' },
            ],
        }),
        h(ChoiceGroup, {
            ariaLabel: wam.render, activeId: state.render, c,
            onSelect: value => state.set('render', value),
            items: [
                { id: 'heatmap', label: wam.renderHeatmap },
                { id: 'surface', label: wam.renderSurface },
            ],
        }),
    );
}

/** Grid size as it will actually be computed, once the caps are applied. */
function gridLabel(state, wam) {
    const nx = axisSteps(state.lambdaStart, state.lambdaEnd, state.lambdaStep);
    const ny = axisSteps(state.angleStart, state.angleEnd, state.angleStep);
    return wam.gridSize(nx, ny, nx * ny);
}

function MapSetup({ c, t, wam, state }) {
    return h(SettingsMenu, {
        c, t, windowId: 'wavelengthAngleMap',
        label: t.analysisChrome.settings, title: t.analysisChrome.settingsTip, width: 310,
    },
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm',
                from: {
                    value: state.lambdaStart, min: 100, max: 30000, step: 10,
                    onChange: value => state.set('lambdaStart', value),
                },
                to: {
                    value: state.lambdaEnd, min: 100, max: 30000, step: 10,
                    onChange: value => state.set('lambdaEnd', value),
                },
            }),
        ),
        h(SettingRow, { c, label: wam.lambdaStep },
            h(NumInput, {
                value: state.lambdaStep, min: 0.1, max: 1000, step: 1, c, width: 62,
                onChange: value => state.set('lambdaStep', value),
            }),
        ),
        h(SettingRow, { c, label: wam.angle },
            h(RangeField, {
                c, unit: '°',
                from: {
                    value: state.angleStart, min: 0, max: 89, step: 5,
                    onChange: value => state.set('angleStart', value),
                },
                to: {
                    value: state.angleEnd, min: 0, max: 89, step: 5,
                    onChange: value => state.set('angleEnd', value),
                },
            }),
        ),
        h(SettingRow, { c, label: wam.angleStep },
            h(NumInput, {
                value: state.angleStep, min: 0.05, max: 45, step: 0.5, c, width: 62,
                onChange: value => state.set('angleStep', value),
            }),
        ),
        h('div', { style: { fontSize: 10, color: c.textDim, padding: '2px 0 4px' } },
            gridLabel(state, wam)),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: wam.colorscale },
            h(SelectField, {
                c, width: 130, value: state.colorscale,
                onChange: value => state.set('colorscale', value),
                options: COLORSCALES.map(id => ({ id, label: id })),
            }),
        ),
    );
}
