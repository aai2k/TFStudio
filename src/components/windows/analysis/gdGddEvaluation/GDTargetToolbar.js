import { CheckField, ChoiceGroup, NumInput } from '../chrome/controls.js';
import { ModeRow } from '../chrome/layout.js';

const { createElement: h } = React;

/**
 * The wavelength grid is typed; the level grid is read off the visible range
 * and shown beside it, so where a drawing lands is never a surprise.
 */
function SnapControls({ c, text, editor, unit }) {
    const dim = { fontSize: 10, color: c.textDim, whiteSpace: 'nowrap' };
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
        h(CheckField, {
            c, label: text.snap, checked: editor.snapOn, title: text.snapTip,
            onChange: event => editor.setSnapOn(event.target.checked),
        }),
        editor.snapOn && h(NumInput, {
            value: editor.snapNm, min: 0, max: 100, step: 1, c, width: 40, onChange: editor.setSnapNm,
        }),
        editor.snapOn && h('span', { style: dim }, text.snapNmUnit),
        editor.snapOn && editor.levelStep > 0 && h('span', { style: dim, title: text.snapLevelTip },
            `${editor.levelStep} ${unit}`),
    );
}

/** The row that belongs to target editing: the tool in hand, snapping, and a hint. */
export function GDTargetToolbar({ c, text, editor, unit }) {
    if (!editor.editMode) return null;
    const drawing = editor.editTool === 'draw';
    return h(ModeRow, { c, 'data-gd-toolbar': 'targets' },
        h(ChoiceGroup, {
            c, ariaLabel: text.editTargets, activeId: editor.editTool, onSelect: editor.setEditTool,
            items: [
                { id: 'draw', label: text.editToolDraw, title: text.editToolDrawTip },
                { id: 'delete', label: text.editToolDelete, title: text.editToolDeleteTip },
            ],
        }),
        drawing && h(SnapControls, { c, text, editor, unit }),
        h('span', {
            style: {
                flexBasis: '100%', padding: '5px 8px', borderRadius: 5,
                backgroundColor: c.panel, fontSize: 10, lineHeight: 1.4, color: c.textDim,
            },
        }, drawing ? text.editHintDraw : text.editHintDelete),
    );
}
