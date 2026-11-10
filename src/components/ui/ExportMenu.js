const { createElement: h, useState } = React;

/**
 * Export dropdown for the analysis windows: Copy CSV / Save CSV, with the
 * button label reporting what just happened.
 *
 *   labels  { export, copyCsv, saveCsv, copied, saved, failed }
 *   enabled false greys the button out when there is nothing to export
 *   drop    'up' for a menu in a footer, which opens above it; 'down' for one in
 *           a window's top row, where a list opened upward would be off the
 *           window and out of reach
 *   items   [{ key, label, onClick }] in place of Copy CSV and Save CSV, for a
 *           window that exports more than one table
 *   failed  why the last export did not happen; the button says so and its
 *           tooltip gives the reason
 */
export function ExportMenu({
    c, labels, enabled, copied, copyCSV, saved, saveCSV, drop = 'up', items = null, failed = null,
}) {
    const [open, setOpen] = useState(false);
    const run = action => { setOpen(false); action(); };
    const entries = items || [
        { key: 'copy', label: labels.copyCsv, onClick: copyCSV },
        { key: 'save', label: labels.saveCsv, onClick: saveCSV },
    ];
    let status = labels.export;
    let statusColor = c.text;
    if (copied || saved) {
        status = copied ? labels.copied : labels.saved;
        statusColor = c.accent;
    } else if (failed) {
        status = labels.failed;
        statusColor = c.error;
    }
    const itemStyle = {
        width: '100%', padding: '6px 10px', border: 'none', background: 'transparent',
        color: c.text, cursor: 'pointer', textAlign: 'left', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap',
    };
    return h('div', { style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            onClick: () => enabled && setOpen(current => !current), disabled: !enabled,
            'aria-expanded': open, title: failed || undefined,
            style: {
                height: 22, display: 'flex', alignItems: 'center', gap: 5,
                padding: '0 8px', fontSize: 11, cursor: enabled ? 'pointer' : 'default',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: 'transparent', color: statusColor,
                outline: 'none', fontFamily: 'system-ui', opacity: enabled ? 1 : 0.5,
            },
        },
            h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none' },
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
                position: 'absolute', right: 0, [drop === 'down' ? 'top' : 'bottom']: 27, zIndex: 50, minWidth: 130,
                padding: '4px 0', backgroundColor: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 5, boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
            },
        },
            entries.map(item => h('button', { key: item.key, onClick: () => run(item.onClick), style: itemStyle }, item.label)),
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
