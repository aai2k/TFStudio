import { parseJcampDx } from '../../../../utils/io/jcampDx.js';
import {
    makeMeasuredCurve, measuredCurveId, parseSpectrumTable, X_UNITS,
} from '../../../../utils/io/spectrumTable.js';
import { useCurveEdits } from './curveEdits.js';
import { isJcampText } from './model.js';

const { useCallback, useMemo } = React;

function importedJcampCurves(jcamp, result, conditions) {
    const baseName = (result.fileName || 'spectrum').replace(/\.[^.]+$/, '');
    return jcamp.spectra.map((spectrum, index) => makeMeasuredCurve({
        name: spectrum.title && spectrum.title !== 'JCAMP-DX'
            ? spectrum.title
            : `${baseName}${jcamp.spectra.length > 1 ? ' ' + (index + 1) : ''}`,
        x: spectrum.x,
        xUnit: spectrum.xUnit,
        y: spectrum.y,
        quantity: spectrum.quantity || 'T',
        isPercent: spectrum.isPercent,
        isAbsorbance: spectrum.isAbsorbance,
        source: result.fileName,
        ...conditions,
    }));
}

function useImportFile(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, setLoading, setStatus,
        setParsed, setFileName, setColIdx, setOv, setXUnit, setSelectedCurveId, setAoi,
        aoi, pol, side,
    } = options;
    return useCallback(async () => {
        setLoading(true); setStatus(null);
        try {
            const result = await window.electronAPI.spectrumPickFile();
            if (!result?.success) {
                if (!result?.canceled) flash('error', sx.errLoad(result?.error || ''));
                setLoading(false);
                return;
            }
            if (isJcampText(result.text)) {
                const jcamp = parseJcampDx(result.text);
                if (!jcamp.ok) {
                    flash('error', sx.errParse);
                    setLoading(false);
                    return;
                }
                checkpoint();
                const added = importedJcampCurves(jcamp, result, { aoi, pol, side });
                updateDesign({ measuredCurves: [...(design.measuredCurves || []), ...added] });
                setParsed(null); setOv({});
                setFileName(result.fileName || 'spectrum');
                setSelectedCurveId?.(added[0]?.id || null);
                flash('success', sx.loadedJcamp(result.fileName || '', added.length));
                setLoading(false);
                return;
            }
            const nextParsed = parseSpectrumTable(result.text);
            if (!nextParsed.ok) {
                flash('error', sx.errParse);
                setLoading(false);
                return;
            }
            setParsed(nextParsed); setFileName(result.fileName || 'spectrum');
            setColIdx(0); setOv({}); setXUnit(nextParsed.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : nextParsed.xUnit);
            const detectedAoi = nextParsed.aoi ?? nextParsed.columns.find(column => Number.isFinite(column.aoi))?.aoi;
            if (Number.isFinite(detectedAoi)) setAoi?.(detectedAoi);
            const loadedMessage = sx.loaded(result.fileName || '', nextParsed.nRows, nextParsed.columns.length);
            flash('success', nextParsed.skippedRows > 0
                ? `${loadedMessage}. ${sx.skippedRows(nextParsed.skippedRows)}`
                : loadedMessage);
        } catch (err) {
            flash('error', sx.errLoad(err.message));
        }
        setLoading(false);
    }, [sx, design, updateDesign, checkpoint, aoi, pol, side]);
}

function columnScale(column, override) {
    return override.yscale || (column.isAbsorbance ? 'absorbance' : (column.isPercent ? 'percent' : 'fraction'));
}

function defaultCurveName(fileName, parsed, column) {
    const base = (fileName || 'spectrum').replace(/\.[^.]+$/, '');
    return parsed.columns.length > 1 ? `${base}: ${column.name}` : base;
}

export function useImportActions(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, parsed, col, name, quantity, yscale, xUnit,
        fileName, colIdx, ov = {}, aoi = 0, pol = 'avg', side = 'front',
    } = options;
    const onImport = useImportFile(options);
    const selectedIndex = Number.isInteger(colIdx)
        ? colIdx
        : Math.max(0, parsed?.columns?.indexOf(col) ?? 0);

    const previewCurves = useMemo(() => {
        if (!parsed) return [];
        return parsed.columns.map((column, index) => {
            const selectedFallback = index === selectedIndex ? { name, quantity, yscale } : {};
            const override = { ...selectedFallback, ...(ov[index] || {}) };
            const resolvedScale = columnScale(column, override);
            return makeMeasuredCurve({
                name: override.name || defaultCurveName(fileName, parsed, column),
                x: column.x || parsed.x,
                xUnit,
                y: column.values,
                quantity: override.quantity || column.quantity || 'T',
                isPercent: resolvedScale === 'percent',
                isAbsorbance: resolvedScale === 'absorbance',
                source: fileName,
                aoi: Number.isFinite(column.aoi) ? column.aoi : aoi,
                pol,
                side,
            });
        });
    }, [parsed, selectedIndex, name, quantity, yscale, xUnit, fileName, ov, aoi, pol, side]);
    const previewCurve = previewCurves[selectedIndex] || null;

    const addCurves = useCallback((candidates) => {
        // The preview curves are memoized, so the same objects come back until an
        // import setting changes. Adding one twice, or adding a column and then
        // adding all of them, would otherwise put the same id on the design more
        // than once, and two curves sharing an id cannot be toggled or removed
        // apart.
        const added = candidates
            .filter(curve => curve?.x.length)
            .map(curve => ({ ...curve, id: measuredCurveId() }));
        if (!added.length) return;
        checkpoint();
        const existing = design.measuredCurves || [];
        updateDesign({ measuredCurves: [...existing, ...added] });
        options.setSelectedCurveId?.(added[0].id);
        flash('success', added.length === 1 ? sx.added(added[0].name) : sx.addedCurves(added.length));
    }, [design, updateDesign, checkpoint, sx, options.setSelectedCurveId]);

    // A multi-column file rarely holds only spectra: an Avantes export carries
    // raw counts beside the reflectance, so the configured column has to be
    // addable on its own.
    const onAddSelected = useCallback(
        () => addCurves([previewCurves[selectedIndex]]),
        [addCurves, previewCurves, selectedIndex],
    );
    const onAdd = useCallback(() => addCurves(previewCurves), [addCurves, previewCurves]);
    const curveEdits = useCurveEdits({ design, updateDesign, checkpoint });

    return {
        onImport, previewCurve, previewCurves, onAdd, onAddSelected, ...curveEdits,
    };
}
