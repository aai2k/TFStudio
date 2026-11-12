import {
    customDefinitionFrom,
    customDraft,
    draftName,
    highestCustomCounter,
    integralTable,
    makeCustomDefinition,
    newCustomDraft,
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

// A new integral is added, selected, and its channel, source, detector and
// band are what the next new one starts from.
function addCustomDefinition(context, parts) {
    const { draft, customDefs, counterRef, setDefinitions, setSelectedKey, setBuilder } = context;
    const definition = makeCustomDefinition(draft, ++counterRef.current, parts, customDefs);
    setDefinitions(definitions => [...definitions, definition]);
    setSelectedKey(definition.key);
    const { char, source, detector, bandMin, bandMax } = draft;
    setBuilder({ char, source, detector, bandMin, bandMax });
    persistPreset(definition);
}

// A changed integral keeps its key and its place in the table.
function changeCustomDefinition(context, parts) {
    const { draft, customDefs, setDefinitions } = context;
    const current = customDefs.find(definition => definition.key === draft.key);
    const next = { ...current, ...customDefinitionFrom(draft, draft.key, parts, customDefs) };
    setDefinitions(definitions => definitions.map(definition => (definition.key === draft.key ? next : definition)));
    persistPreset(next);
}

/**
 * The dialog's OK or Add: the draft becomes a new custom integral, or the one
 * it was opened on, and the dialog closes. A draft with no name does nothing.
 * `parts` is t.integralValues.customParts, so a suggested name is in the UI
 * language.
 */
export function commitCustomDraft(context, parts) {
    const { draft, customDefs, setDraft } = context;
    if (!draftName(draft, parts, customDefs)) return;
    if (draft.key == null) addCustomDefinition(context, parts);
    else changeCustomDefinition(context, parts);
    setDraft(null);
}

function removeCustomDefinition(context, key) {
    const { selectedKey, setDefinitions, setSelectedKey } = context;
    setDefinitions(definitions => definitions.filter(definition => definition.key !== key));
    if (selectedKey === key) setSelectedKey('Tvis');
    dropPreset(key);
}

// A table typed in the curve editor goes to the source or detector of the
// integral the dialog holds.
function applyEditorTable(context, table) {
    const { editor, setDraft, setEditor } = context;
    if (editor.target === 'source' || editor.target === 'detector') {
        const slot = editor.target;
        setDraft(draft => ({ ...draft, [slot]: { ...draft[slot], table } }));
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
    const { builder, draft, selKey, showTable } = session;
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
    const setDraft = value => setField('draft', value);
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
        draft,
        customDefs,
        counterRef: customCounterRef,
        setDefinitions: setCustomDefs,
        setBuilder,
        setDraft,
        selectedKey: selKey,
        setSelectedKey: setSelKey,
    };
    const editorContext = { editor, setDraft, setEditor };

    return {
        params,
        setParams,
        customDefs,
        draft,
        setDraft,
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
        openNewCustom: () => setDraft(newCustomDraft(builder)),
        openCustom: (key, parts) => setDraft(customDraft(
            customDefs.find(definition => definition.key === key), parts, customDefs)),
        closeCustom: () => setDraft(null),
        commitCustom: parts => commitCustomDraft(actionContext, parts),
        onRemoveCustom: key => removeCustomDefinition(actionContext, key),
        openEditor: target => setEditor({ open: true, target }),
        applyTable: table => applyEditorTable(editorContext, table),
    };
}
