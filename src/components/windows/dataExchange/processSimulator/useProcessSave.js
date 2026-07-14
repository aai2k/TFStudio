import { buildAllProcessFiles } from '../../../../utils/io/processFileExport.js';

const { useState, useEffect, useCallback } = React;

function reportSaveError(options, message) {
    options.setStatusMsg({ type: 'error', message });
    options.setSaving(false);
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
        const files = buildAllProcessFiles(options.design, {
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
        });
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
            message: options.sp.successMsg(files.length, result.dir),
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

export function useProcessSave(design, setup, layerCount, sp) {
    const [saving, setSaving] = useState(false);
    const [statusMsg, setStatusMsg] = useState(null);

    const handleSave = useCallback(() => startProcessSave({
        design, setup, layerCount, sp, saving, setSaving, setStatusMsg,
    }), [design, layerCount, saving, setup.activeSide, setup.secondSurface,
        setup.quantity, setup.aoi, setup.polarization, setup.lambdaStart,
        setup.lambdaEnd, setup.exportStep, sp]);

    useEffect(() => {
        if (!statusMsg) return;
        const timer = setTimeout(() => setStatusMsg(null), 6000);
        return () => clearTimeout(timer);
    }, [statusMsg]);

    return { saving, statusMsg, handleSave };
}
