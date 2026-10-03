/**
 * The panels the curve editor's Fill…, Change…, Smooth… and Resample…
 * buttons open under themselves, one at a time. A panel says in a sentence
 * what its tool will do and to which cells, with the tool's numbers inside
 * the sentence, and follows the selection while it is open: a press in the
 * table leaves it open, so cells can be picked with it showing. Its button
 * pressed again, Escape, or running the tool closes it. What it says is
 * toolText.js's.
 */
import { ActionButton, NumInput } from '../../analysis/chrome/controls.js';
import { panelStyle, triggerStyle } from '../../analysis/chrome/popover.js';
import { smoothingSide, smoothingWindow } from './curveOps.js';
import { selectedOf } from './editorActions.js';
import { changeText, fillText, resampleText, smoothText } from './toolText.js';

const { createElement: h } = React;

const NOTE_COLOR = { preview: c => c.text, hint: c => c.textDim, error: c => c.error || '#ef5350' };

function setTool(editor, name, patch) {
    editor.setTools(tools => ({ ...tools, [name]: { ...tools[name], ...patch } }));
}

// A sentence with number fields in it: `parts` is the text around the fields,
// one piece more than there are fields.
function sentence(parts, fields) {
    const pieces = parts.flatMap((part, index) => (index < fields.length ? [part, fields[index]] : [part]));
    return h('span', { style: { lineHeight: '28px' } }, ...pieces);
}

const numberField = (c, value, onChange) => h(NumInput, { c, width: 62, nullable: true, step: 1, value, onChange });

// One of a tool's modes: a radio button and its sentence. A field of the
// sentence taking focus picks the mode too, a number typed there meaning it.
function ModeRow({ c, name, checked, onPick, parts, fields }) {
    const pickOnce = () => { if (!checked) onPick(); };
    return h('label', {
        onFocus: pickOnce,
        style: { display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: c.text },
    },
        h('input', {
            type: 'radio', name, checked, onChange: pickOnce,
            style: { accentColor: c.accent, cursor: 'pointer', margin: 0 },
        }),
        sentence(parts, fields));
}

// A tool's modes as radio rows, each with its fields: `rows` is [[mode, keys]],
// `keys` naming the numbers of the tool's state its fields edit.
function modeRows({ editor, c, name, rows, parts }) {
    const tool = editor.tools[name];
    const set = patch => setTool(editor, name, patch);
    return rows.map(([mode, keys]) => h(ModeRow, {
        key: mode, c, name: `curve-${name}`, checked: tool.mode === mode, onPick: () => set({ mode }),
        parts: parts[mode], fields: keys.map(key => numberField(c, tool[key], value => set({ [key]: value }))),
    }));
}

// The tool's button is never switched off. A number typed into the panel is
// committed when its field loses focus, which the press on the button causes,
// and that same press must then run the tool. Until the tool can run, the
// button is dimmed and a press does nothing.
function RunButton({ c, label, ready, onRun }) {
    return h('span', { style: { opacity: ready ? 1 : 0.45 } },
        h(ActionButton, { c, label, onClick: () => { if (ready) onRun(); } }));
}

function PanelBody({ c, text, onRun, children }) {
    const note = text.problem || (text.preview && { text: text.preview, tone: 'preview' });
    return h('div', { style: { ...panelStyle(c, 300), left: 0, right: 'auto' } },
        text.title && h('div', { style: { fontWeight: 600, lineHeight: 1.4, marginBottom: 4 } }, text.title),
        children,
        note && h('div', {
            role: note.tone === 'error' ? 'alert' : 'status',
            style: { marginTop: 6, lineHeight: 1.4, color: NOTE_COLOR[note.tone](c), fontVariantNumeric: 'tabular-nums' },
        }, note.text),
        h('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: 8 } },
            h(RunButton, { c, label: text.run, ready: text.ready, onRun })));
}

const FILL_ROWS = [['constant', ['value']], ['step', ['first', 'step']], ['log', ['first', 'last']],
    ['wavenumber', ['first', 'last']]];
const CHANGE_ROWS = [['percent', ['percent']], ['linear', ['a', 'b']]];

function FillPanel({ editor, labels, c, ce, onRun }) {
    const text = fillText(ce, labels, editor.table, selectedOf(editor), editor.tools.fill);
    return h(PanelBody, { c, text, onRun },
        modeRows({ editor, c, name: 'fill', rows: FILL_ROWS, parts: ce.panels.fill.rows }));
}

function ChangePanel({ editor, labels, c, ce, onRun }) {
    const text = changeText(ce, labels, editor.table, selectedOf(editor), editor.tools.change);
    return h(PanelBody, { c, text, onRun },
        modeRows({ editor, c, name: 'change', rows: CHANGE_ROWS, parts: ce.panels.change.rows }));
}

function SmoothPanel({ editor, labels, c, ce, onRun }) {
    const { smooth } = editor.tools;
    const set = patch => setTool(editor, 'smooth', patch);
    const text = smoothText(ce, labels, editor.table, selectedOf(editor), smooth);
    return h(PanelBody, { c, text, onRun },
        h('div', { style: { color: c.text } }, sentence(ce.panels.smooth.sentence, [
            h(NumInput, { c, width: 44, min: 0, step: 1, value: smooth.order, onChange: order => set({ order }) }),
            h(NumInput, {
                c, width: 44, min: 1, step: 1, value: smoothingSide(smooth.window),
                onChange: side => set({ window: smoothingWindow(side) }),
            }),
        ])));
}

function ResamplePanel({ editor, labels, c, ce, onRun }) {
    const { table, tools } = editor;
    const text = resampleText(ce, labels, table, tools.step);
    const step = h(NumInput, {
        c, width: 62, positive: true, step: 0.1, value: tools.step,
        onChange: value => editor.setTools(current => ({ ...current, step: value })),
    });
    return h(PanelBody, { c, text, onRun },
        h('div', { style: { color: c.text } }, sentence(ce.panels.resample.sentence(labels.xUnit(table.xUnit)), [step])));
}

const PANELS = { fill: FillPanel, change: ChangePanel, smooth: SmoothPanel, resample: ResamplePanel };

/**
 * A tool's button and, while it is open, its panel under it.
 *
 *   id     'fill', 'change', 'smooth' or 'resample': the panel, the editor
 *          action it runs and the button's label in `ce`
 *   title  the button's tooltip
 */
export function PanelTool({ editor, labels, c, ce, id, title }) {
    const open = editor.panel === id;
    // The keys go back to the table, so that Ctrl+Z after a fill reaches it.
    const close = () => {
        editor.setPanel(null);
        editor.sel.tableRef.current?.focus();
    };
    const onKeyDown = event => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        close();
    };
    return h('div', { onKeyDown, style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            type: 'button', title, 'aria-expanded': open,
            onClick: () => editor.setPanel(open ? null : id),
            style: triggerStyle(c, { open }),
        }, ce[id]),
        open && h(PANELS[id], {
            editor, labels, c, ce,
            onRun: () => {
                editor.actions[id]();
                close();
            },
        }));
}
