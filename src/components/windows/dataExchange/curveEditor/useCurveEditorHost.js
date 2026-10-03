/**
 * The curve editor as Measured Spectra and Measured Ellipsometry open it: for a
 * new curve, or for one already in the design's list, and what Apply does to
 * the design.
 *
 * A new table adds a curve per value column to the list. An edited curve keeps
 * its place, id and conditions and takes the new points; when merit blocks
 * were built from it and the rebuild is left on, they are rebuilt from it in
 * the same step, so one undo takes back both.
 */
import { curvesFromTable, editedCurve } from './curveApply.js';
import { emptyTable, tableFromCurve } from './curveTable.js';
import { NEW_CURVE_CONDITIONS } from './designBackdrop.js';
import { curveBlocks, rebuiltMeritOperands } from './meritRebuild.js';

const { useState } = React;

function conditionsOf(curve) {
    return { aoi: curve.aoi ?? 0, pol: curve.pol || 'avg', side: curve.side, deltaConvention: curve.deltaConvention };
}

function applyNew(host, table) {
    const { listKey, design, updateDesign, checkpoint, flash, onAdded, ce } = host;
    const added = curvesFromTable(table);
    if (!added.length) return;
    checkpoint();
    updateDesign({ [listKey]: [...(design[listKey] || []), ...added] });
    onAdded?.(added);
    flash('success', ce.added(added.length));
}

function applyEdit(host, curve, table, rebuild) {
    const { kind, listKey, design, updateDesign, checkpoint, flash, ce } = host;
    const updated = editedCurve(curve, table);
    const patch = { [listKey]: (design[listKey] || []).map(item => (item.id === curve.id ? updated : item)) };
    const blocks = rebuild ? curveBlocks(design, curve.id).length : 0;
    const result = blocks ? rebuiltMeritOperands({ ...design, ...patch }, updated, kind) : null;
    if (result) patch.meritOperands = result.meritOperands;
    checkpoint();
    updateDesign(patch);
    const messages = [ce.updated(updated.name), result?.rebuilt && ce.rebuilt(result.rebuilt)].filter(Boolean);
    if (result?.kept) flash('warning', [...messages, ce.notRebuilt(result.kept)].join(' '));
    else flash('success', messages.join(' '));
}

/**
 * @param {object} host
 *   kind       'spectrum' | 'ellipsometry'
 *   listKey    the design's list: 'measuredCurves' or 'measuredEllipsometry'
 *   design, updateDesign, checkpoint   from the design context
 *   flash(type, message)               the window's status line
 *   onAdded(curves)                    new curves are on the design
 *   ce                                 t.curveEditor
 * @returns {{ openNew, openEdit, editorProps }} `editorProps` is null while
 *   the editor is closed, and otherwise what CurveEditor takes, less c and t.
 */
export function useCurveEditorHost(host) {
    const [opened, setOpened] = useState(null);
    const curves = host.design?.[host.listKey] || [];
    const curve = opened?.curveId ? curves.find(item => item.id === opened.curveId) || null : null;
    const close = () => setOpened(null);
    const editorProps = opened && {
        title: curve ? host.ce.titleEdit(curve.name) : host.ce.titleNew,
        table: curve ? tableFromCurve(curve, host.kind) : emptyTable(host.kind),
        conditions: curve ? conditionsOf(curve) : NEW_CURVE_CONDITIONS,
        design: host.design,
        blockCount: curve ? curveBlocks(host.design, curve.id).length : 0,
        onApply: (table, { rebuild }) => {
            if (curve) applyEdit(host, curve, table, rebuild);
            else applyNew(host, table);
            close();
        },
        onCancel: close,
    };
    return {
        openNew: () => setOpened({ curveId: null }),
        openEdit: item => setOpened({ curveId: item.id }),
        editorProps,
    };
}
