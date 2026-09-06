/**
 * Settings of one block, in a panel that opens over the page rather than
 * pushing it aside. The controls are the same ones the source window uses,
 * plus the report-only choices: plot size and table step.
 */

import {
    NumInput, ChoiceGroup, CheckField, SelectField, RangeField, valueOptions,
} from '../../analysis/chrome/controls.js';
import { SettingRow, SettingDivider } from '../../analysis/chrome/popover.js';
import { AoiChips } from '../../analysis/opticalEvaluation/AoiChips.js';
import { CurveGroup } from '../../analysis/opticalEvaluation/controls.js';
import { CURVE_GROUPS } from '../../analysis/opticalEvaluation/model.js';
import { SpectralRange, VerticalRange } from '../../analysis/opticalEvaluation/SetupPanel.js';
import { BUILTIN_TYPES, withDefaults } from '../../../../utils/report/blocks.js';
import { blockName } from './blockText.js';
import { TextArea, AngleListField, PanelButton } from './controls.js';
import { RAIL_WIDTH } from './BlockRail.js';

const { createElement: h } = React;

const FONT = 'system-ui, -apple-system, sans-serif';
const LAMBDA = { min: 1, max: 100000 };

function plotItems(W) {
    return ['none', 's', 'm', 'l'].map(id => ({ id, label: W.plotSizes[id] }));
}

function PlotRow({ c, W, s, set }) {
    return h(SettingRow, { c, label: W.plot },
        h(ChoiceGroup, { c, items: plotItems(W), activeId: s.plot, onSelect: id => set('plot', id) }));
}

// A table is on when its step is positive; switching it on restores a 10 nm step.
function TableRow({ c, W, s, set }) {
    const on = s.tableStep > 0;
    return h(SettingRow, { c, label: W.tableEvery },
        h(CheckField, { c, label: '', checked: on, onChange: e => set('tableStep', e.target.checked ? 10 : 0) }),
        h(NumInput, { c, value: on ? s.tableStep : 10, min: 0.1, max: 1000, step: 1, width: 56, disabled: !on, onChange: v => set('tableStep', v) }),
        h('span', { style: { fontSize: 11, color: c.textDim } }, W.nm));
}

function RangeRows({ c, W, s, set }) {
    return [
        h(SettingRow, { c, key: 'range', label: W.range },
            h(RangeField, { c, label: '', from: { value: s.lambdaStart, onChange: v => set('lambdaStart', v), ...LAMBDA }, to: { value: s.lambdaEnd, onChange: v => set('lambdaEnd', v), ...LAMBDA } })),
        h(SettingRow, { c, key: 'step', label: W.step },
            h(NumInput, { c, value: s.lambdaStep, min: 0.01, max: 1000, step: 0.5, width: 56, onChange: v => set('lambdaStep', v) }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, W.nm)),
        h(SettingRow, { c, key: 'angles', label: W.angles },
            h(AngleListField, { c, value: s.thetas, onChange: v => set('thetas', v) })),
    ];
}

// The spectrum block carries the Optical Evaluation window's own controls, so
// an angle list, a range in its unit or a vertical scale is set here exactly as
// it is set there.
function spectrumRows({ c, t, W, s, set, patch }) {
    const oe = t.opticalEval;
    const params = { lambdaStart: s.lambdaStart, lambdaEnd: s.lambdaEnd, lambdaStep: s.lambdaStep };
    const setParams = next => {
        const merged = typeof next === 'function' ? next(params) : { ...params, ...next };
        patch({ lambdaStart: merged.lambdaStart, lambdaEnd: merged.lambdaEnd, lambdaStep: merged.lambdaStep });
    };
    return [
        h(SettingRow, { c, key: 'aoi', label: oe.aoi, wrap: true },
            h(AoiChips, { values: s.thetas, onChange: v => set('thetas', v), c, oe })),
        h(SettingDivider, { c, key: 'd1' }),
        h(SpectralRange, {
            key: 'range', c, oe, params, setParams,
            spectralUnit: s.spectralUnit, setSpectralUnit: v => set('spectralUnit', v),
        }),
        h(VerticalRange, {
            key: 'y', c, oe,
            yAuto: s.yAuto, setYAuto: v => set('yAuto', v),
            yMin: s.yMin, setYMin: v => set('yMin', v),
            yMax: s.yMax, setYMax: v => set('yMax', v),
            yScale: s.yScale, setYScale: v => set('yScale', v),
        }),
        h(SettingRow, { c, key: 'curves', label: W.curves, wrap: true },
            CURVE_GROUPS.map(group => h(CurveGroup, {
                key: group.q, group, showCurves: s.curves, c, yScale: s.yScale, oe,
                onToggle: key => set('curves', { ...s.curves, [key]: !s.curves[key] }),
                polLabels: { avg: oe.polAvg, s: oe.polSShort, p: oe.polPShort },
            }))),
        h(SettingDivider, { c, key: 'd2' }),
        h(PlotRow, { key: 'plot', c, W, s, set }),
        h(TableRow, { key: 'table', c, W, s, set }),
    ];
}

// Wavelength of a profile: the design's reference wavelength, or a typed one.
function LambdaRow({ c, W, s, set, design }) {
    const useRef = s.lambda == null;
    const ref = design?.referenceWavelength ?? 550;
    return h(SettingRow, { c, label: W.wavelength },
        h(CheckField, { c, label: W.useRef, checked: useRef, onChange: e => set('lambda', e.target.checked ? null : ref) }),
        h(NumInput, { c, value: useRef ? ref : s.lambda, ...LAMBDA, step: 10, width: 64, disabled: useRef, onChange: v => set('lambda', v) }));
}

function AngleRow({ c, W, s, set }) {
    return h(SettingRow, { c, label: W.angle },
        h(NumInput, { c, value: s.theta, min: 0, max: 89, step: 1, width: 56, onChange: v => set('theta', v) }));
}

const POL_ITEMS = [{ id: 'avg', label: 'avg' }, { id: 's', label: 's' }, { id: 'p', label: 'p' }];

const FORMS = {
    facts: ({ c, W, s, set }) => h(CheckField, { c, label: W.stackDiagram, checked: !!s.stackDiagram, onChange: e => set('stackDiagram', e.target.checked) }),
    layers: ({ c, W, s, set }) => [
        h(SettingRow, { c, key: 'columns', label: W.columns },
            h(ChoiceGroup, {
                c, items: [{ id: 'auto', label: W.auto }, ...['1', '2', '3', '4'].map(id => ({ id, label: id }))],
                activeId: String(s.columns), onSelect: id => set('columns', id === 'auto' ? 'auto' : Number(id)),
            })),
        h(SettingRow, { c, key: 'extended', label: '' },
            h(CheckField, { c, label: W.extended, checked: !!s.extended, onChange: e => set('extended', e.target.checked) })),
        h(SettingRow, { c, key: 'grouped', label: '' },
            h(CheckField, { c, label: W.groupPeriods, checked: !!s.groupPeriods, onChange: e => set('groupPeriods', e.target.checked) })),
    ],
    materials: ({ c, W, s, set }) => h(CheckField, { c, label: W.asTable, checked: !!s.table, onChange: e => set('table', e.target.checked) }),
    notes: ({ c, W, s, set }) => [
        h(TextArea, { key: 'text', c, value: s.text, width: 296, onChange: v => set('text', v) }),
        h('div', { key: 'hint', style: { fontSize: 10, color: c.textDim, marginTop: 4 } }, W.notesHint),
    ],
    spectrum: spectrumRows,
    color: ({ c, W, s, set }) => [
        h(SettingRow, { c, key: 'char', label: W.characteristic },
            h(ChoiceGroup, { c, items: [{ id: 'R', label: 'R' }, { id: 'T', label: 'T' }], activeId: s.characteristic, onSelect: id => set('characteristic', id) })),
        h(SettingRow, { c, key: 'pol', label: W.polarization },
            h(ChoiceGroup, { c, items: POL_ITEMS, activeId: s.pol, onSelect: id => set('pol', id) })),
        h(AngleRow, { key: 'angle', c, W, s, set }),
        h(SettingRow, { c, key: 'observer', label: W.observer },
            h(ChoiceGroup, { c, items: [{ id: '2', label: '2°' }, { id: '10', label: '10°' }], activeId: String(s.observer), onSelect: id => set('observer', id) })),
        h(SettingRow, { c, key: 'illuminant', label: W.illuminant },
            h(SelectField, { c, value: s.illuminant, options: valueOptions(['D65', 'D50', 'A', 'E']), width: 80, onChange: v => set('illuminant', v) })),
        h(SettingRow, { c, key: 'step', label: W.step },
            h(NumInput, { c, value: s.step, min: 1, max: 20, step: 1, width: 56, onChange: v => set('step', v) }),
            h('span', { style: { fontSize: 11, color: c.textDim } }, W.nm)),
    ],
    integrals: ({ c, W, s, set }) => [
        h(AngleRow, { key: 'angle', c, W, s, set }),
        h(SettingRow, { c, key: 'pol', label: W.polarization },
            h(ChoiceGroup, { c, items: POL_ITEMS, activeId: s.polarization, onSelect: id => set('polarization', id) })),
    ],
    gdGdd: ({ c, W, s, set }) => [
        ...RangeRows({ c, W, s, set }).slice(0, 2),
        h(AngleRow, { key: 'angle', c, W, s, set }),
        h(SettingRow, { c, key: 'target', label: W.target },
            h(ChoiceGroup, { c, items: [{ id: 'R', label: 'R' }, { id: 'T', label: 'T' }], activeId: s.target, onSelect: id => set('target', id) }),
            h(ChoiceGroup, { c, items: [{ id: 'front', label: W.sides.front }, { id: 'back', label: W.sides.back }], activeId: s.side, onSelect: id => set('side', id) })),
        h(SettingRow, { c, key: 'pol', label: W.polarization },
            h(ChoiceGroup, { c, items: POL_ITEMS, activeId: s.pol, onSelect: id => set('pol', id) })),
        h(SettingRow, { c, key: 'quantities', label: W.quantities, wrap: true },
            [['phase', W.phase], ['gd', 'GD'], ['gdd', 'GDD'], ['tod', 'TOD']].map(([key, label]) => h(CheckField, {
                key, c, label, checked: !!s.quantities?.[key],
                onChange: e => set('quantities', { ...s.quantities, [key]: e.target.checked }),
            }))),
        h(SettingDivider, { c, key: 'd' }),
        h(PlotRow, { key: 'plot', c, W, s, set }),
        h(TableRow, { key: 'table', c, W, s, set }),
    ],
    ellipsometry: ({ c, W, s, set }) => [
        ...RangeRows({ c, W, s, set }),
        h(SettingRow, { c, key: 'show', label: W.curves },
            h(CheckField, { c, label: 'Ψ', checked: !!s.showPsi, onChange: e => set('showPsi', e.target.checked) }),
            h(CheckField, { c, label: 'Δ', checked: !!s.showDelta, onChange: e => set('showDelta', e.target.checked) })),
        h(SettingDivider, { c, key: 'd' }),
        h(PlotRow, { key: 'plot', c, W, s, set }),
        h(TableRow, { key: 'table', c, W, s, set }),
    ],
    efield: ({ c, W, s, set, design }) => [
        h(LambdaRow, { key: 'lambda', c, W, s, set, design }),
        h(AngleRow, { key: 'angle', c, W, s, set }),
        h(SettingRow, { c, key: 'pol', label: W.polarization },
            h(ChoiceGroup, { c, items: POL_ITEMS.slice(1), activeId: s.pol, onSelect: id => set('pol', id) })),
        h(PlotRow, { key: 'plot', c, W, s, set }),
    ],
    riProfile: ({ c, W, s, set, design }) => [
        h(LambdaRow, { key: 'lambda', c, W, s, set, design }),
        h(PlotRow, { key: 'plot', c, W, s, set }),
    ],
    monteCarlo: ({ c, W, s, set }) => [
        h('div', { key: 'hint', style: { fontSize: 10, color: c.textDim, lineHeight: 1.5, marginBottom: 6 } }, W.monteCarloHint),
        h(PlotRow, { key: 'plot', c, W, s, set }),
        h(TableRow, { key: 'table', c, W, s, set }),
        h(SettingRow, { c, key: 'envelope', label: '' },
            h(CheckField, { c, label: W.envelope, checked: !!s.envelope, onChange: e => set('envelope', e.target.checked) })),
    ],
    worksheet: ({ c, W }) => h('div', { style: { fontSize: 10, color: c.textDim, lineHeight: 1.5 } }, W.worksheetHint),
};

/** Style of a panel that opens over the page, beside the rail. */
export function overlayPanelStyle(c, width) {
    return {
        position: 'absolute', left: RAIL_WIDTH + 8, top: 8, zIndex: 50, width,
        maxHeight: 'calc(100% - 16px)', overflowY: 'auto',
        padding: 10, backgroundColor: c.panel, border: `1px solid ${c.border}`, borderRadius: 6,
        boxShadow: '0 6px 20px rgba(0,0,0,0.35)', fontFamily: FONT, fontSize: 11, color: c.text,
    };
}

/** Catcher behind an overlay panel: a click anywhere else closes it. */
export function OverlayCatcher({ onClose }) {
    return h('div', { onClick: onClose, style: { position: 'absolute', inset: 0, zIndex: 49 } });
}

export function BlockSettingsPanel({ c, W, t, block, index, count, design, onChange, onMove, onRemove, onClose }) {
    // Completed with the type's defaults, so a block made before a setting
    // existed still shows every control.
    const s = withDefaults(block.type, block.settings);
    const patch = changes => onChange(block.id, changes);
    const set = (key, value) => patch({ [key]: value });
    const Form = FORMS[block.type];
    const builtin = BUILTIN_TYPES.includes(block.type);
    return [
        h(OverlayCatcher, { key: 'catcher', onClose }),
        h('div', { key: 'panel', style: overlayPanelStyle(c, 340) },
            h('div', { style: { fontSize: 12, fontWeight: 600, paddingBottom: 6 } }, blockName(W, block.type)),
            Form ? Form({ c, W, t, s, set, patch, design }) : null,
            h('div', { style: { display: 'flex', gap: 6, marginTop: 10, paddingTop: 8, borderTop: `1px solid ${c.border}` } },
                h(PanelButton, { c, label: W.moveUp, disabled: index === 0, onClick: () => onMove(block.id, -1) }),
                h(PanelButton, { c, label: W.moveDown, disabled: index >= count - 1, onClick: () => onMove(block.id, 1) }),
                h(PanelButton, { c, label: W.remove, disabled: builtin, tone: c.error, onClick: () => { onRemove(block.id); onClose(); } }),
            ),
        ),
    ];
}
