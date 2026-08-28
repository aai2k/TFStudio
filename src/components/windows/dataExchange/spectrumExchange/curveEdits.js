/**
 * Editing a measured curve that is already on the design: visibility, name,
 * colour, quantity, source scale, wavelength trim, and removal.
 *
 * Separate from the import actions because these act on stored curves rather
 * than on the file being configured, and because a curve stays editable long
 * after the file it came from has been forgotten.
 */

const { useCallback } = React;

/**
 * Y is stored as a fraction whatever the file held, so correcting the declared
 * source scale rescales the values. Returns an empty patch when the scale is
 * already the one asked for.
 */
export function scalePatch(curve, scale) {
    const nextPercent = scale === 'percent';
    if (!!curve.yWasPercent === nextPercent) return {};
    return {
        y: (curve.y || []).map(value => value * (nextPercent ? 0.01 : 100)),
        yWasPercent: nextPercent,
    };
}

/**
 * Move one trim bound. The trim is non-destructive: it never drops a point, it
 * stays inside the measured range, and neither bound may cross the other.
 */
export function trimPatch(curve, edge, value) {
    const xs = curve.x || [];
    if (!xs.length) return {};
    const fullMin = xs[0];
    const fullMax = xs[xs.length - 1];
    if (edge === 'min') {
        const max = Number.isFinite(curve.trimMax) ? curve.trimMax : fullMax;
        return { trimMin: Math.min(Math.max(value, fullMin), max) };
    }
    const min = Number.isFinite(curve.trimMin) ? curve.trimMin : fullMin;
    return { trimMax: Math.max(Math.min(value, fullMax), min) };
}

export function useCurveEdits({ design, updateDesign, checkpoint }) {
    const curves = design.measuredCurves || [];

    const removeCurve = useCallback((id) => {
        checkpoint();
        updateDesign({ measuredCurves: curves.filter(curve => curve.id !== id) });
    }, [curves, updateDesign, checkpoint]);

    // Visibility is a view state, not an edit, so it takes no undo checkpoint.
    const toggleCurve = useCallback((id) => {
        updateDesign({
            measuredCurves: curves.map(curve => (
                curve.id === id ? { ...curve, visible: curve.visible === false } : curve
            )),
        });
    }, [curves, updateDesign]);

    const updateCurve = useCallback((id, patch) => {
        checkpoint();
        updateDesign({
            measuredCurves: curves.map((curve) => {
                if (curve.id !== id) return curve;
                return { ...curve, ...(typeof patch === 'function' ? patch(curve) : patch) };
            }),
        });
    }, [curves, updateDesign, checkpoint]);

    const setCurveScale = useCallback(
        (id, scale) => updateCurve(id, curve => scalePatch(curve, scale)),
        [updateCurve],
    );
    const setCurveTrim = useCallback(
        (id, edge, value) => updateCurve(id, curve => trimPatch(curve, edge, value)),
        [updateCurve],
    );

    return { removeCurve, toggleCurve, updateCurve, setCurveScale, setCurveTrim };
}
