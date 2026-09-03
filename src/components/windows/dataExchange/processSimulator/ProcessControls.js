/**
 * The window's control row and its settings panel.
 *
 * The row holds what defines the run and what is drawn: the side being
 * deposited, whether it goes on the part or on witness chips, the state of the
 * opposite surface, the quantity, and the layer curves. The monitor's geometry,
 * the spectral range and the export step are settings: they are set once per
 * instrument, and on the row they wrapped a docked window twice over and moved
 * every control on each resize.
 */

import {
    ActionButton, CheckField, ChoiceGroup, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import {
    NoticeBadge, SettingDivider, SettingRow, SettingsMenu,
} from '../../analysis/chrome/popover.js';

const { createElement: h } = React;

const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

function StatusMessage({ c, status }) {
    const error = status.type === 'error';
    return h('div', {
        title: status.message,
        style: {
            fontSize: 11, height: 28, display: 'flex', alignItems: 'center',
            padding: '0 8px', borderRadius: 6,
            color: error ? c.error : c.success,
            backgroundColor: (error ? c.error : c.success) + (c.light ? '20' : '30'),
            maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        },
    }, status.message);
}

function ProcessSettings({ c, t, sp, setup }) {
    return h(SettingsMenu, { c, t, label: t.analysisChrome.settings, width: 300 },
        h(SettingRow, { c, label: sp.polarization },
            h(ChoiceGroup, {
                ariaLabel: sp.polarization, activeId: setup.polarization, onSelect: setup.setPolarization, c,
                items: [{ id: 'avg', label: sp.polAvg }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
            }),
        ),
        h(SettingRow, { c, label: sp.aoi },
            h(NumInput, { c, width: 68, value: setup.aoi, min: 0, max: 89, step: 1, onChange: setup.setAoi }),
        ),
        h(SettingRow, { c, label: 'λ' },
            h(RangeField, {
                c, unit: 'nm', width: 60,
                from: { value: setup.lambdaStart, min: 100, max: 50000, step: 10, onChange: setup.setLambdaStart },
                to: { value: setup.lambdaEnd, min: 100, max: 50000, step: 10, onChange: setup.setLambdaEnd },
            }),
        ),
        h(SettingRow, { c, label: sp.step },
            h(NumInput, {
                c, width: 68, value: setup.lambdaStep, min: 0.1, max: 100, step: 0.5,
                onChange: setup.setLambdaStep,
            }),
        ),
        h(SettingDivider, { c }),
        h(SettingRow, { c, label: sp.exportStep },
            h(NumInput, {
                c, width: 68, title: sp.exportStepHint,
                value: setup.exportStep, min: 0.01, max: 100, step: 0.1,
                onChange: setup.setExportStep,
            }),
        ),
    );
}

function saveLabel(sp, save) {
    if (!save.saving) return sp.saveBtn;
    return save.progress ? sp.savingStep(save.progress.i, save.progress.total) : sp.saving;
}

export function ProcessControls({ c, t, sp, setup, deposition, save, notices, chipMode }) {
    const hasActive = deposition.N > 0;
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            save.statusMsg && h(StatusMessage, { key: 'status', c, status: save.statusMsg }),
            h(ActionButton, {
                key: 'save', c, label: saveLabel(sp, save),
                title: sp.saveBtn, disabled: !hasActive || save.saving,
                onClick: save.handleSave,
            }),
            h(ProcessSettings, { key: 'settings', c, t, sp, setup }),
        ],
    },
        h(ChoiceGroup, {
            label: sp.activeSide, activeId: setup.activeSide, onSelect: setup.setActiveSide, c,
            items: [
                { id: 'front', label: sp.front, color: SIDE_COLORS.front },
                { id: 'back', label: sp.back, color: SIDE_COLORS.back },
            ],
        }),
        h(ChoiceGroup, {
            label: sp.depositOn, activeId: setup.mode, onSelect: setup.setMode, c,
            items: [
                { id: 'part', label: sp.modePart },
                { id: 'chips', label: sp.modeChips },
            ],
        }),
        // A witness chip's back face is always bare; the opposite-side choice
        // belongs to the part alone.
        !chipMode && h(ChoiceGroup, {
            label: sp.secondSurface, activeId: setup.secondSurface, onSelect: setup.setSecondSurface, c,
            items: [
                { id: 'bare', label: sp.bare },
                { id: 'coated', label: sp.coated },
            ],
        }),
        h(ChoiceGroup, {
            label: sp.quantity, activeId: setup.quantity, onSelect: setup.setQuantity, c,
            items: [{ id: 'T', label: 'T' }, { id: 'R', label: 'R' }, { id: 'A', label: 'A' }],
        }),
        h(CheckField, {
            c, label: sp.showAllLayers, title: sp.showAllHint,
            checked: setup.showAll,
            onChange: event => setup.setShowAll(event.target.checked),
        }),
    );
}
