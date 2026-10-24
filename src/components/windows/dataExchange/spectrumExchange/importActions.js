import { measuredCurveId } from '../../../../utils/io/spectrumTable.js';
import { useCurveEdits } from './curveEdits.js';
import { jcampCurves, readSpectrumText, tableConditions, tableCurves } from './importedCurves.js';

const { useCallback, useMemo } = React;

function useImportFile(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, setLoading, clearStatus,
        setParsed, setFileName, setColIdx, setOv, setXUnit, setSelectedCurveId,
        setAoi, setPol,
        aoi, pol,
    } = options;
    return useCallback(async () => {
        setLoading(true); clearStatus();
        try {
            const result = await window.electronAPI.spectrumPickFile();
            if (!result?.success) {
                if (!result?.canceled) flash('error', sx.errLoad(result?.error || ''));
                setLoading(false);
                return;
            }
            const read = readSpectrumText(result.text);
            if (read.error) {
                flash('error', sx.errParse);
                setLoading(false);
                return;
            }
            if (read.jcamp) {
                checkpoint();
                const added = jcampCurves(read.jcamp, result.fileName, { aoi, pol });
                updateDesign({ measuredCurves: [...(design.measuredCurves || []), ...added] });
                setParsed(null); setOv({});
                setFileName(result.fileName || 'spectrum');
                setSelectedCurveId?.(added[0]?.id || null);
                flash('success', sx.loadedJcamp(result.fileName || '', added.length));
                setLoading(false);
                return;
            }
            const nextParsed = read.table;
            const stated = tableConditions(nextParsed);
            setParsed(nextParsed); setFileName(result.fileName || 'spectrum');
            setColIdx(0); setOv({}); setXUnit(stated.xUnit);
            if (stated.aoi !== undefined) setAoi?.(stated.aoi);
            if (stated.pol !== undefined) setPol?.(stated.pol);
            const loadedMessage = sx.loaded(result.fileName || '', nextParsed.nRows, nextParsed.columns.length);
            // Rows of the file were dropped: a warning, so the report stays up.
            if (nextParsed.skippedRows > 0) flash('warning', `${loadedMessage}. ${sx.skippedRows(nextParsed.skippedRows)}`);
            else flash('success', loadedMessage);
        } catch (err) {
            flash('error', sx.errLoad(err.message));
        }
        setLoading(false);
    }, [sx, design, updateDesign, checkpoint, aoi, pol]);
}

export function useImportActions(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, parsed, col, name, quantity, yscale, xUnit,
        fileName, colIdx, ov = {}, aoi = 0, pol = 'avg',
    } = options;
    const onImport = useImportFile(options);
    const selectedIndex = Number.isInteger(colIdx)
        ? colIdx
        : Math.max(0, parsed?.columns?.indexOf(col) ?? 0);

    const previewCurves = useMemo(() => {
        if (!parsed) return [];
        const overrides = parsed.columns.map((_column, index) => ({
            ...(index === selectedIndex ? { name, quantity, yscale } : {}), ...(ov[index] || {}),
        }));
        return tableCurves(parsed, { fileName, xUnit, aoi, pol, overrides });
    }, [parsed, selectedIndex, name, quantity, yscale, xUnit, fileName, ov, aoi, pol]);
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
