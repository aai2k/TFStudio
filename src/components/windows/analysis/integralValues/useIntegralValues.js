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
import { useEnvironmentChoice } from '../chrome/environmentChoice.js';
import { rangeMaterials } from '../../../../utils/materials/materialRange.js';
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

// The spectrum of each of `designs` in collimated light, one per environment
// shown, in the { data, error } shape the analysis worker reports, so a design
// that cannot be evaluated, such as one with a material that resolves nowhere,
// shows an error instead of computing for ever.
function computeSpectra(designs, params, evalMode) {
    try {
        return { data: designs.map(design => computeSpectrumForMode(design, params, evalMode)), error: null };
    } catch (error) {
        return { data: null, error };
    }
}

// The spectrum and the integrals in each environment the Environment droplist
// names (chrome/environmentChoice.js), each from the design that environment
// computes, on the analysis worker under a cone: `tables`, one per environment
// shown, the integral table of its spectrum; `spectrum`, the first one's;
// under All `sets`, each environment, `{ number, label }`, with its spectrum
// and results; and `materials`, those the range notice reads, of the sides
// computed in every environment shown.
function useEnvironmentIntegrals(design, params, evalMode, customDefs) {
    const environment = useEnvironmentChoice(design, { overlay: true });
    const { views, every } = environment;
    const coneActive = coneIsActive(makeConeSpec(design?.cone || {}));
    const designs = useMemo(() => views.map(view => view.design), [views]);
    const materials = useMemo(
        () => designs.flatMap(one => rangeMaterials(one, evalMode)), [designs, evalMode]);
    const workerPayload = useMemo(
        () => ({ designs, grids: [params], evalMode }),
        [designs, params, evalMode],
    );
    const workerResult = useAnalysisEvaluation(coneActive, 'integralSpectra', workerPayload);
    const workerSpectra = useMemo(
        () => workerResult.data?.map(grids => grids[0]) ?? null, [workerResult.data]);
    const directResult = useMemo(
        () => coneActive ? null : computeSpectra(designs, params, evalMode),
        [coneActive, designs, params, evalMode],
    );
    const spectra = coneActive ? workerSpectra : directResult.data;
    const tables = useMemo(
        () => (spectra || [null]).map(spectrum => integralTable(spectrum, customDefs)),
        [spectra, customDefs],
    );
    const sets = useMemo(() => (every && spectra ? views.map((view, k) => ({
        env: { number: view.number, label: view.label }, spectrum: spectra[k], results: tables[k].results,
    })) : null), [every, spectra, views, tables]);
    return {
        environment, coneActive, sets, tables, materials,
        spectrum: spectra ? spectra[0] : null,
        evaluationError: coneActive ? workerResult.error : directResult.error,
    };
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

    const evaluation = useEnvironmentIntegrals(design, params, evalMode, customDefs);
    const { environment, coneActive, sets, spectrum, materials } = evaluation;
    const { definitions: integrals, results } = evaluation.tables[0];
    const selected = integrals.find(integral => integral.key === selKey) || integrals[0];
    // Under All the table gives each environment's lowest and highest values,
    // so the plot marks none.
    const selectedResult = results && selected && !sets ? results[selected.key] : null;
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
        environment,
        sets,
        materials,
        coneActive,
        evaluationError: evaluation.evaluationError,
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
