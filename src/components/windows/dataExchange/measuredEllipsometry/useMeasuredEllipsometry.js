import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import {
    makeMeasuredCurve, measuredCurveId, parseSpectrumTable, withUniqueCurveIds, X_UNITS,
} from '../../../../utils/io/spectrumTable.js';
import {
    calculatedDocument, chartData, ellipsometryCurves, looksLikeCosDelta, measuredDocument,
    typeColumns,
} from './model.js';
import { measuredEllipsometrySession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useCallback, useMemo, useState } = React;

function defaultCurveName(fileName, parsed, column) {
    const base = (fileName || 'ellipsometry').replace(/\.[^.]+$/, '');
    return parsed.columns.length > 1 ? `${base}: ${column.name}` : base;
}

export function useMeasuredEllipsometry(mx) {
    const { design, updateDesign, checkpoint } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useWindowSession(measuredEllipsometrySession, design);
    const {
        tab, parsed, fileName, colIdx, selectedCurveId, xUnit, aoi, side, deltaConvention,
        expSource, expXUnit, expSelected = {}, expStart, expEnd, expStep, expAoi, ov = {},
    } = session;
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(false);

    const flash = useCallback((type, msg) => {
        setStatus({ type, msg });
        setTimeout(() => setStatus(null), 4000);
    }, []);

    const curves = ellipsometryCurves(design);
    const selectedCurve = curves.find(curve => curve.id === selectedCurveId) || null;

    // What the file says its columns are, before any operator override.
    const detected = useMemo(() => typeColumns(parsed?.columns || []), [parsed]);
    const columnQuantity = useCallback(
        (index) => (ov[index] || {}).quantity || detected[index] || null,
        [ov, detected]);

    const column = parsed?.columns?.[colIdx] || null;
    const override = ov[colIdx] || {};
    const quantity = columnQuantity(colIdx);

    // Every column of the parsed file as it would be added, so the preview and
    // the two add buttons agree about what is on offer.
    const previewCurves = useMemo(() => {
        if (!parsed) return [];
        return parsed.columns.map((col, index) => {
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
        });
    }, [parsed, fileName, xUnit, aoi, side, deltaConvention, ov, columnQuantity]);
    const previewColumn = previewCurves[colIdx] || null;

    const addCurves = useCallback((candidates) => {
        const added = withUniqueCurveIds(
            (candidates || []).filter(curve => curve?.x.length)
                .map(curve => ({ ...curve, id: measuredCurveId() })));
        if (!added.length) return;
        checkpoint();
        updateDesign({ measuredEllipsometry: [...ellipsometryCurves(design), ...added] });
        setField('selectedCurveId', added[0].id);
        flash('success', added.length === 1 ? mx.added(added[0].name) : mx.addedCurves(added.length));
    }, [design, updateDesign, checkpoint, flash, mx]);

    const onImport = useCallback(async () => {
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
            flash(Number.isFinite(detectedAoi) ? 'success' : 'warning',
                Number.isFinite(detectedAoi)
                    ? mx.loaded(result.fileName || '', next.nRows, detectedAoi)
                    : mx.loadedNoAoi(result.fileName || '', next.nRows));
        } catch (err) {
            flash('error', mx.errLoad(err.message));
        }
        setLoading(false);
    }, [flash, mx, setField]);

    const updateCurve = useCallback((id, patch) => {
        checkpoint();
        updateDesign({
            measuredEllipsometry: ellipsometryCurves(design)
                .map(curve => (curve.id === id ? { ...curve, ...patch } : curve)),
        });
    }, [design, updateDesign, checkpoint]);

    const removeCurve = useCallback((id) => {
        checkpoint();
        updateDesign({
            measuredEllipsometry: ellipsometryCurves(design).filter(curve => curve.id !== id),
        });
    }, [design, updateDesign, checkpoint]);

    const save = useCallback(async (document) => {
        if (!document.text) {
            flash('info', mx.nothingToExport);
            return;
        }
        try {
            const result = await window.electronAPI.spectrumSaveFile(document.text, document.fileName);
            if (result?.success) flash('success', mx.exported(result.filePath));
            else if (!result?.canceled) flash('error', mx.errExport(result?.error || ''));
        } catch (err) {
            flash('error', mx.errExport(err.message));
        }
    }, [flash, mx]);

    const onExportMeasured = useCallback(() => {
        const chosen = curves.filter(curve => expSelected[curve.id] !== false);
        return save(measuredDocument(design, { curves: chosen, xUnit: expXUnit }));
    }, [curves, expSelected, design, expXUnit, save]);

    const onExportCalculated = useCallback(() => {
        if (missingMaterialIds.length) {
            flash('error', mx.errMaterials(missingMaterialIds.join(', ')));
            return Promise.resolve();
        }
        return save(calculatedDocument(design, {
            lambdaStart: Number(expStart), lambdaEnd: Number(expEnd), lambdaStep: Number(expStep),
            thetaDeg: Number(expAoi), side, deltaConvention, xUnit: expXUnit,
        }));
    }, [design, expStart, expEnd, expStep, expAoi, side, deltaConvention, expXUnit,
        missingMaterialIds, flash, mx, save]);

    // The preview follows the file being configured until a curve on the design
    // is picked, so the panel the operator is looking at is the one drawn.
    const preview = useMemo(
        () => chartData(selectedCurve ? [selectedCurve] : previewColumn ? [previewColumn] : []),
        [selectedCurve, previewColumn]);

    const cosDeltaCurve = curves.find(looksLikeCosDelta) || null;

    return {
        design, curves, selectedCurve, missingMaterialIds,
        tab, setTab: value => setField('tab', value),
        parsed, fileName, colIdx,
        // Configuring a column puts the preview back on the file, the way
        // Measured Spectra does: otherwise the plot keeps drawing whichever
        // imported curve was last clicked and the column controls look dead.
        setColIdx: (value) => { setField('colIdx', value); setField('selectedCurveId', null); },
        xUnit, setXUnit: value => setField('xUnit', value),
        aoi, setAoi: value => setField('aoi', value),
        side, setSide: value => setField('side', value),
        deltaConvention, setDeltaConvention: value => setField('deltaConvention', value),
        quantity, name: override.name || (column ? defaultCurveName(fileName, parsed, column) : ''),
        setName: value => setField('ov', { ...ov, [colIdx]: { ...override, name: value } }),
        setColQuantity: (value) => {
            setField('ov', { ...ov, [colIdx]: { ...override, quantity: value } });
            setField('selectedCurveId', null);
        },
        setSelectedCurveId: value => setField('selectedCurveId', value),
        previewCurves, previewColumn, preview,
        onImport, loading, status, cosDeltaCurve,
        onAddSelected: () => addCurves([previewColumn]),
        onAddAll: () => addCurves(previewCurves.filter((_, index) => !!columnQuantity(index))),
        updateCurve, removeCurve,
        expSource, setExpSource: value => setField('expSource', value),
        expXUnit, setExpXUnit: value => setField('expXUnit', value),
        expSelected, setExpSelected: (id, on) => setField('expSelected', { ...expSelected, [id]: on }),
        expStart, setExpStart: value => setField('expStart', value),
        expEnd, setExpEnd: value => setField('expEnd', value),
        expStep, setExpStep: value => setField('expStep', value),
        expAoi, setExpAoi: value => setField('expAoi', value),
        onExportMeasured, onExportCalculated,
    };
}
