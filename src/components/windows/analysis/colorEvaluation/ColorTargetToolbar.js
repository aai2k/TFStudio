import { ChoiceGroup, FieldLabel, SelectField } from '../chrome/controls.js';
import { ModeRow } from '../chrome/layout.js';
import { formatTheta } from '../opticalEvaluation/model.js';

const { createElement: h } = React;

/**
 * The row that belongs to target editing: the tool in hand, and the angle a
 * target drawn on the diagram is written at, Nearest (the angle of the coating
 * point nearest the click) or one of the angles the window shows. What each
 * tool does is in its tooltip.
 */
export function ColorTargetToolbar({ c, ce, editor }) {
    if (!editor.editMode) return null;
    const options = [
        { id: 'nearest', label: ce.drawAoiNearest },
        ...editor.angles.map(theta => ({ id: String(theta), label: `${formatTheta(theta)}°` })),
    ];
    return h(ModeRow, { c, 'data-color-toolbar': 'targets' },
        h(ChoiceGroup, {
            c, ariaLabel: ce.editTargets, activeId: editor.editTool, onSelect: editor.setEditTool,
            items: [
                { id: 'draw', label: ce.editToolDraw, title: ce.editToolDrawTip },
                { id: 'delete', label: ce.editToolDelete, title: ce.editToolDeleteTip },
            ],
        }),
        h('span', { title: ce.drawAoiTip, style: { display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
            h(FieldLabel, { c }, ce.aoi),
            h(SelectField, { c, value: editor.drawAoi, onChange: editor.setDrawAoi, options, title: ce.drawAoiTip })),
    );
}
