/**
 * The frame of the CIELAB and CIELUV planes while targets are edited on them.
 *
 * Those planes are framed to what they show, the coating's points and the
 * targets (chartFigure.js diagramView), so a target dropped near the edge, or
 * one deleted at the edge, would resize the plane under the pointer and the
 * diamond would land somewhere else on screen. While editing, the frame
 * holds still: it holds the targets where they stood when editing began, and
 * takes in a target only once it lies past the plot, where only a value typed
 * in the Merit Function Editor puts it. A click, a drag or a delete on
 * the diagram never moves it. The coating's points are always taken in, so a
 * coating that moves past the edge widens it. The two chromaticity diagrams
 * have a fixed frame, which this leaves as it is.
 */
import { LIGHTNESS_DIAGRAMS } from '../../../../utils/physics/colorimetry.js';
import { diagramView, reportsPlane } from './chartFigure.js';

const { useState } = React;

// Whether `point` lies on the plot of the frame `view`. The hue and chroma
// planes draw a disc inside it, and a target in a corner past the disc is
// still on the plot, where a click or a drag can put it; past the plot only a
// typed value can.
const inFrame = (view, [p, q]) => p >= view.x[0] && p <= view.x[1] && q >= view.y[0] && q <= view.y[1];

/**
 * The points the held frame of `diagram` is sized to besides the coating's:
 * `held`, and those of the target points `targets` that lie past the plot of
 * the frame `held` and the coating's points make. `held` itself when none
 * does, and on the chromaticity diagrams, whose frame no point moves.
 */
export function heldViewPoints({ reports, diagram, held, targets }) {
    if (!LIGHTNESS_DIAGRAMS.includes(diagram)) return held;
    const plane = reportsPlane(reports, diagram);
    const view = diagramView(diagram, [...reports.map(({ report }) => plane.ofReport(report)), ...held]);
    const outside = targets.filter(point => !inFrame(view, point));
    return outside.length ? [...held, ...outside] : held;
}

/**
 * The held frame after one more look at the window, `{ key, points }`, or null
 * while editing is off. `key` names what the targets shown depend on, the
 * design, the diagram and the window's settings; a new key starts the frame
 * again on the targets as they are. With no coating to frame, as while the colour is being
 * computed, the frame is kept as it was.
 */
export function nextHeldFrame(held, { editMode, key, reports, diagram, points }) {
    if (!editMode) return null;
    if (!reports?.length) return held;
    if (held?.key !== key) return { key, points };
    const kept = heldViewPoints({ reports, diagram, held: held.points, targets: points });
    return kept === held.points ? held : { key, points: kept };
}

/**
 * The points buildChromaticityOption sizes the frame to besides the coating
 * (its `viewPoints`) while editing holds the frame, or undefined while it does
 * not, for the frame to fit the targets as they are. `args` as nextHeldFrame
 * takes them.
 */
export function useHeldFrame(args) {
    const [held, setHeld] = useState(null);
    const next = nextHeldFrame(held, args);
    if (next !== held) setHeld(next);
    return next?.points;
}
