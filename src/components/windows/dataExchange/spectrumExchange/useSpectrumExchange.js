import { useDesign } from '../../../../state/DesignContext.js';
import { useUnresolvedMaterials } from '../../../../utils/materials/useUnresolvedMaterials.js';
import { useDesignExport, useMeasuredExport } from './exportActions.js';
import { useImportActions } from './importActions.js';
import { spectrumExchangeSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useState } = React;

export function useSpectrumExchange(sx) {
    const { design, updateDesign, checkpoint, evalParams, evalMode } = useDesign();
    const missingMaterialIds = useUnresolvedMaterials(design);
    const [session, setField] = useWindowSession(spectrumExchangeSession, design);
    const { tab, expSource, expFormat, parsed, fileName, colIdx, name, xUnit, ov } = session;
    const setTab = value => setField('tab', value);
    const setExpSource = value => setField('expSource', value);
    const setExpFormat = value => setField('expFormat', value);
    const setParsed = value => setField('parsed', value);
    const setFileName = value => setField('fileName', value);
    const setColIdx = value => setField('colIdx', value);
    const setName = value => setField('name', value);
    const setXUnit = value => setField('xUnit', value);
    const setOv = value => setField('ov', value);
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState(null);
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
        dQ, setDQ, dSP, setDSP, onExportDesign, evalMode, missingMaterialIds,
    };
}
