/**
 * State of the Report window.
 *
 * The block list, document fields, paper, language and design selection live
 * in a session store so they survive a remount. The document is rebuilt from
 * the live design whenever anything it depends on changes, once the change has
 * settled: the numbers are gathered once per design and block list, and the
 * page is composed again on top of them when only text, branding or paper
 * change. Actions live in ./reportActions.js.
 */

import { useDesign } from '../../../../state/DesignContext.js';
import { useLiveDesign } from '../../../../state/useLiveDesign.js';
import { useWindowSession } from '../../windowSession.js';
import { getLocale, getCurrentLocale } from '../../../../constants/locales/index.js';
import { BUILTIN_TEMPLATES, DEFAULT_TEMPLATE_ID, blocksFromTemplate } from '../../../../utils/report/blocks.js';
import { gatherDesignData } from '../../../../utils/report/reportData.js';
import { composeReport } from '../../../../utils/report/template.js';
import { errorAnalysisSession } from '../../analysis/errorAnalysis/sessionState.js';
import { monitorWorksheetSession } from '../../simulation/monitorWorksheet/sessionState.js';
import { reportSession, APP_LANGUAGE } from './sessionState.js';
import { useBranding } from './branding.js';
import { useBlockActions, useTemplateActions, useExportActions } from './reportActions.js';

const { useCallback, useEffect, useMemo, useRef, useState } = React;

function todayISO() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// The locale block the document is written in, plus the qualifier kind names
// the specification block labels rows with and the Monitor Worksheet's column
// names, which the worksheet block shares with the window.
function reportLocale(code) {
    const loc = getLocale(code) || {};
    return {
        ...(loc.report || {}),
        kinds: (loc.specification && loc.specification.kinds) || {},
        summaries: (loc.specification && loc.specification.summaries) || {},
        mw: loc.monitorWorksheet || {},
    };
}

// Re-render when a store written by another window changes.
function useStoreTick(store) {
    const [tick, setTick] = useState(0);
    useEffect(() => store.subscribe(() => setTick(n => n + 1)), [store]);
    return tick;
}

// The keys of the Monte-Carlo and Monitor Worksheet state the report prints. A
// write to any other key of those windows (a divider position, a field being
// typed) leaves the page alone.
const MONTE_CARLO_KEYS = ['result', 'char', 'corridorSigma', 'rmsAbsNm', 'rmsRelPct', 'rmsReN', 'rmsImN', 'distribution', 'theta', 'polarization'];
const WORKSHEET_KEYS = ['char', 'theta', 'polarization', 'layersPerChip', 'witnessRatio', 'signalErrorPct', 'absSignalErrorPct', 'maxTerminationErrPct', 'chipMaterial', 'chipByStep', 'lambdaByStep'];

const pick = (values, keys) => Object.fromEntries(keys.map(key => [key, values[key]]));
const sameValues = (a, b) => Object.keys(a).every(key => a[key] === b[key]);

// What the two windows hold for each covered design, read without touching
// their stores.
function readExternal(designs) {
    return designs.map(design => ({
        id: design.id,
        monteCarlo: pick(errorAnalysisSession.peek(design), MONTE_CARLO_KEYS),
        worksheet: pick(monitorWorksheetSession.peek(design), WORKSHEET_KEYS),
    }));
}

function sameExternal(a, b) {
    return a.length === b.length && a.every((entry, i) =>
        entry.id === b[i].id && sameValues(entry.monteCarlo, b[i].monteCarlo) && sameValues(entry.worksheet, b[i].worksheet));
}

// What other windows hold and the report prints as is: the Monte-Carlo
// window's last run for a design, with the error settings it ran with, and the
// Monitor Worksheet window's chip plan and monitor settings. The page follows a
// change to those values and nothing else those windows write.
function useExternalResults(designs) {
    const runTick = useStoreTick(errorAnalysisSession);
    const planTick = useStoreTick(monitorWorksheetSession);
    const snapshot = useMemo(() => readExternal(designs), [designs, runTick, planTick]);
    const kept = useRef(snapshot);
    if (!sameExternal(kept.current, snapshot)) kept.current = snapshot;
    const current = kept.current;
    return useMemo(() => {
        const byId = new Map(current.map(entry => [entry.id, entry]));
        return {
            monteCarlo: design => {
                const { result, ...settings } = byId.get(design.id)?.monteCarlo || {};
                return result ? { result, settings } : null;
            },
            worksheet: design => byId.get(design.id)?.worksheet || null,
        };
    }, [current]);
}

// A pause longer than the gap between two keystrokes of ordinary typing.
const REBUILD_DELAY_MS = 200;

// `value` once it has stopped changing for REBUILD_DELAY_MS, so a burst of
// edits rebuilds the page once, when it ends. While `hold` is set the last
// settled value is kept: an optimizer run drives the design through frames no
// reader can follow, so the page waits for the run to stop.
function useSettled(value, hold) {
    const [settled, setSettled] = useState(value);
    useEffect(() => {
        if (hold) return undefined;
        const timer = setTimeout(() => setSettled(value), REBUILD_DELAY_MS);
        return () => clearTimeout(timer);
    }, [value, hold]);
    return settled;
}

const STATUS_CLEAR_MS = 4000;

function useStatus() {
    const [status, setStatus] = useState(null); // { kind: 'ok' | 'err' | 'busy', msg }
    useEffect(() => {
        if (!status || status.kind !== 'ok') return undefined;
        const timer = setTimeout(() => setStatus(null), STATUS_CLEAR_MS);
        return () => clearTimeout(timer);
    }, [status]);
    return [status, setStatus];
}

function useAppVersion() {
    const [version, setVersion] = useState('');
    useEffect(() => {
        Promise.resolve(window.electronAPI?.getAppVersion?.())
            .then(v => { if (typeof v === 'string') setVersion(v); })
            .catch(() => {});
    }, []);
    return version;
}

// The block list comes from the template until the store holds its own.
function useBlocks(state, patch) {
    const initial = useMemo(
        () => blocksFromTemplate(BUILTIN_TEMPLATES[state.templateId] || BUILTIN_TEMPLATES[DEFAULT_TEMPLATE_ID]),
        []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (!state.blocks) patch({ blocks: initial }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const setBlocks = useCallback(next => patch({ blocks: next }), [patch]);
    return [state.blocks || initial, setBlocks];
}

// Which designs the report covers: the active one, or the picked ones with the
// live copy standing in for the active design among them.
function useChosenDesigns(state, design, allDesigns) {
    return useMemo(() => {
        if (state.scope === 'selected') {
            const picked = state.selectedIds.map(id => allDesigns[id]).filter(Boolean)
                .map(d => (design && d.id === design.id ? design : d));
            if (picked.length) return picked;
        }
        return design ? [design] : [];
    }, [state.scope, state.selectedIds, design, allDesigns]);
}

function useDesignSelection(state, patch, design) {
    const useCurrentDesign = useCallback(() => patch({ scope: 'current' }), [patch]);
    const setDesignSelected = useCallback((id, on) => {
        const base = state.scope === 'selected' ? state.selectedIds : (design ? [design.id] : []);
        const next = on ? [...new Set([...base, id])] : base.filter(x => x !== id);
        patch({ scope: 'selected', selectedIds: next });
    }, [patch, state.scope, state.selectedIds, design]);
    return { useCurrentDesign, setDesignSelected };
}

// The value `fn` returns, or the message of what it threw.
function attempt(fn) {
    try { return { value: fn(), error: null }; }
    catch (e) { return { value: null, error: e.message || String(e) }; }
}

// The page: numbers gathered once per design and block list, then composed.
// A failure in either step is the window's error rather than React's: a design
// chosen for a comparison whose material no catalog resolves throws from the
// data layer.
function useDocument({ chosen, blocks, external, lang, tr, branding, doc, paper, meta }) {
    const gathered = useMemo(
        () => attempt(() => chosen.map(d => ({ design: d, data: gatherDesignData(d, blocks, external) }))),
        [chosen, blocks, external]);
    const items = gathered.value || [];
    const composed = useMemo(() => (gathered.error
        ? { value: '', error: gathered.error }
        : attempt(() => composeReport({ lang, tr, brand: branding, doc, paper, blocks, designs: items, meta }))),
    [gathered.error, items, lang, tr, branding, doc, paper, blocks, meta]);
    return { items, html: composed.value || '', error: composed.error };
}

// The document's language: a code, or the language the app runs in.
function documentLanguage(stored) {
    return stored && stored !== APP_LANGUAGE ? stored : getCurrentLocale();
}

export function useReportWindow({ t }) {
    const W = t.report.window;
    const designCtx = useDesign();
    const { design, preview } = useLiveDesign();
    const [state, setField, patch] = useWindowSession(reportSession, null);
    const branding = useBranding();
    const version = useAppVersion();
    const [status, setStatus] = useStatus();
    const [blocks, setBlocks] = useBlocks(state, patch);

    const allDesigns = designCtx.designs || (design ? { [design.id]: design } : {});
    const designList = useMemo(() => Object.values(allDesigns), [allDesigns]);
    const chosen = useChosenDesigns(state, design, allDesigns);

    const lang = documentLanguage(state.lang);
    const tr = useMemo(() => reportLocale(lang), [lang]);
    const doc = useMemo(() => ({
        ...state.doc,
        date: state.doc.date || todayISO(),
        designer: state.doc.designer || branding.designer || '',
    }), [state.doc, branding.designer]);
    const meta = useMemo(() => ({ appName: 'TFStudio', version, generatedAt: doc.date }), [version, doc.date]);
    const external = useExternalResults(chosen);
    const inputs = useSettled(useMemo(
        () => ({ chosen, blocks, external, lang, tr, branding, doc, paper: state.paper, meta }),
        [chosen, blocks, external, lang, tr, branding, doc, state.paper, meta]), preview);
    const { items, html, error } = useDocument(inputs);

    const setDoc = useCallback((key, value) => patch({ doc: { ...state.doc, [key]: value } }), [patch, state.doc]);
    const setPaper = useCallback(paper => setField('paper', paper), [setField]);
    const setLang = useCallback(code => setField('lang', code), [setField]);

    return {
        design, designList, folders: designCtx.folders || [],
        activeDesignId: designCtx.activeDesignId ?? design?.id ?? null,
        scope: state.scope, selectedIds: state.selectedIds, chosen,
        blocks, templateId: state.templateId,
        doc, paper: state.paper, lang, branding,
        html, error, status,
        setDoc, setPaper, setLang,
        ...useDesignSelection(state, patch, design),
        ...useBlockActions({ blocks, setBlocks, design }),
        ...useTemplateActions({ W, blocks, state, patch, setStatus }),
        ...useExportActions({
            W, html, items, setStatus,
            doc: inputs.doc, paper: inputs.paper, tr: inputs.tr, branding: inputs.branding, meta: inputs.meta,
        }),
    };
}
