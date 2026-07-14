import { computeSpectrum } from './model.js';

const { useMemo } = React;

function setupSpectrumOptions(setup) {
    return {
        activeSide: setup.activeSide,
        secondSurface: setup.secondSurface,
        quantity: setup.quantity,
        aoi: setup.aoi,
        polarization: setup.polarization,
        lambdaStart: setup.lambdaStart,
        lambdaEnd: setup.lambdaEnd,
        lambdaStep: setup.lambdaStep,
    };
}

function spectrumMedia(deposition) {
    return {
        incidentMat: deposition.incidentMat,
        substrateMat: deposition.substrateMat,
        exitMat: deposition.exitMat,
        substrateThk: deposition.substrateThk,
    };
}

export function useSpectra(design, setup, deposition) {
    const spectrumKey = useMemo(() => JSON.stringify({
        activeSide: setup.activeSide,
        secondSurface: setup.secondSurface,
        quantity: setup.quantity,
        aoi: setup.aoi,
        polarization: setup.polarization,
        lambdaStart: setup.lambdaStart,
        lambdaEnd: setup.lambdaEnd,
        lambdaStep: setup.lambdaStep,
        designId: design?.id,
        N: deposition.N,
        active: deposition.activeDep.map(layer => `${layer.materialId}@${layer.thickness}`),
        other: deposition.otherDep.map(layer => `${layer.materialId}@${layer.thickness}`),
        subId: design?.substrate?.material,
        subThk: design?.substrate?.thickness,
        inc: design?.incidentMedium,
        exit: design?.exitMedium,
    }), [setup.activeSide, setup.secondSurface, setup.quantity, setup.aoi,
        setup.polarization, setup.lambdaStart, setup.lambdaEnd, setup.lambdaStep,
        deposition.activeDep, deposition.otherDep, design, deposition.N]);

    const common = {
        activeDep: deposition.activeDep,
        otherDep: deposition.otherDep,
        ...setupSpectrumOptions(setup),
        ...spectrumMedia(deposition),
    };
    const validRange = setup.lambdaEnd > setup.lambdaStart && setup.lambdaStep > 0;

    const baselineSpec = useMemo(() => {
        let spectrum = null;
        if (validRange) spectrum = computeSpectrum({ ...common, layerIdx: 0, frac: 0 });
        return spectrum;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spectrumKey]);

    const stepSpectra = useMemo(() => {
        let spectra = null;
        if (validRange) {
            spectra = [];
            for (let layer = 1; layer <= deposition.N; layer++) {
                spectra.push(computeSpectrum({ ...common, layerIdx: layer, frac: 1 }));
            }
        }
        return spectra;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spectrumKey]);

    const liveSpec = useMemo(() => {
        let spectrum = null;
        if (validRange) {
            spectrum = deposition.N === 0
                ? baselineSpec
                : computeSpectrum({
                    ...common,
                    layerIdx: deposition.layerIdx,
                    frac: deposition.frac,
                });
        }
        return spectrum;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [spectrumKey, deposition.layerIdx, deposition.frac, baselineSpec]);

    return { baselineSpec, stepSpectra, liveSpec, lambdas: baselineSpec?.lambda || [] };
}
