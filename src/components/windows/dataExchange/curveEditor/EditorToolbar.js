/**
 * The curve editor's two tool rows: the file, undo and row actions, and the
 * tools that act on the selected cells or the whole table.
 */
import {
    ActionButton, Divider, FieldLabel, NumInput, SelectField, ToggleButton,
} from '../../analysis/chrome/controls.js';

const { createElement: h } = React;

const rowStyle = c => ({
    display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
    padding: '6px 12px', borderBottom: `1px solid ${c.border}`,
});

function ActionsRow({ editor, c, ce }) {
    const { actions } = editor;
    return h('div', { style: rowStyle(c) },
        h(ActionButton, { c, label: ce.importFile, title: ce.importFileTip, onClick: actions.importFile }),
        h(Divider, { c }),
        h(ActionButton, { c, label: ce.undo, title: 'Ctrl+Z', onClick: actions.undo, disabled: !editor.canUndo }),
        h(ActionButton, { c, label: ce.redo, title: 'Ctrl+Y', onClick: actions.redo, disabled: !editor.canRedo }),
        h(Divider, { c }),
        h(ActionButton, { c, label: ce.insertRows, title: ce.insertRowsTip, onClick: actions.insertRows }),
        h(ActionButton, { c, label: ce.deleteRows, title: ce.deleteRowsTip, onClick: actions.deleteRows }),
        h(Divider, { c }),
        h(ToggleButton, {
            c, label: ce.dragPoints, title: ce.dragPointsTip, active: editor.dragOn,
            onClick: () => editor.setDragOn(on => !on),
        }),
    );
}

// The two numbers a fill takes, named for what they are in each mode.
const FILL_FIELDS = {
    constant: ['fillValue'],
    step: ['fillFirst', 'fillStep'],
    log: ['fillFirst', 'fillLast'],
    wavenumber: ['fillFirst', 'fillLast'],
};
const CHANGE_FIELDS = { percent: ['changePercent'], linear: ['changeA', 'changeB'] };

function setTool(editor, name, patch) {
    editor.setTools(tools => ({ ...tools, [name]: { ...tools[name], ...patch } }));
}

// A mode, its numbers and the button that runs it.
function ModeTool({ editor, c, ce, name, modes, fields, run }) {
    const tool = editor.tools[name];
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        h(SelectField, {
            c, value: tool.mode, width: 116, title: ce[name],
            options: Object.keys(modes).map(id => ({ id, label: modes[id] })),
            onChange: mode => setTool(editor, name, { mode }),
        }),
        fields[tool.mode].map((field, index) => h(NumInput, {
            key: field, c, width: 62, nullable: true, placeholder: ce[field], title: ce[field],
            value: tool[index ? 'b' : 'a'], step: 1,
            onChange: value => setTool(editor, name, { [index ? 'b' : 'a']: value }),
        })),
        h(ActionButton, { c, label: ce[name], onClick: run }),
    );
}

function ResampleTool({ editor, labels, c, ce }) {
    const { table, tools } = editor;
    const unit = labels.xUnit(table.xUnit);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' } },
        h(FieldLabel, { c }, ce.resampleStep),
        h(NumInput, {
            c, width: 62, positive: true, step: 0.1, value: tools.step, title: ce.resampleStepTip,
            onChange: step => editor.setTools(current => ({ ...current, step })),
        }),
        h('span', { style: { color: c.textDim, fontSize: 11 } }, unit),
        h(ActionButton, { c, label: ce.resample, title: ce.resampleTip, onClick: editor.actions.resample }),
    );
}

function SmoothTool({ editor, c, ce }) {
    const { smooth } = editor.tools;
    const set = patch => setTool(editor, 'smooth', patch);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
        h(FieldLabel, { c }, ce.smoothWindow),
        h(NumInput, { c, width: 44, min: 3, step: 2, value: smooth.window, onChange: window => set({ window }) }),
        h(FieldLabel, { c }, ce.smoothOrder),
        h(NumInput, { c, width: 40, min: 0, step: 1, value: smooth.order, onChange: order => set({ order }) }),
        h(ActionButton, { c, label: ce.smooth, title: ce.smoothTip, onClick: editor.actions.smooth }),
    );
}

function ToolsRow({ editor, labels, c, ce }) {
    return h('div', { style: rowStyle(c) },
        h(ModeTool, {
            editor, c, ce, name: 'fill', modes: ce.fillModes, fields: FILL_FIELDS, run: editor.actions.fill,
        }),
        h(Divider, { c }),
        h(ModeTool, {
            editor, c, ce, name: 'change', modes: ce.changeModes, fields: CHANGE_FIELDS, run: editor.actions.change,
        }),
        h(Divider, { c }),
        h(SmoothTool, { editor, c, ce }),
        h(Divider, { c }),
        h(ResampleTool, { editor, labels, c, ce }),
    );
}

export function EditorToolbar({ editor, labels, c, ce }) {
    return h('div', { style: { flexShrink: 0 } },
        h(ActionsRow, { editor, c, ce }),
        h(ToolsRow, { editor, labels, c, ce }),
    );
}
