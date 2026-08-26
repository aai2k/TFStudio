import { loadPersist, savePersist } from './persistence.js';

const { useState, useEffect, useRef } = React;

export function useSetupState() {
    const persisted = useRef(loadPersist()).current;
    const [activeSide, setActiveSide] = useState(persisted.activeSide || 'front');
    const [secondSurface, setSecondSurface] = useState(persisted.secondSurface || 'bare');
    const [quantity, setQuantity] = useState(persisted.quantity || 'T');
    const [aoi, setAoi] = useState(persisted.aoi != null ? persisted.aoi : 0);
    const [polarization, setPolarization] = useState(persisted.polarization || 'avg');
    const [lambdaStart, setLambdaStart] = useState(persisted.lambdaStart || 400);
    const [lambdaEnd, setLambdaEnd] = useState(persisted.lambdaEnd || 1100);
    const [lambdaStep, setLambdaStep] = useState(persisted.lambdaStep || 2);
    const [exportStep, setExportStep] = useState(persisted.exportStep || 0.5);
    const [showAll, setShowAll] = useState(persisted.showAll === true);
    const [rates, setRates] = useState(persisted.rates || {});
    const [playSpeed, setPlaySpeed] = useState(persisted.playSpeed || 1);

    useEffect(() => {
        savePersist({
            activeSide, secondSurface, quantity, aoi, polarization,
            lambdaStart, lambdaEnd, lambdaStep, exportStep, showAll,
            rates, playSpeed,
        });
    }, [activeSide, secondSurface, quantity, aoi, polarization, lambdaStart,
        lambdaEnd, lambdaStep, exportStep, showAll, rates, playSpeed]);

    return {
        activeSide, setActiveSide,
        secondSurface, setSecondSurface,
        quantity, setQuantity,
        aoi, setAoi,
        polarization, setPolarization,
        lambdaStart, setLambdaStart,
        lambdaEnd, setLambdaEnd,
        lambdaStep, setLambdaStep,
        exportStep, setExportStep,
        showAll, setShowAll,
        rates, setRates,
        playSpeed, setPlaySpeed,
    };
}
