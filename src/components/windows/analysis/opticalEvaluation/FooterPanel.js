import { mediumName } from './spectrum.js';

const { createElement: h } = React;

function DesignSummary({ design, evalMode, oe, frontCount, backCount, frontNm, backNm, subThick }) {
    return [
        h('span', { key: 'name' }, design.name),
        evalMode === 'front' && h('span', { key: 'front-summary' }, oe.frontSummary(frontCount, frontNm.toFixed(1))),
        evalMode === 'back' && h('span', { key: 'back-summary' }, oe.backSummary(backCount, backNm.toFixed(1))),
        evalMode === 'total' && h('span', { key: 'total-summary' }, oe.totalSummary(frontCount, subThick, backCount)),
        evalMode === 'front' && h('span', { key: 'front-media' }, `${mediumName(design.incidentMedium)} → ${mediumName(design.substrate.material)}`),
        evalMode === 'back' && h('span', { key: 'back-media' }, `${mediumName(design.exitMedium)} → ${mediumName(design.substrate.material)}`),
        evalMode === 'total' && h('span', { key: 'total-media' }, `${mediumName(design.incidentMedium)} → ${mediumName(design.substrate.material)} → ${mediumName(design.exitMedium)}`),
    ];
}

function FooterButton({ onClick, disabled, style, children }) {
    return h('button', { onClick, disabled, style }, children);
}

export function FooterPanel(props) {
    const {
        c, oe, design, evalMode, computing, data,
        copied, copyCSV, saved, saveCSV, showTable, setShowTable,
        frontCount, backCount, frontNm, backNm, subThick,
    } = props;
    return h('div', {
        style: {
            padding: '3px 10px', borderTop: `1px solid ${c.border}`,
            backgroundColor: c.panel, flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 12,
            fontSize: 11, color: c.textDim
        }
    },
        h(DesignSummary, { design, evalMode, oe, frontCount, backCount, frontNm, backNm, subThick }),
        computing && h('span', { style: { color: c.accent } }, oe.calculating),
        h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 5, alignItems: 'center' } },
            h(FooterButton, {
                onClick: copyCSV, disabled: !data,
                style: {
                    padding: '2px 9px', fontSize: 11, cursor: data ? 'pointer' : 'default',
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    backgroundColor: 'transparent', color: copied ? c.accent : c.textDim,
                    outline: 'none', fontFamily: 'system-ui', opacity: data ? 1 : 0.5
                }
            }, copied ? oe.csvCopied : oe.csvButton),
            h(FooterButton, {
                onClick: saveCSV, disabled: !data,
                style: {
                    padding: '2px 9px', fontSize: 11, cursor: data ? 'pointer' : 'default',
                    border: `1px solid ${c.border}`, borderRadius: 3,
                    backgroundColor: 'transparent', color: saved ? c.accent : c.textDim,
                    outline: 'none', fontFamily: 'system-ui', opacity: data ? 1 : 0.5
                }
            }, saved ? oe.csvSaved : oe.csvSave),
            h(FooterButton, {
                onClick: () => setShowTable(current => !current),
                style: {
                    padding: '2px 9px', fontSize: 11, cursor: 'pointer',
                    border: `1px solid ${showTable ? c.accent : c.border}`,
                    borderRadius: 3,
                    backgroundColor: showTable ? c.accent + '22' : 'transparent',
                    color: showTable ? c.accent : c.textDim,
                    outline: 'none', fontFamily: 'system-ui'
                }
            }, (showTable ? '▲ ' : '▼ ') + oe.tableToggle)
        )
    );
}
