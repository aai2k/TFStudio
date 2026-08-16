const { createElement: h, useState } = React;

/**
 * Footer export dropdown for the analysis windows: Copy CSV / Save CSV, with
 * the button label reporting what just happened.
 *
 *   labels  { export, copyCsv, saveCsv, copied, saved }
 *   enabled false greys the button out when there is nothing to export
 */
export function ExportMenu({ c, labels, enabled, copied, copyCSV, saved, saveCSV }) {
    const [open, setOpen] = useState(false);
    const run = action => { setOpen(false); action(); };
    let status = labels.export;
    if (copied) status = labels.copied;
    else if (saved) status = labels.saved;
    const itemStyle = {
        width: '100%', padding: '6px 10px', border: 'none', background: 'transparent',
        color: c.text, cursor: 'pointer', textAlign: 'left', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap',
    };
    return h('div', { style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            onClick: () => enabled && setOpen(current => !current), disabled: !enabled,
            'aria-expanded': open,
            style: {
                height: 27, display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 10px', fontSize: 11, cursor: enabled ? 'pointer' : 'default',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: 'transparent', color: (copied || saved) ? c.accent : c.text,
                outline: 'none', fontFamily: 'system-ui', opacity: enabled ? 1 : 0.5,
            },
        },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
                h('path', {
                    d: 'M8 2v8M5 7l3 3 3-3M3 11v2h10v-2', stroke: 'currentColor',
                    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
                })),
            status,
            h('svg', { width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none' },
                h('path', {
                    d: 'M2 3.5l3 3 3-3', stroke: 'currentColor',
                    strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round',
                })),
        ),
        open && h('div', {
            onClick: () => setOpen(false),
            style: { position: 'fixed', inset: 0, zIndex: 49 },
        }),
        open && h('div', {
            style: {
                position: 'absolute', right: 0, bottom: 31, zIndex: 50, minWidth: 130,
                padding: '4px 0', backgroundColor: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 5, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            },
        },
            h('button', { onClick: () => run(copyCSV), style: itemStyle }, labels.copyCsv),
            h('button', { onClick: () => run(saveCSV), style: itemStyle }, labels.saveCsv),
        ),
    );
}

/**
 * Clipboard and file writes for a CSV the caller builds on demand, with the
 * short-lived "copied" / "saved" acknowledgements the menu shows.
 */
export function useCsvExport(buildCsv, fileName) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const copyCSV = () => {
        const csv = buildCsv();
        if (!csv) return;
        if (navigator.clipboard) navigator.clipboard.writeText(csv);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };
    const saveCSV = async () => {
        const csv = buildCsv();
        if (!csv || !window.electronAPI?.spectrumSaveFile) return;
        const result = await window.electronAPI.spectrumSaveFile(csv, fileName());
        if (result?.success) { setSaved(true); setTimeout(() => setSaved(false), 1500); }
    };
    return { copied, saved, copyCSV, saveCSV };
}
