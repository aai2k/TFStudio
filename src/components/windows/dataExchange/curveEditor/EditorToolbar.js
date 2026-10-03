/**
 * The curve editor's tool row: reading a file, undo and redo, inserting and
 * deleting rows, the tools that open a panel under their button
 * (ToolPanels.js), and dragging points on the plot.
 */
import { ActionButton, Divider, ToggleButton } from '../../analysis/chrome/controls.js';
import { PanelTool } from './ToolPanels.js';

const { createElement: h } = React;

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
        h(ActionButton, { c, label: ce.undo, title: 'Ctrl+Z', onClick: actions.undo, disabled: !editor.canUndo }),
        h(ActionButton, { c, label: ce.redo, title: 'Ctrl+Y', onClick: actions.redo, disabled: !editor.canRedo }),
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
    );
}
