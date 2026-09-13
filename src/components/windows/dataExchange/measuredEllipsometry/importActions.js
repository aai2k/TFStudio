/**
 * Reading an ellipsometer file into the window, and turning its columns into
 * curves on the design.
 */
import {
    makeMeasuredCurve, measuredCurveId, parseSpectrumTable, withUniqueCurveIds, X_UNITS,
} from '../../../../utils/io/spectrumTable.js';
import { ellipsometryCurves, typeColumns } from './model.js';

const { useCallback, useMemo } = React;

export function defaultCurveName(fileName, parsed, column) {
    const base = (fileName || 'ellipsometry').replace(/\.[^.]+$/, '');
    return parsed.columns.length > 1 ? `${base}: ${column.name}` : base;
}

// Opening a file and putting what it says into the session: its columns, its
// wavelength unit, and the conditions its header states.
function useImportFile({ flash, mx, setField, setLoading, setStatus }) {
    return useCallback(async () => {
        setLoading(true);
        setStatus(null);
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
            setField('parsed', next);
            setField('fileName', result.fileName || 'ellipsometry');
            setField('colIdx', 0);
            setField('selectedCurveId', null);
            setField('ov', {});
            setField('xUnit', next.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : next.xUnit);
            const detectedAoi = next.aoi
                ?? next.columns.find(col => Number.isFinite(col.aoi))?.aoi;
            if (Number.isFinite(detectedAoi)) setField('aoi', detectedAoi);
            // The calculated Psi/Delta export names the side it was taken from.
            if (next.side) setField('side', next.side);
            flash(Number.isFinite(detectedAoi) ? 'success' : 'warning',
                Number.isFinite(detectedAoi)
                    ? mx.loaded(result.fileName || '', next.nRows, detectedAoi)
                    : mx.loadedNoAoi(result.fileName || '', next.nRows));
        } catch (err) {
            flash('error', mx.errLoad(err.message));
        }
        setLoading(false);
    }, [flash, mx, setField, setLoading, setStatus]);
}

export function useImportActions(options) {
    const { design, updateDesign, checkpoint, flash, mx, setField, session } = options;
    const { parsed, fileName, colIdx, xUnit, aoi, side, deltaConvention, ov = {} } = session;

    // What the file says its columns are, before any operator override.
    const detected = useMemo(() => typeColumns(parsed?.columns || []), [parsed]);
    const columnQuantity = useCallback(
        (index) => (ov[index] || {}).quantity || detected[index] || null,
        [ov, detected]);

    // Every column of the parsed file as it would be added, so the preview and
    // the two add buttons agree about what is on offer.
    const previewCurves = useMemo(() => (parsed ? parsed.columns : []).map((col, index) => {
        const forColumn = ov[index] || {};
        return makeMeasuredCurve({
            name: forColumn.name || defaultCurveName(fileName, parsed, col),
            x: col.x || parsed.x,
            xUnit,
            y: col.values,
            quantity: columnQuantity(index) || 'PSI',
            aoi: Number.isFinite(col.aoi) ? col.aoi : aoi,
            pol: 'avg',
            side,
            deltaConvention,
            source: fileName,
        });
    }), [parsed, fileName, xUnit, aoi, side, deltaConvention, ov, columnQuantity]);

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
