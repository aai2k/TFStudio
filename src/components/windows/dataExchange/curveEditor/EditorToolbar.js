/**
 * The curve editor's tool row: reading a file, undo and redo, inserting and
 * deleting rows, the tools that open a panel under their button
 * (ToolPanels.js), dragging points on the plot, and, at the row's right end
 * over the plot, the plot's Y range.
 */
import { niceTickInterval } from '../../../ui/chartOptions.js';
import {
    ActionButton, CheckField, Divider, FieldLabel, RangeField, ToggleButton,
} from '../../analysis/chrome/controls.js';
import { PanelTool } from './ToolPanels.js';

const { createElement: h } = React;

/**
 * The plot's Y range: Auto, or the left axis from one typed end to the other.
 * With Auto on the fields show the ends the axis was drawn with, greyed, and
 * clearing it starts from them (useCurveEditor.js). The arrows step by a round
 * twentieth of the span, which is 5 on a 0-100 axis and 0.05 on a 0-1 one, as
 * the Y range of Optical Evaluation steps.
 */
function YRange({ editor, c, ce }) {
    const { yRange } = editor;
    const ends = yRange.auto ? editor.yEnds || [null, null] : [yRange.min, yRange.max];
    const step = niceTickInterval(ends[1] - ends[0], { targetTicks: 20 });
    const end = (at, key) => ({
        value: ends[at], nullable: true, step, disabled: yRange.auto,
        onChange: value => editor.setYEnd(key, value),
    });
    return h('div', {
        title: ce.yRangeTip,
        style: { display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', flexShrink: 0 },
    },
        h(FieldLabel, { c }, 'Y'),
        h(CheckField, {
            c, label: ce.yAuto, checked: yRange.auto, onChange: event => editor.setYAuto(event.target.checked),
        }),
        h(RangeField, { c, width: 64, from: end(0, 'min'), to: end(1, 'max') }),
    );
}

export function EditorToolbar({ editor, labels, c, ce }) {
    const { actions } = editor;
    const tool = (id, title) => h(PanelTool, { editor, labels, c, ce, id, title });
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flexShrink: 0,
            padding: '6px 12px', borderBottom: `1px solid ${c.border}`,
        },
    },
        h(ActionButton, { c, label: ce.importFile, title: ce.importFileTip, onClick: actions.importFile }),
        h(Divider, { c }),
        h(ActionButton, { c, label: ce.undo, title: 'Ctrl+Z, F3', onClick: actions.undo, disabled: !editor.canUndo }),
        h(ActionButton, { c, label: ce.redo, title: 'Ctrl+Y, Ctrl+F3', onClick: actions.redo, disabled: !editor.canRedo }),
        h(Divider, { c }),
        h(ActionButton, { c, label: ce.insertRows, title: ce.insertRowsTip, onClick: actions.insertRows }),
        h(ActionButton, { c, label: ce.deleteRows, title: ce.deleteRowsTip, onClick: actions.deleteRows }),
        h(Divider, { c }),
        tool('fill'),
        tool('change'),
        tool('smooth', ce.smoothTip),
        tool('resample', ce.resampleTip),
        h(Divider, { c }),
        h(ToggleButton, {
            c, label: ce.dragPoints, title: ce.dragPointsTip, active: editor.dragOn,
            onClick: () => editor.setDragOn(on => !on),
        }),
        h(YRange, { editor, c, ce }),
    );
}
