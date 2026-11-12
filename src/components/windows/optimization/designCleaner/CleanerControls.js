import { CheckField, ChoiceGroup, FieldLabel, NumInput, SelectField, SolidButton } from '../../analysis/chrome/controls.js';
import { ControlRow } from '../../analysis/chrome/layout.js';
import { SettingRow, SettingsMenu } from '../../analysis/chrome/popover.js';
import { tablerIcon } from '../../../ui/tablerIcons.js';
import { CLEANER_REFINERS } from './sessionState.js';

const { createElement: h } = React;

// Front and back carry the colours every window that picks a side gives them.
const SIDE_COLORS = { front: '#1e88e5', back: '#e53935' };

// The side cleaned, offered on a design with layers on both sides that is not
// symmetric (model.js offersSide).
function SideChoice({ c, dc, side, setSide, disabled }) {
    return h(ChoiceGroup, {
        c, label: dc.side, activeId: side, onSelect: setSide,
        items: ['front', 'back', 'both'].map(id => ({
            id, label: dc.sides[id], title: dc.sideTips[id], color: SIDE_COLORS[id], disabled,
        })),
    });
}

// The thinnest layer kept, nm.
function MinThickness({ c, dc, units, dMin, setDMin, disabled }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        h(FieldLabel, { c }, dc.minThickness),
        h(NumInput, { c, value: dMin, min: 0, max: 200, step: 0.5, width: 56, disabled, onChange: setDMin }),
        h(FieldLabel, { c }, units.nm),
    );
}

/**
 * The re-optimize pass's refiner and step budget, the window's Settings menu.
 * The refiners are named as the Refinement window names its methods (`tr` is
 * its strings).
 */
export function ReoptimizeSettings({ c, dc, tr, reoptMethod, setReoptMethod, reoptIters, setReoptIters, disabled }) {
    return h(React.Fragment, null,
        h(SettingRow, { c, label: dc.method },
            h(SelectField, {
                c, value: reoptMethod, onChange: setReoptMethod, disabled,
                title: tr.methodNotes[reoptMethod] || tr.methods[reoptMethod],
                options: CLEANER_REFINERS.map(id => ({ id, label: tr.methods[id] })),
            }),
        ),
        h(SettingRow, { c, label: dc.reoptIters },
            h(NumInput, {
                c, value: reoptIters, min: 1, max: 500, step: 10, integer: true, width: 72, disabled,
                onChange: setReoptIters,
            }),
        ),
    );
}

// Apply, or Stop in its place while the re-optimize pass runs. Stop keeps the
// cleanup and the best point reached.
function ApplyButton({ c, dc, applying, progress, ops, apply, stop }) {
    if (progress) return h(SolidButton, { c, color: c.error, label: dc.stop, onClick: stop }, tablerIcon('player-stop', 13));
    return h(SolidButton, {
        c, color: c.success, label: applying ? dc.applying : `${dc.apply} (${ops.length})`,
        onClick: apply, disabled: applying || ops.length === 0,
    });
}

/**
 * The window's row: the side, where one is offered, the thinnest layer kept,
 * the merge and re-optimize switches; then the Settings menu and Apply. Nothing
 * on it appears or goes when a switch changes, so it keeps its length.
 */
export function CleanerControls({
    c, dc, tr, units, settingsLabel, design, sideOffered, side, setSide, dMin, setDMin,
    mergeAdjacent, setMergeAdjacent, reoptimize, setReoptimize,
    reoptIters, setReoptIters, reoptMethod, setReoptMethod, applying, progress, ops, apply, stop,
}) {
    const canReoptimize = design.meritOperands?.length > 0;
    return h(ControlRow, {
        c,
        trailing: [
            h(SettingsMenu, { key: 'settings', c, label: settingsLabel },
                h(ReoptimizeSettings, {
                    c, dc, tr, reoptMethod, setReoptMethod, reoptIters, setReoptIters,
                    disabled: applying || !(reoptimize && canReoptimize),
                })),
            h(ApplyButton, { key: 'apply', c, dc, applying, progress, ops, apply, stop }),
        ],
    },
        sideOffered && h(SideChoice, { c, dc, side, setSide, disabled: applying }),
        h(MinThickness, { c, dc, units, dMin, setDMin, disabled: applying }),
        h(CheckField, {
            c, label: dc.mergeAdjacent, title: dc.mergeAdjacentTip, checked: mergeAdjacent, disabled: applying,
            onChange: e => setMergeAdjacent(e.target.checked),
        }),
        h(CheckField, {
            c, label: dc.reoptimize, title: canReoptimize ? undefined : dc.reoptimizeNoOperands,
            checked: reoptimize && canReoptimize, disabled: applying || !canReoptimize,
            onChange: e => setReoptimize(e.target.checked),
        }),
    );
}
