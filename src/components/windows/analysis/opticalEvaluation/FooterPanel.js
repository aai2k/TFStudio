import { ExportMenu } from '../../../ui/ExportMenu.js';
import { mediumName } from './spectrum.js';

const { createElement: h } = React;

function summaryForMode({ evalMode, oe, frontCount, backCount, frontNm, backNm, subThick }) {
    if (evalMode === 'front') return oe.frontSummary(frontCount, frontNm.toFixed(1));
    if (evalMode === 'back') return oe.backSummary(backCount, backNm.toFixed(1));
    return oe.totalSummary(frontCount, subThick, backCount);
}

function mediaForMode(design, evalMode) {
    const name = (id) => mediumName(design, id);
    const substrate = name(design.substrate.material);
    if (evalMode === 'front') return `${name(design.incidentMedium)} → ${substrate}`;
    if (evalMode === 'back') return `${name(design.exitMedium)} → ${substrate}`;
    return `${name(design.incidentMedium)} → ${substrate} → ${name(design.exitMedium)}`;
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

export function FooterPanel(props) {
    const {
        c, oe, design, evalMode, data,
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
        h('div', { style: { marginLeft: 'auto' } },
            h(ExportMenu, {
                c, enabled: !!data, copied, copyCSV, saved, saveCSV,
                labels: {
                    export: oe.export, copyCsv: oe.copyCsv, saveCsv: oe.saveCsv,
                    copied: oe.csvCopied, saved: oe.csvSaved,
                },
            }))
    );
}
