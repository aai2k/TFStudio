// Design history strip at the bottom of the Refinement window: one row per
// method a run finished, each restorable back into the design. A stochastic
// run's row shows the seed it drew from.
//
// Rows are grouped by the Run press that made them, newest run first, under a
// heading that names the run, its method and, when it ran several, the method
// that did best. Within a run the rows go best merit first, so Try all reads as
// a ranking rather than in the order its methods happened to finish.

const { createElement: h } = React;   // React is a window global

/**
 * The entries as runs: [{ runNum, runMethod, rows }], newest run first, each
 * run's rows by merit, lowest first. Rows recorded before runs were numbered
 * carry no runNum; they come last, newest first, under no heading.
 */
export function historyGroups(entries) {
    const runs = new Map();
    const loose = [];
    for (const entry of entries) {
        if (entry.runNum == null) { loose.push(entry); continue; }
        if (!runs.has(entry.runNum)) runs.set(entry.runNum, []);
        runs.get(entry.runNum).push(entry);
    }
    const groups = [...runs]
        .sort(([a], [b]) => b - a)
        .map(([runNum, rows]) => ({
            runNum, runMethod: rows[0].runMethod, rows: [...rows].sort((a, b) => a.mf - b.mf),
        }));
    if (loose.length) groups.push({ runNum: null, rows: [...loose].reverse() });
    return groups;
}

/** "Run #3 · Try all · best: Damped Least Squares"; null for unnumbered rows. */
export function runHeading(group, tr) {
    if (group.runNum == null) return null;
    const methodName = id => tr.methods[id] || id;
    // One method, Try all, or a list of methods, which reads as their names.
    const what = group.runMethod === 'all' ? tr.history.tryAll
        : [].concat(group.runMethod ?? []).map(methodName).join(' + ');
    const parts = [tr.history.run(group.runNum), what];
    if (group.rows.length > 1) parts.push(`${tr.bestLabel} ${methodName(group.rows[0].method)}`);
    return parts.filter(Boolean).join(' · ');
}

const smallButton = (c, selected) => ({
    padding: '1px 8px', fontSize: 10, border: `1px solid ${selected ? c.accent : c.border}`,
    borderRadius: 2, background: selected ? `${c.accent}22` : c.panel,
    color: selected ? c.accent : c.text, cursor: 'pointer', fontFamily: 'inherit',
});

function headingRow(text, key, c) {
    return h('div', {
        key,
        style: {
            padding: '3px 8px', fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap',
            overflow: 'hidden', textOverflow: 'ellipsis',
            borderTop: `1px solid ${c.border}`, background: c.panel,
        },
    }, text);
}

function entryRow(entry, { selectedId, onSelect, onRestore, c, tr }) {
    const th = tr.history;
    const hasPlot = !!entry.mfHistory?.length;
    const selected = selectedId === entry.id;
    return h('div', {
        key: entry.id,
        style: {
            display: 'flex', alignItems: 'center', padding: '2px 8px',
            borderBottom: `1px solid ${c.border}22`, gap: 8, fontSize: 11,
            background: selected ? `${c.accent}18` : 'transparent',
            boxShadow: selected ? `inset 2px 0 ${c.accent}` : 'none',
        }
    },
        h('span', { style: { color: c.accent, fontWeight: 600, minWidth: 72 } }, entry.label),
        h('span', { style: { color: c.textDim } }, `${tr.iterLabel} ${entry.iter}`),
        h('span', { style: { color: c.text, marginLeft: 4 } }, `${tr.mfLabel} ${entry.mf.toFixed(6)}`),
        h('span', { style: { color: c.textDim, marginLeft: 4 } }, th.layers(entry.layerCount)),
        entry.seed != null && h('span', { style: { color: c.textDim, marginLeft: 4 }, title: tr.seedTip }, th.seed(entry.seed)),
        h('div', { style: { flex: 1 } }),
        hasPlot && h('button', { onClick: () => onSelect(entry), style: smallButton(c, selected) }, th.plot || 'Plot'),
        h('button', { onClick: () => onRestore(entry), style: smallButton(c, false) }, th.restore)
    );
}

export function HistoryPanel({ entries, selectedId, onSelect, onRestore, c, t }) {
    const tr = t.refinement;
    const th = tr.history;
    const rowOpts = { selectedId, onSelect, onRestore, c, tr };

    return h('div', {
        style: {
            borderTop: `1px solid ${c.border}`, background: c.panel,
            flexShrink: 0, maxHeight: 130, overflow: 'hidden',
            display: 'flex', flexDirection: 'column'
        }
    },
        h('div', {
            style: { padding: '3px 8px', fontSize: 10, fontWeight: 600, color: c.textDim, letterSpacing: '0.05em', textTransform: 'uppercase', borderBottom: `1px solid ${c.border}`, flexShrink: 0 }
        }, th.title),
        h('div', { style: { flex: 1, overflow: 'auto' } },
            entries.length === 0
                ? h('div', { style: { padding: '8px 10px', fontSize: 11, color: c.textDim, fontStyle: 'italic' } }, th.empty)
                : historyGroups(entries).flatMap(group => {
                    const heading = runHeading(group, tr);
                    return [
                        heading && headingRow(heading, `run-${group.runNum}`, c),
                        ...group.rows.map(entry => entryRow(entry, rowOpts)),
                    ];
                })
        )
    );
}
