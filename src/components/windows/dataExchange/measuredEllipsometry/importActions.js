/**
 * Reading an ellipsometer file into the window, and turning its columns into
 * curves on the design.
 */
import { measuredCurveId, parseSpectrumTable, withUniqueCurveIds } from '../../../../utils/io/spectrumTable.js';
import { ellipsometryCurves } from './model.js';
import { columnQuantities, ellipsometryColumnCurves, ellipsometryFileConditions } from './importedCurves.js';

const { useCallback, useMemo } = React;

// Opening a file and putting what it says into the session: its columns, its
// wavelength unit, and the conditions its header states.
function useImportFile({ flash, mx, setField, setLoading, clearStatus }) {
    return useCallback(async () => {
        setLoading(true);
        clearStatus();
        try {
            const result = await window.electronAPI.spectrumPickFile();
            if (!result?.success) {
                if (!result?.canceled) flash('error', mx.errLoad(result?.error || ''));
                setLoading(false);
                return;
            }
            const next = parseSpectrumTable(result.text);
            if (!next.ok) {
                flash('error', mx.errParse);
                setLoading(false);
                return;
            }
            const stated = ellipsometryFileConditions(next);
            setField('parsed', next);
            setField('fileName', result.fileName || 'ellipsometry');
            setField('colIdx', 0);
            setField('selectedCurveId', null);
            setField('ov', {});
            setField('xUnit', stated.xUnit);
            if (stated.aoi !== undefined) setField('aoi', stated.aoi);
            // The calculated Psi/Delta export names the side it was taken from.
            if (stated.side) setField('side', stated.side);
            flash(stated.aoi !== undefined ? 'success' : 'warning',
                stated.aoi !== undefined
                    ? mx.loaded(result.fileName || '', next.nRows, stated.aoi)
                    : mx.loadedNoAoi(result.fileName || '', next.nRows));
        } catch (err) {
            flash('error', mx.errLoad(err.message));
        }
        setLoading(false);
    }, [flash, mx, setField, setLoading, clearStatus]);
}

export function useImportActions(options) {
    const { design, updateDesign, checkpoint, flash, mx, setField, session } = options;
    const { parsed, fileName, colIdx, xUnit, aoi, side, deltaConvention, ov = {} } = session;

    // Each column's type, the operator's override first.
    const quantities = useMemo(() => (parsed ? columnQuantities(parsed, ov) : []), [parsed, ov]);
    const columnQuantity = useCallback(index => quantities[index] || null, [quantities]);

    // Every column of the parsed file as it would be added, so the preview and
    // the two add buttons agree about what is on offer.
    const previewCurves = useMemo(() => (parsed
        ? ellipsometryColumnCurves(parsed, { fileName, xUnit, aoi, side, deltaConvention, ov })
        : []), [parsed, fileName, xUnit, aoi, side, deltaConvention, ov]);

    const addCurves = useCallback((candidates) => {
        const added = withUniqueCurveIds(
            (candidates || []).filter(curve => curve?.x.length)
                .map(curve => ({ ...curve, id: measuredCurveId() })));
        if (!added.length) return;
        checkpoint();
        updateDesign({ measuredEllipsometry: [...ellipsometryCurves(design), ...added] });
        setField('selectedCurveId', added[0].id);
        flash('success', added.length === 1 ? mx.added(added[0].name) : mx.addedCurves(added.length));
    }, [design, updateDesign, checkpoint, flash, mx, setField]);

    const onImport = useImportFile(options);

    return {
        columnQuantity, previewCurves, previewColumn: previewCurves[colIdx] || null, addCurves, onImport,
    };
}
