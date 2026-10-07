import {
    carrierOmega, pulseProblem, wavelengthFromOmega,
} from '../../../../utils/physics/pulsePropagation.js';
import { parseSpectrumTable, xToNm, X_UNITS } from '../../../../utils/io/spectrumTable.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useWindowSession } from '../../windowSession.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';
import { pulseFromSettings } from './pulseModel.js';
import { pulseSession } from './sessionState.js';

const { useCallback, useEffect, useMemo, useState } = React;

const GDD_TARGET_TYPES = { R: new Set(['GDD', 'GDDFLAT']), T: new Set(['GDDT', 'GDDTFLAT']) };

function hasLayers(design, side) {
    if (side === 'whole') return true;
    const layers = side === 'back' ? design?.backLayers : design?.frontLayers;
    return (layers || []).some(layer => layer.material && layer.thickness > 0);
}

/**
 * The mean GDD the merit function asks of this response, fs² per bounce, or
 * null when it asks for none. Every enabled GDD target for R, or for T, counts,
 * whatever polarization and angle it is scored at: the value is what the
 * coating was designed to give.
 */
export function designGddTarget(operands, target) {
    const values = (operands || [])
        .filter(operand => operand?.enabled && GDD_TARGET_TYPES[target]?.has(operand.type))
        .map(operand => Number(operand.target))
        .filter(Number.isFinite);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * A measured spectrum from file text: wavelength in the first column, in any
 * unit the spectrum reader detects; intensity in the next; phase in rad, when
 * there is a third. The carrier it returns is the spectrum's centroid in
 * frequency, so the typed GDD and TOD expand about the middle of the light.
 */
export function readPulseSpectrum(text, fileName) {
    const parsed = parseSpectrumTable(text);
    if (!parsed.ok || parsed.columns.length < 1) return null;
    const unit = parsed.xUnit === X_UNITS.UNKNOWN ? X_UNITS.NM : parsed.xUnit;
    const wavelengthNm = parsed.x.map(value => xToNm(value, unit));
    const intensity = parsed.columns[0].values;
    const phaseRad = parsed.columns[1]?.values;
    let weight = 0;
    let moment = 0;
    wavelengthNm.forEach((wavelength, index) => {
        if (!(wavelength > 0) || !(intensity[index] > 0)) return;
        weight += intensity[index];
        moment += intensity[index] * carrierOmega(wavelength);
    });
    if (!(weight > 0)) return null;
    return {
        name: fileName,
        rows: wavelengthNm.length,
        table: { wavelengthNm, intensity, phaseRad },
        centerWavelengthNm: Math.round(wavelengthFromOmega(moment / weight) * 100) / 100,
    };
}

function useSpectrumFile(patch) {
    const [fileError, setFileError] = useState(null);
    const canPick = typeof window !== 'undefined' && !!window.electronAPI?.spectrumPickFile;
    const loadSpectrum = useCallback(async () => {
        setFileError(null);
        const result = await window.electronAPI.spectrumPickFile();
        if (!result?.success) {
            if (!result?.canceled) setFileError(result?.error || 'read');
            return;
        }
        const spectrum = readPulseSpectrum(result.text, result.fileName || 'spectrum');
        if (!spectrum) {
            setFileError('parse');
            return;
        }
        patch({ source: 'file', spectrumFile: spectrum, centerWavelength: spectrum.centerWavelengthNm });
    }, [patch]);
    return { canPick, loadSpectrum, fileError };
}

export function usePulseAnalysis(design) {
    // Following the sampled design keeps an optimizer run from starting one
    // evaluation per progress message.
    const { design: liveDesign } = useLiveDesign();
    const [session, setField, patch] = useWindowSession(pulseSession, design);
    const [stopped, setStopped] = useState(false);
    const {
        source, shape, centerWavelength, duration, bandwidth, order, gdd, tod, spectrumFile,
        side, target, pol, theta, passes,
    } = session;

    const pulse = useMemo(() => pulseFromSettings({
        source, shape, centerWavelength, duration, bandwidth, order, gdd, tod, spectrumFile,
    }), [source, shape, centerWavelength, duration, bandwidth, order, gdd, tod, spectrumFile]);
    const problem = pulseProblem(pulse);
    const hasStack = hasLayers(liveDesign, side);
    const payload = useMemo(() => (hasStack && !problem ? {
        design: liveDesign,
        request: { pulse, side, target, polarization: pol, thetaDeg: theta, passes: Math.max(1, Math.round(passes)) },
    } : null), [hasStack, problem, liveDesign, pulse, side, target, pol, theta, passes]);

    // A new request runs again even after Stop.
    useEffect(() => setStopped(false), [payload]);
    const evaluation = useAnalysisEvaluation(Boolean(payload) && !stopped, 'pulseAnalysis', payload);
    const gddTarget = designGddTarget(liveDesign?.meritOperands, target);
    const file = useSpectrumFile(patch);

    return {
        session, setField, patch, pulse, problem, hasStack, payload,
        evaluation, stopped, stop: () => setStopped(true),
        gddTarget,
        fillGddFromTarget: () => {
            if (gddTarget !== null) setField('gdd', -gddTarget * Math.max(1, Math.round(passes)));
        },
        ...file,
    };
}
