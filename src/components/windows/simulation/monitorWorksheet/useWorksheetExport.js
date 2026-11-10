/**
 * The Monitor Worksheet's export: the table copied or saved, the signal curves
 * saved, and the chart saved as a picture, written the way the export settings
 * say (exportModel.js).
 *
 * The settings are the user's, not the design's: they are kept in this
 * browser's storage, as the Process Exporter keeps its own, and every design
 * exports the same way. One file goes through a save dialog; one file per chip
 * goes into a folder the user picks.
 */

import { saveChartPicture } from '../../../ui/chartPicture.js';
import { matName } from '../wizardShared.js';
import { curveFiles, outputFrom, tableFiles } from './exportModel.js';

const { useEffect, useRef, useState } = React;

const PERSIST_KEY = 'tfstudio-monitor-worksheet-export-v1';
// As long as the shared menu shows its own Copied and Saved.
const ACK_MS = 1500;

function loadOutput() {
    try {
        return outputFrom(JSON.parse(localStorage.getItem(PERSIST_KEY)));
    } catch (_) {
        return outputFrom(null);
    }
}

function storeOutput(output) {
    try { localStorage.setItem(PERSIST_KEY, JSON.stringify(output)); } catch (_) {}
}

// { saved: true }, { error } with why, or {} for a dialog the user closed.
async function writeFiles(files) {
    const api = window.electronAPI;
    if (files.length === 1) {
        const result = await api.spectrumSaveFile(files[0].content, files[0].filename);
        if (result?.success) return { saved: true };
        return result?.canceled ? {} : { error: result?.error || 'unknown' };
    }
    const pick = await api.pickProcessSaveDir();
    if (!pick?.dir) return pick?.error ? { error: pick.error } : {};
    const result = await api.saveProcessFiles(files, pick.dir);
    return result?.success ? { saved: true } : { error: result?.error || 'unknown' };
}

// The chip glass by name; a glass no catalog holds, which the window already
// reports, by its id.
function glassName(resolveMat, id) {
    try { return matName(resolveMat, id); } catch (_) { return id; }
}

// What the run was, for the files' # lines.
function runMeta(state) {
    const { design, session, resolveMat } = state;
    return {
        designName: design?.name || 'design',
        char: session.char, theta: session.theta, pol: session.polarization,
        chipGlass: glassName(resolveMat, session.chipMaterial || design?.substrate?.material || 'builtin:BK7'),
        witnessRatio: session.witnessRatio,
    };
}

export function useWorksheetExport({ state, columns, tableRows, chartRef, t }) {
    const mw = t.monitorWorksheet;
    const [output, setOutput] = useState(loadOutput);
    const [ack, setAck] = useState(null);
    const [failed, setFailed] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);

    const setOutputOption = (key, value) => setOutput(previous => {
        const next = { ...previous, [key]: value };
        storeOutput(next);
        return next;
    });
    const acknowledge = kind => {
        clearTimeout(timer.current);
        setFailed(null);
        setAck(kind);
        timer.current = setTimeout(() => setAck(null), ACK_MS);
    };
    const fail = reason => { setAck(null); setFailed(reason); };
    const save = async files => {
        try {
            const result = await writeFiles(files);
            if (result.saved) acknowledge('saved');
            else if (result.error) fail(result.error);
        } catch (error) {
            fail(error.message || String(error));
        }
    };

    const meta = () => runMeta(state);
    const table = options => tableFiles({ columns, rows: tableRows, meta: meta(), output: options });
    const curveNames = {
        step: '#', chip: mw.colChip, lambda: mw.colLambda,
        thickness: mw.colLayerThickness, position: mw.axisThickness, signal: mw.axisSignal,
    };
    const items = [
        {
            key: 'copy-table', label: mw.copyTable,
            onClick: () => {
                navigator.clipboard?.writeText(table({ ...output, files: 'table' })[0].content);
                acknowledge('copied');
            },
        },
        { key: 'save-table', label: mw.saveTable, onClick: () => save(table(output)) },
        {
            key: 'save-curves', label: mw.saveCurves,
            onClick: () => save(curveFiles({ rows: state.rows, names: curveNames, meta: meta(), output })),
        },
        {
            key: 'save-chart', label: mw.saveChart,
            onClick: () => { if (!saveChartPicture(chartRef.current)) fail(mw.chartNotShown); },
        },
    ];
    return {
        output, setOutputOption, items, failed,
        copied: ack === 'copied', saved: ack === 'saved',
    };
}
