/**
 * What the workspace is asked to show: which tools to open and which docking
 * layout to apply. It also keeps the list of tools currently open, which it
 * needs for itself, to decide whether a first design should auto-arrange.
 *
 * A request carries a timestamp because the docking layer reacts to the newest
 * one, so asking twice for the same tool has to look like two requests.
 */

import { hasSavedLayout } from '../components/docking/layoutStorage.js';

const { useState, useEffect, useCallback } = React;

export function useWorkspaceLayout(activeDesignId, showTransientDesign) {
    const [toolRequests,  setToolRequests]  = useState([]);
    const [layoutRequest, setLayoutRequest] = useState(null);
    const [openWindowIds, setOpenWindowIds] = useState([]);

    // `opts` may name the region to dock into and whether an already-open copy
    // should be focused instead of a second one opened.
    const openTool = useCallback((toolId, opts) => {
        setToolRequests(prev => [...prev, { toolId, ts: Date.now(), ...opts }]);
    }, []);

    const applyPreset = useCallback((id) => {
        setLayoutRequest({ type: 'preset', id, ts: Date.now() });
    }, []);

    const saveLayout = useCallback(() => {
        setLayoutRequest({ type: 'save', ts: Date.now() });
    }, []);

    // Nothing saved leaves the workspace as it is, which at startup is the
    // empty state rather than a preset.
    const restoreLayout = useCallback(() => {
        if (hasSavedLayout()) setLayoutRequest({ type: 'restore', ts: Date.now() });
    }, []);

    // ── Open a default layout the first time a design is shown ─────────────────
    // Startup opens no design (empty workspace). When the user creates or picks
    // the first design and nothing is docked yet, drop in the Filter-Design
    // preset (Design Editor left, Optical Evaluation right) so they aren't left
    // staring at the empty state. Once any window is open we never auto-arrange.
    useEffect(() => {
        if (activeDesignId && openWindowIds.length === 0) applyPreset('filter-design');
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeDesignId]);

    // Show a TRANSIENT preview design (e.g. from the Optimizer Benchmark window)
    // and optionally open a tool for it. The design is made active but is NOT
    // added to the explorer or written to disk. A single reused id
    // ('__bench_preview__') means repeated previews replace one orphan design
    // rather than accumulating; it never appears in the project tree (the
    // explorer renders from folder items, not from the designs map).
    useEffect(() => {
        const onLoad = (e) => {
            const d = e.detail && e.detail.design;
            if (!d) return;
            showTransientDesign({ ...d, id: d.id || '__bench_preview__' });
            if (e.detail.openTool) openTool(e.detail.openTool);
        };
        window.addEventListener('tfstudio:load-design', onLoad);
        return () => window.removeEventListener('tfstudio:load-design', onLoad);
    }, [showTransientDesign, openTool]);

    return {
        toolRequests, layoutRequest, setOpenWindowIds,
        openTool, applyPreset, saveLayout, restoreLayout,
    };
}
