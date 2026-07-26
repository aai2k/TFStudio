import { mediumName } from './spectrum.js';

const { createElement: h, useState } = React;

function summaryForMode({ evalMode, oe, frontCount, backCount, frontNm, backNm, subThick }) {
    if (evalMode === 'front') return oe.frontSummary(frontCount, frontNm.toFixed(1));
    if (evalMode === 'back') return oe.backSummary(backCount, backNm.toFixed(1));
    return oe.totalSummary(frontCount, subThick, backCount);
}

function mediaForMode(design, evalMode) {
    const substrate = mediumName(design.substrate.material);
    if (evalMode === 'front') return `${mediumName(design.incidentMedium)} → ${substrate}`;
    if (evalMode === 'back') return `${mediumName(design.exitMedium)} → ${substrate}`;
    return `${mediumName(design.incidentMedium)} → ${substrate} → ${mediumName(design.exitMedium)}`;
}

function DesignSummary({ design, evalMode, oe, frontCount, backCount, frontNm, backNm, subThick, c }) {
    const summary = summaryForMode({ evalMode, oe, frontCount, backCount, frontNm, backNm, subThick });
    const media = mediaForMode(design, evalMode);
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 7, minWidth: 0, overflow: 'hidden' } },
        h('span', { style: { color: c.text, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, design.name),
        h('span', null, '·'),
        h('span', { style: { whiteSpace: 'nowrap' } }, summary),
        h('span', null, '·'),
        h('span', { style: { whiteSpace: 'nowrap' } }, media)
    );
}

function ExportMenu({ c, oe, data, copied, copyCSV, saved, saveCSV }) {
    const [open, setOpen] = useState(false);
    const run = action => { setOpen(false); action(); };
    let status = oe.export;
    if (copied) status = oe.csvCopied;
    else if (saved) status = oe.csvSaved;
    const itemStyle = {
        width: '100%', padding: '6px 10px', border: 'none', background: 'transparent',
        color: c.text, cursor: 'pointer', textAlign: 'left', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif', whiteSpace: 'nowrap'
    };
    return h('div', { style: { position: 'relative', flexShrink: 0 } },
        h('button', {
            onClick: () => data && setOpen(current => !current), disabled: !data,
            'aria-expanded': open,
            style: {
                height: 27, display: 'flex', alignItems: 'center', gap: 6,
                padding: '0 10px', fontSize: 11, cursor: data ? 'pointer' : 'default',
                border: `1px solid ${c.border}`, borderRadius: 6,
                backgroundColor: 'transparent', color: (copied || saved) ? c.accent : c.text,
                outline: 'none', fontFamily: 'system-ui', opacity: data ? 1 : 0.5
            }
        },
            h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none' },
                h('path', { d: 'M8 2v8M5 7l3 3 3-3M3 11v2h10v-2', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' })),
            status,
            h('svg', { width: 9, height: 9, viewBox: '0 0 10 10', fill: 'none' },
                h('path', { d: 'M2 3.5l3 3 3-3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }))
        ),
        open && h('div', { onClick: () => setOpen(false), style: { position: 'fixed', inset: 0, zIndex: 49 } }),
        open && h('div', {
            style: {
                position: 'absolute', right: 0, bottom: 31, zIndex: 50, minWidth: 130,
                padding: '4px 0', backgroundColor: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 5, boxShadow: '0 4px 16px rgba(0,0,0,0.35)'
            }
        },
            h('button', { onClick: () => run(copyCSV), style: itemStyle }, oe.copyCsv),
            h('button', { onClick: () => run(saveCSV), style: itemStyle }, oe.saveCsv)
        )
    );
}

export function FooterPanel(props) {
    const {
        c, oe, design, evalMode, computing, data,
        copied, copyCSV, saved, saveCSV,
        frontCount, backCount, frontNm, backNm, subThick,
    } = props;
    return h('div', {
        style: {
            minHeight: 38, padding: '4px 12px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 11, color: c.textDim
        }
    },
        h(DesignSummary, { design, evalMode, oe, frontCount, backCount, frontNm, backNm, subThick, c }),
        computing && h('span', { style: { color: c.accent } }, oe.calculating),
        h('div', { style: { marginLeft: 'auto' } },
            h(ExportMenu, { c, oe, data, copied, copyCSV, saved, saveCSV }))
    );
}
