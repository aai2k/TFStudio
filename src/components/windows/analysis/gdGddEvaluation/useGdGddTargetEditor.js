import { useWindowSession } from '../../windowSession.js';
import { gdGddTargetSession } from './sessionState.js';
import {
    createGdGddTarget, deleteGdGddTarget, editGdGddTarget, gdGddEditBlocker, levelSnapStep,
    meritTargetSide,
} from './gdTargets.js';

/**
 * Drawing on the plot writes to the design's merit operands, so the Merit
 * Function Editor shows the same rows and each gesture is one undo step. The
 * operand a drawing becomes is fixed by what the window shows: quantity,
 * response, polarization and angle are the plot's own settings, so there is
 * nothing to choose in the editor.
 */
export function useGdGddTargetEditor({ design, updateDesign, state, yRange }) {
    const [session, setField] = useWindowSession(gdGddTargetSession, design);
    const { editTool, snapOn, snapNm } = session;
    const options = {
        quantity: state.quantity, target: state.target, polarization: state.pol,
        thetaDeg: state.theta, side: state.side, surfaceMode: design?.surfaceMode,
    };
    const editBlocker = gdGddEditBlocker(options);
    const levelStep = levelSnapStep(yRange);
    const edit = {
        operands: design?.meritOperands || [], targets: state.targets, snapOn, snapNm, levelStep,
    };
    return {
        editBlocker,
        editMode: session.editMode && !editBlocker,
        setEditMode: value => setField('editMode', value),
        meritSide: meritTargetSide(design?.surfaceMode),
        editTool, setEditTool: value => setField('editTool', value),
        snapOn, setSnapOn: value => setField('snapOn', value),
        snapNm, setSnapNm: value => setField('snapNm', value),
        levelStep,
        onCreate: line => updateDesign({
            meritOperands: createGdGddTarget({ ...edit, line, options }),
        }),
        onEdit: (meta, coords) => updateDesign({
            meritOperands: editGdGddTarget({ ...edit, meta, coords }),
        }),
        onDelete: opId => updateDesign({ meritOperands: deleteGdGddTarget(edit.operands, opId) }),
    };
}
