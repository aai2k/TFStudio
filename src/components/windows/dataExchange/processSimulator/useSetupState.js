import { DEFAULT_OUTPUT } from '../../../../utils/io/processFileExport.js';
import { loadPersist, savePersist } from './persistence.js';

const { useState, useEffect, useRef } = React;

function persistedOutput(persisted) {
    const output = persisted.output;
    return { ...DEFAULT_OUTPUT, ...(output && typeof output === 'object' ? output : {}) };
}

export function useSetupState() {
    const persisted = useRef(loadPersist()).current;
    const [activeSide, setActiveSide] = useState(persisted.activeSide || 'front');
    // What is being read in the chamber: the part, or witness chips that carry
    // only the layers assigned to them.
    const [mode, setMode] = useState(persisted.mode === 'chips' ? 'chips' : 'part');
    const [secondSurface, setSecondSurface] = useState(persisted.secondSurface || 'bare');
    const [quantity, setQuantity] = useState(persisted.quantity || 'T');
    const [aoi, setAoi] = useState(persisted.aoi != null ? persisted.aoi : 0);
    const [polarization, setPolarization] = useState(persisted.polarization || 'avg');
    const [lambdaStart, setLambdaStart] = useState(persisted.lambdaStart || 400);
    const [lambdaEnd, setLambdaEnd] = useState(persisted.lambdaEnd || 1100);
    const [lambdaStep, setLambdaStep] = useState(persisted.lambdaStep || 2);
    const [exportStep, setExportStep] = useState(persisted.exportStep || 0.5);
    // What a save writes: format, file layout, header and number options.
    const [output, setOutput] = useState(() => persistedOutput(persisted));
    const [showAll, setShowAll] = useState(persisted.showAll === true);
    const [rates, setRates] = useState(persisted.rates || {});
    const [playSpeed, setPlaySpeed] = useState(persisted.playSpeed || 1);
    const setOutputOption = (key, value) => setOutput(previous => ({ ...previous, [key]: value }));

    useEffect(() => {
        savePersist({
            activeSide, mode, secondSurface, quantity, aoi, polarization,
            lambdaStart, lambdaEnd, lambdaStep, exportStep, output, showAll,
            rates, playSpeed,
        });
    }, [activeSide, mode, secondSurface, quantity, aoi, polarization, lambdaStart,
        lambdaEnd, lambdaStep, exportStep, output, showAll, rates, playSpeed]);

    return {
        activeSide, setActiveSide,
        mode, setMode,
        secondSurface, setSecondSurface,
        quantity, setQuantity,
        aoi, setAoi,
        polarization, setPolarization,
        lambdaStart, setLambdaStart,
        lambdaEnd, setLambdaEnd,
        lambdaStep, setLambdaStep,
        exportStep, setExportStep,
        output, setOutputOption,
        showAll, setShowAll,
        rates, setRates,
        playSpeed, setPlaySpeed,
    };
}
