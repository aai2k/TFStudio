import { useDesign } from '../../../../state/DesignContext.js';
import { X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { useDesignExport, useMeasuredExport } from './exportActions.js';
import { useImportActions } from './importActions.js';
import { useSession } from './session.js';

const { useState } = React;

export function useSpectrumExchange(sx) {
    const { design, updateDesign, checkpoint, evalParams, evalMode } = useDesign();
    const [tab, setTab] = useSession('tab');
    const [expSource, setExpSource] = useSession('expSource');
    const [expFormat, setExpFormat] = useSession('expFormat');
    const [parsed, setParsed] = useSession('parsed');
    const [fileName, setFileName] = useSession('fileName');
    const [colIdx, setColIdx] = useSession('colIdx');
    const [name, setName] = useSession('name');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
    const [xUnit, setXUnit] = useState(X_UNITS.NM);
    const [ov, setOv] = useState({});
    const flash = (type, msg) => setStatus({ type, msg });
    const curves = design.measuredCurves || [];
    const col = parsed?.columns?.[colIdx] || null;
    const colOv = ov[colIdx] || {};
    const quantity = colOv.quantity || col?.quantity || 'T';
    const yscale = colOv.yscale || (col?.isAbsorbance ? 'absorbance' : (col?.isPercent ? 'percent' : 'fraction'));
    const setColOv = (patch) => setOv((previous) => ({
        ...previous,
        [colIdx]: { ...previous[colIdx], ...patch },
    }));

    const importActions = useImportActions({
        sx, design, updateDesign, checkpoint, flash, parsed, col, name, xUnit,
        quantity, yscale, fileName, setLoading, setStatus, setParsed, setFileName,
        setColIdx, setOv, setXUnit, setName,
    });
    const onExport = useMeasuredExport({ design, expFormat, flash, sx });
    const [dStart, setDStart] = useState(evalParams?.lambdaStart ?? 400);
    const [dEnd, setDEnd] = useState(evalParams?.lambdaEnd ?? 800);
    const [dStep, setDStep] = useState(evalParams?.lambdaStep ?? 2);
    const [dAoi, setDAoi] = useState((evalParams?.thetas?.length ? evalParams.thetas : [0]).join(', '));
    const [dQ, setDQ] = useState({ T: true, R: true, A: true });
    const [dSP, setDSP] = useState(false);
    const onExportDesign = useDesignExport({
        design, evalMode, dStart, dEnd, dStep, dAoi, dQ, dSP, expFormat, flash, sx,
    });

    return {
        tab, setTab, expSource, setExpSource, expFormat, setExpFormat,
        parsed, fileName, colIdx, setColIdx, name, setName, loading, status,
        xUnit, setXUnit, quantity, yscale, setColOv, curves,
        ...importActions, onExport,
        dStart, setDStart, dEnd, setDEnd, dStep, setDStep, dAoi, setDAoi,
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode,
    };
}
