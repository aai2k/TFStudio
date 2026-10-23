import {
    highestCustomCounter,
    integralTable,
    makeCustomDefinition,
} from './integralModel.js';
import { computeSpectrumForMode } from './spectrum.js';
import { makeConeSpec, coneIsActive } from '../../../../utils/physics/optimizer.js';
import { useAnalysisEvaluation } from '../useAnalysisEvaluation.js';
import { integralValuesSession } from './sessionState.js';
import { useWindowSession } from '../../windowSession.js';

const { useState, useMemo, useEffect, useRef } = React;

function loadIntegralPresets(setDefinitions, setLoaded, counterRef) {
    let mounted = true;
    if (window?.electronAPI?.loadIntegralPresets) {
        window.electronAPI.loadIntegralPresets().then(result => {
            if (!mounted) return;
            if (result?.success && Array.isArray(result.presets)) {
                setDefinitions(result.presets);
                counterRef.current = highestCustomCounter(result.presets);
            }
            setLoaded(true);
        }).catch(() => { if (mounted) setLoaded(true); });
    } else {
        setLoaded(true);
    }
    return () => { mounted = false; };
}

function persistPreset(preset) {
    if (!window?.electronAPI?.saveIntegralPreset) return;
    window.electronAPI.saveIntegralPreset(preset).catch(() => {});
}

function dropPreset(key) {
    if (!window?.electronAPI?.deleteIntegralPreset) return;
    window.electronAPI.deleteIntegralPreset(key).catch(() => {});
}

// `parts` is t.integralValues.customParts: the new integral is named in the
// UI language.
function addCustomDefinition(context, parts) {
    const { builder, counterRef, setDefinitions, setSelectedKey } = context;
    const definition = makeCustomDefinition(builder, ++counterRef.current, parts);
    setDefinitions(definitions => [...definitions, definition]);
    setSelectedKey(definition.key);
    persistPreset(definition);
}

function removeCustomDefinition(context, key) {
    const { selectedKey, setDefinitions, setSelectedKey } = context;
    setDefinitions(definitions => definitions.filter(definition => definition.key !== key));
    if (selectedKey === key) setSelectedKey('Tvis');
    dropPreset(key);
}

function patchCustomDefinition(setDefinitions, key, patch) {
    setDefinitions(definitions => definitions.map(definition => {
        if (definition.key !== key) return definition;
        const next = { ...definition, ...patch };
        persistPreset(next);
        return next;
    }));
}

function applyEditorTable(context, table) {
    const { editor, setBuilder, setEditor } = context;
    if (editor.target === 'source') {
        setBuilder(builder => ({ ...builder, source: { ...builder.source, table } }));
    } else if (editor.target === 'detector') {
        setBuilder(builder => ({ ...builder, detector: { ...builder.detector, table } }));
    }
    setEditor({ open: false, target: null });
}

// The spectrum in collimated light, in the { data, error } shape the analysis
// worker reports, so a design that cannot be evaluated, such as one with a
// material that resolves nowhere, shows an error instead of computing for ever.
function computeSpectrum(design, params, evalMode) {
    try {
        return { data: computeSpectrumForMode(design, params, evalMode), error: null };
    } catch (error) {
        return { data: null, error };
    }
}

export function useIntegralValues(design, evalMode) {
    const [session, setField, patchSession] = useWindowSession(integralValuesSession, design);
    const { builder, selKey, showTable } = session;
    // The evaluation grid is held as flat keys so Settings can edit each of them,
    // and gathered back into the shape the spectrum functions take.
    const { lambdaStart, lambdaEnd, lambdaStep, theta, polarization } = session;
    const params = useMemo(
        () => ({ lambdaStart, lambdaEnd, lambdaStep, theta, polarization }),
        [lambdaStart, lambdaEnd, lambdaStep, theta, polarization],
    );
    const setParams = value => patchSession(current => (
        typeof value === 'function' ? value(current) : value));
    const setBuilder = value => setField('builder', value);
    const setSelKey = value => setField('selKey', value);
    const setShowTable = value => setField('showTable', value);
    const [customDefs, setCustomDefs] = useState([]);
    const [, setPresetsLoaded] = useState(false);
    const [editor, setEditor] = useState({ open: false, target: null });
    const customCounterRef = useRef(0);

    useEffect(
        () => loadIntegralPresets(setCustomDefs, setPresetsLoaded, customCounterRef),
        [],
    );

    const coneActive = coneIsActive(makeConeSpec(design?.cone || {}));
    const workerPayload = useMemo(
        () => ({ design, params, evalMode }),
        [design, params, evalMode],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'integralSpectrum', workerPayload);
    const directResult = useMemo(
        () => coneActive ? null : computeSpectrum(design, params, evalMode),
        [coneActive, design, params, evalMode],
    );
    const evaluation = coneActive ? workerResult : directResult;
    const spectrum = evaluation.data;
    const { definitions: integrals, results } = useMemo(
        () => integralTable(spectrum, customDefs),
        [spectrum, customDefs],
    );
    const selected = integrals.find(integral => integral.key === selKey) || integrals[0];
    const selectedResult = results && selected ? results[selected.key] : null;
    const actionContext = {
        builder,
        counterRef: customCounterRef,
        setDefinitions: setCustomDefs,
        selectedKey: selKey,
        setSelectedKey: setSelKey,
    };
    const editorContext = { editor, setBuilder, setEditor };

    return {
        params,
        setParams,
        customDefs,
        builder,
        setBuilder,
        editor,
        setEditor,
        selKey,
        setSelKey,
        showTable,
        setShowTable,
        spectrum,
        coneActive,
        evaluationError: evaluation.error,
        integrals,
        results,
        selected,
        selectedResult,
        onAddCustom: parts => addCustomDefinition(actionContext, parts),
        onRemoveCustom: key => removeCustomDefinition(actionContext, key),
        onPatchCustom: (key, patch) => patchCustomDefinition(setCustomDefs, key, patch),
        openEditor: target => setEditor({ open: true, target }),
        applyTable: table => applyEditorTable(editorContext, table),
    };
}
