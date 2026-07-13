import { computeIntegralValueBatch } from '../../../../utils/physics/integralValues.js';
import {
    INITIAL_BUILDER,
    INITIAL_PARAMS,
    buildIntegralDefinitions,
    highestCustomCounter,
    makeCustomDefinition,
} from './integralModel.js';
import { computeSpectrumForMode } from './spectrum.js';

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

function addCustomDefinition(context) {
    const { builder, counterRef, setDefinitions, setSelectedKey } = context;
    const definition = makeCustomDefinition(builder, ++counterRef.current);
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

function computeSpectrum(design, params, evalMode) {
    if (!design) return null;
    try {
        return computeSpectrumForMode(design, params, evalMode);
    } catch (_) {
        return null;
    }
}

export function useIntegralValues(design, evalMode) {
    const [params, setParams] = useState(INITIAL_PARAMS);
    const [customDefs, setCustomDefs] = useState([]);
    const [, setPresetsLoaded] = useState(false);
    const [builder, setBuilder] = useState(INITIAL_BUILDER);
    const [editor, setEditor] = useState({ open: false, target: null });
    const [selKey, setSelKey] = useState('Tvis');
    const customCounterRef = useRef(0);

    useEffect(
        () => loadIntegralPresets(setCustomDefs, setPresetsLoaded, customCounterRef),
        [],
    );

    const spectrum = useMemo(
        () => computeSpectrum(design, params, evalMode),
        [design, params, evalMode],
    );
    const integrals = useMemo(
        () => buildIntegralDefinitions(customDefs),
        [customDefs],
    );
    const results = useMemo(
        () => spectrum ? computeIntegralValueBatch(spectrum, integrals) : null,
        [spectrum, integrals],
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
        spectrum,
        integrals,
        results,
        selected,
        selectedResult,
        onAddCustom: () => addCustomDefinition(actionContext),
        onRemoveCustom: key => removeCustomDefinition(actionContext, key),
        onPatchCustom: (key, patch) => patchCustomDefinition(setCustomDefs, key, patch),
        openEditor: target => setEditor({ open: true, target }),
        applyTable: table => applyEditorTable(editorContext, table),
    };
}
