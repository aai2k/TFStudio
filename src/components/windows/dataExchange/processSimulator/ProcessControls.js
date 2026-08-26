/**
 * The window's one row of controls.
 *
 * Everything that shapes the spectrum or the export is on the row: this window
 * is driven while a run is being set up, and a setting behind a panel is a
 * setting nobody checks. The row wraps when the dock is narrow.
 */

import {
    ActionButton, CheckField, ChoiceGroup, Divider, FieldLabel, NumInput, RangeField,
} from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import { NoticeBadge } from '../../analysis/chrome/popover.js';

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

export function ProcessControls({ c, t, sp, setup, deposition, save, notices }) {
    const hasActive = deposition.N > 0;
    return h(ControlRow, {
        c,
        trailing: [
            h(NoticeBadge, { key: 'notices', c, notices, label: t.analysisChrome.notices }),
            save.statusMsg && h(StatusMessage, { key: 'status', c, status: save.statusMsg }),
            h(FieldLabel, { key: 'export-label', c }, sp.exportStep),
            h(NumInput, {
                key: 'export-step', c, width: 64, title: sp.exportStepHint,
                value: setup.exportStep, min: 0.01, max: 100, step: 0.1,
                onChange: setup.setExportStep,
            }),
            h(ActionButton, {
                key: 'save', c, label: save.saving ? sp.saving : sp.saveBtn,
                title: sp.saveBtn, disabled: !hasActive || save.saving,
                onClick: save.handleSave,
            }),
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
        h(FieldLabel, { c }, sp.aoi),
        h(NumInput, { c, width: 52, value: setup.aoi, min: 0, max: 89, step: 1, onChange: setup.setAoi }),
        h(ChoiceGroup, {
            label: sp.polarization, activeId: setup.polarization, onSelect: setup.setPolarization, c,
            items: [{ id: 'avg', label: sp.polAvg }, { id: 's', label: 's' }, { id: 'p', label: 'p' }],
        }),
        h(Divider, { c }),
        h(RangeField, {
            c, label: 'λ', unit: 'nm', width: 58,
            from: { value: setup.lambdaStart, min: 100, max: 50000, step: 10, onChange: setup.setLambdaStart },
            to: { value: setup.lambdaEnd, min: 100, max: 50000, step: 10, onChange: setup.setLambdaEnd },
        }),
        h(FieldLabel, { c }, sp.step),
        h(NumInput, {
            c, width: 52, value: setup.lambdaStep, min: 0.1, max: 100, step: 0.5,
            onChange: setup.setLambdaStep,
        }),
        h(Divider, { c }),
        h(CheckField, {
            c, label: sp.showAllLayers, title: sp.showAllHint,
            checked: setup.showAll,
            onChange: event => setup.setShowAll(event.target.checked),
        }),
    );
}
