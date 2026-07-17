import { getMaterialById } from '../../../../utils/materials/catalogManager.js';
import { buildFilterDesignObject } from '../../../../utils/filter/filterDesignBuild.js';
import { DEFAULTS } from './model.js';

const { useState, useCallback, useEffect } = React;

function isLossless(p) {
    const matH = getMaterialById(p.matH), matL = getMaterialById(p.matL);
    return !((matH?.getNK ? matH.getNK(p.lambda0_nm)[1] : 0) > 1e-5 || (matL?.getNK ? matL.getNK(p.lambda0_nm)[1] : 0) > 1e-5);
}

function buildDesign(p) {
    return buildFilterDesignObject({
        name: p.name, matH: p.matH, matL: p.matL, substrateMaterial: p.substrateMaterial,
        substrateThicknessMm: p.substrateThicknessMm, incidentMedium: p.incidentMedium, exitMedium: p.exitMedium,
        lambda0_nm: p.lambda0_nm, candidate: p.selected, spacerKind: p.spacerKind, arMode: p.arMode,
        halfPass: p.passHalf_nm, halfStop: p.stopHalf_nm, aoi: p.aoi, pol: p.pol,
    });
}

// Wizard state: the params object `p`, step navigation, and the finish/generate
// action. The first five steps design in the EMBEDDED case (incident index =
// substrate index); step 6 introduces the real incident medium via `p.arMode`.
export function useFilterDesign({ onClose, onGenerate, folderName, t }) {
    const T = t.filterDesign;
    const [p, setParams] = useState(() => ({ ...DEFAULTS }));
    const [step, setStep] = useState(1);
    const set = useCallback((key, value) => setParams(prev => ({ ...prev, [key]: value })), []);

    useEffect(() => { const onKey = (e) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]);

    const lossless = isLossless(p);
    const canFinish = !!folderName && p.selected != null;
    const nextDisabled = (step === 1 && !lossless);

    const finish = useCallback(() => {
        if (!canFinish) return;
        try {
            onGenerate(buildDesign(p)); onClose();
        } catch (err) { alert(T.generateError(err.message)); } // eslint-disable-line no-alert
    }, [p, canFinish, onGenerate, onClose, T]);

    const back = useCallback(() => setStep(s => Math.max(1, s - 1)), []);
    const next = useCallback(() => setStep(s => Math.min(6, s + 1)), []);

    return { p, set, step, canFinish, nextDisabled, finish, back, next };
}
