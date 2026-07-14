import { parseJcampDx } from '../../../../utils/io/jcampDx.js';
import { makeMeasuredCurve, parseSpectrumTable, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { isJcampText } from './model.js';

const { useCallback, useMemo } = React;

function importedJcampCurves(jcamp, result) {
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
    }));
}

function useImportFile(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, setLoading, setStatus,
        setParsed, setFileName, setColIdx, setOv, setXUnit, setName,
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
                const added = importedJcampCurves(jcamp, result);
                updateDesign({ measuredCurves: [...(design.measuredCurves || []), ...added] });
                setFileName(result.fileName || 'spectrum');
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
            const base = (result.fileName || 'spectrum').replace(/\.[^.]+$/, '');
            setName(base);
            flash('success', sx.loaded(result.fileName || '', nextParsed.nRows, nextParsed.columns.length));
        } catch (err) {
            flash('error', sx.errLoad(err.message));
        }
        setLoading(false);
    }, [sx, design, updateDesign, checkpoint]);
}

export function useImportActions(options) {
    const {
        sx, design, updateDesign, checkpoint, flash, parsed, col, name, xUnit,
        quantity, yscale, fileName,
    } = options;
    const onImport = useImportFile(options);

    const previewCurve = useMemo(() => {
        if (!parsed || !col) return null;
        return makeMeasuredCurve({
            name: name || col.name, x: parsed.x, xUnit,
            y: col.values, quantity,
            isPercent: yscale === 'percent',
            isAbsorbance: yscale === 'absorbance',
            source: fileName,
        });
    }, [parsed, col, name, xUnit, quantity, yscale, fileName]);

    const onAdd = useCallback(() => {
        if (!previewCurve || !previewCurve.x.length) return;
        checkpoint();
        const existing = design.measuredCurves || [];
        updateDesign({ measuredCurves: [...existing, previewCurve] });
        flash('success', sx.added(previewCurve.name));
    }, [previewCurve, design, updateDesign, checkpoint, sx]);

    const removeCurve = useCallback((id) => {
        checkpoint();
        updateDesign({ measuredCurves: (design.measuredCurves || []).filter((curve) => curve.id !== id) });
    }, [design, updateDesign, checkpoint]);

    const toggleCurve = useCallback((id) => {
        updateDesign({
            measuredCurves: (design.measuredCurves || []).map((curve) => (
                curve.id === id ? { ...curve, visible: curve.visible === false } : curve
            )),
        });
    }, [design, updateDesign]);

    return { onImport, previewCurve, onAdd, removeCurve, toggleCurve };
}
