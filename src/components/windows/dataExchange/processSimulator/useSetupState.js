import { DEFAULT_OUTPUT } from '../../../../utils/io/processFileExport.js';
import { loadPersist, savePersist } from './persistence.js';
import { PROCESS_SETUP_DEFAULTS } from './model.js';

const { useState, useEffect, useRef } = React;

function persistedOutput(persisted) {
    const output = persisted.output;
    return { ...DEFAULT_OUTPUT, ...(output && typeof output === 'object' ? output : {}) };
}

export function useSetupState() {
    const persisted = useRef(loadPersist()).current;
    const D = PROCESS_SETUP_DEFAULTS;
    const [activeSide, setActiveSide] = useState(persisted.activeSide || D.activeSide);
    // What is being read in the chamber: the part, or witness chips that carry
    // only the layers assigned to them.
    const [mode, setMode] = useState(persisted.mode === 'chips' ? 'chips' : 'part');
    const [secondSurface, setSecondSurface] = useState(persisted.secondSurface || D.secondSurface);
    const [quantity, setQuantity] = useState(persisted.quantity || D.quantity);
    const [aoi, setAoi] = useState(persisted.aoi != null ? persisted.aoi : D.aoi);
    const [polarization, setPolarization] = useState(persisted.polarization || D.polarization);
    const [lambdaStart, setLambdaStart] = useState(persisted.lambdaStart || D.lambdaStart);
    const [lambdaEnd, setLambdaEnd] = useState(persisted.lambdaEnd || D.lambdaEnd);
    const [lambdaStep, setLambdaStep] = useState(persisted.lambdaStep || D.lambdaStep);
    const [exportStep, setExportStep] = useState(persisted.exportStep || D.exportStep);
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
