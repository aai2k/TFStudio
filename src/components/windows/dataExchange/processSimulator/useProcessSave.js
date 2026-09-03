import { processFileSteps } from '../../../../utils/io/processFileExport.js';

const { useState, useEffect, useCallback } = React;

// How long the export may hold the window before handing it a turn: one
// frame. A turn after every file would cost more than the files do.
const FRAME_MS = 16;

// Lets the window repaint between steps. scheduler.yield() where the runtime
// has it; a zero timeout otherwise, which is also what tests run on.
function yieldToWindow() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
        return scheduler.yield();
    }
    return new Promise(resolve => setTimeout(resolve, 0));
}

// The files of the run, built with the window kept alive. The count so far
// goes to the progress hairline each time the export hands the window a turn.
async function collectFiles(design, exportOptions, setProgress) {
    const files = [];
    let lastTurn = performance.now();
    for (const { file, index, total } of processFileSteps(design, exportOptions)) {
        files.push(file);
        if (performance.now() - lastTurn >= FRAME_MS) {
            setProgress({ i: index, total });
            await yieldToWindow();
            lastTurn = performance.now();
        }
    }
    return files;
}

function reportSaveError(options, message) {
    options.setStatusMsg({ type: 'error', message });
    options.setProgress(null);
    options.setSaving(false);
}

function successMessage(sp, files, dir) {
    const chips = new Set(files.map(file => file.subdir).filter(Boolean)).size;
    return chips ? sp.successMsgChips(files.length, chips, dir) : sp.successMsg(files.length, dir);
}

async function continueProcessSave(options, pick) {
    try {
        if (pick?.canceled) {
            options.setSaving(false);
            return;
        }
        const dir = pick?.dir;
        if (!dir) {
            reportSaveError(options, options.sp.errSave(pick?.error || 'no folder'));
            return;
        }
        const appVersion = await window.electronAPI.getAppVersion().catch(() => '');
        const files = await collectFiles(options.design, {
            activeSide: options.setup.activeSide,
            secondSurface: options.setup.secondSurface,
            quantity: options.setup.quantity,
            aoi: options.setup.aoi,
            polarization: options.setup.polarization,
            lambdaStart: options.setup.lambdaStart,
            lambdaEnd: options.setup.lambdaEnd,
            lambdaStep: options.setup.exportStep,
            outputDir: dir,
            appVersion,
            projectLabel: options.design.name,
            chips: options.chipPlan,
        }, options.setProgress);
        options.setProgress(null);
        if (!files.length) {
            reportSaveError(options, options.sp.errNoLayers);
            return;
        }
        const result = await window.electronAPI.saveProcessFiles(files, dir);
        if (!result?.success) {
            reportSaveError(options, options.sp.errSave(result?.error || 'unknown'));
            return;
        }
        options.setStatusMsg({
            type: 'success',
            message: successMessage(options.sp, files, result.dir),
        });
        options.setSaving(false);
    } catch (error) {
        reportSaveError(options, options.sp.errSave(error.message || String(error)));
    }
}

async function startProcessSave(options) {
    if (options.design && options.layerCount !== 0 && !options.saving) {
        options.setSaving(true);
        try {
            const pick = await window.electronAPI.pickProcessSaveDir();
            return continueProcessSave(options, pick);
        } catch (error) {
            reportSaveError(options, options.sp.errSave(error.message || String(error)));
        }
    }
}

/**
 * The Save button. `chipPlan` is the witness chip plan when the run is being
 * read on chips, null for the part. `progress` is `{ i, total }` while the
 * files are being built and null otherwise.
 */
export function useProcessSave(design, setup, layerCount, sp, chipPlan = null) {
    const [saving, setSaving] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null);
    const [progress, setProgress] = useState(null);

    const handleSave = useCallback(() => startProcessSave({
        design, setup, layerCount, sp, saving, setSaving, setStatusMsg, setProgress, chipPlan,
    }), [design, layerCount, saving, setup.activeSide, setup.secondSurface,
        setup.quantity, setup.aoi, setup.polarization, setup.lambdaStart,
        setup.lambdaEnd, setup.exportStep, sp, chipPlan]);

    useEffect(() => {
        if (!statusMsg) return;
        const timer = setTimeout(() => setStatusMsg(null), 6000);
        return () => clearTimeout(timer);
    }, [statusMsg]);

    return { saving, statusMsg, progress, handleSave };
}
