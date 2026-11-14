import { useWindowSession } from '../../windowSession.js';
import { createColorTarget, deleteColorTarget, markKey, moveColorTarget } from './colorTargetEdits.js';
import { colorTargetSession } from './sessionState.js';

/**
 * Drawing on the diagram writes to the design's merit rows, so the Merit
 * Function Editor shows the same rows and each gesture is one undo step. The
 * rows a drawing becomes are fixed by what the window shows: side,
 * polarization, illuminant, observer and diagram are its own settings. The
 * angle is the one chosen in the editing row, Nearest (the angle of the
 * coating point nearest the click) or one of the window's angles; a chosen
 * angle the window no longer shows reads as Nearest. `marks` are the diamonds
 * drawn (colorTargets.js), the only ones a gesture can reach; `reports` and
 * `environment` the coating's points and the window's environment choice.
 */
export function useColorTargetEditor({ design, updateDesign, state, marks, reports, environment }) {
    const [session, setField] = useWindowSession(colorTargetSession, design);
    const operands = design?.meritOperands || [];
    const angles = [...new Set((reports || []).map(entry => entry.theta))].sort((a, b) => a - b);
    const drawAoi = angles.some(theta => String(theta) === session.drawAoi) ? session.drawAoi : 'nearest';
    const markOf = key => marks.find(mark => markKey(mark) === key);
    const view = {
        characteristic: state.characteristic, pol: state.pol, illuminant: state.illuminant,
        observer: state.observer, diagram: state.diagram,
    };
    const write = meritOperands => updateDesign({ meritOperands });
    return {
        editMode: session.editMode,
        setEditMode: value => setField('editMode', value),
        editTool: session.editTool,
        setEditTool: value => setField('editTool', value),
        angles,
        drawAoi,
        setDrawAoi: value => setField('drawAoi', value),
        onCreate: item => {
            if (!reports?.length) return;
            const aoi = drawAoi === 'nearest' ? null : Number(drawAoi);
            write(createColorTarget({ operands, point: [item.x0, item.y0], view, reports, environment, aoi }));
        },
        onEdit: (meta, item) => {
            const mark = markOf(meta.opId);
            if (mark) write(moveColorTarget(operands, mark, [item.x0, item.y0]));
        },
        onDelete: key => {
            const mark = markOf(key);
            if (mark) write(deleteColorTarget(operands, mark));
        },
    };
}
