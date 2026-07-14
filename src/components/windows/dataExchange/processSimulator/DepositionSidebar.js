import { NumInput } from './controls.js';
import { resolveMaterial } from './model.js';

const { createElement: h } = React;

function formatNumber(value, decimals = 1) {
    return isFinite(value) ? value.toFixed(decimals) : '—';
}

function cullName(name, max = 18) {
    if (!name) return '';
    return name.length > max ? name.slice(0, max - 1) + '…' : name;
}

function materialDisplay(id) {
    const material = resolveMaterial(id);
    return material?.name || id || '';
}

function SectionTitle({ c, children }) {
    return h('div', {
        style: {
            fontSize: 10, fontWeight: 700, color: c.textDim,
            textTransform: 'uppercase', letterSpacing: '0.4px',
            marginBottom: 6,
        },
    }, children);
}

function SequenceRows({ c, sp, deposition }) {
    return h('tbody', null,
        deposition.activeDep.map((layer, index) => {
            const number = index + 1;
            const current = number === deposition.layerIdx;
            const done = number <= deposition.completedSteps;
            return h('tr', {
                key: layer.id,
                style: {
                    backgroundColor: current ? c.accent + '22' : 'transparent',
                    color: done ? c.text : (current ? c.accent : c.textDim),
                    fontWeight: current ? 600 : 400,
                    borderBottom: `1px solid ${c.border}33`,
                },
            },
                h('td', { style: { padding: '4px 4px' } }, number),
                h('td', {
                    style: { padding: '4px 4px', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                    title: materialDisplay(layer.materialId),
                }, cullName(materialDisplay(layer.materialId))),
                h('td', { style: { padding: '4px 4px', textAlign: 'right' } }, formatNumber(layer.thickness, 2)),
                h('td', { style: { padding: '4px 4px', textAlign: 'right' } }, formatNumber(deposition.layerTimes[index], 1)),
            );
        }),
        h('tr', {
            style: { color: c.textDim, fontSize: 10, borderTop: `1px solid ${c.border}` },
        },
            h('td', { colSpan: 3, style: { padding: '6px 4px', textAlign: 'right' } }, sp.totalTime),
            h('td', { style: { padding: '6px 4px', textAlign: 'right' } }, formatNumber(deposition.totalTime, 1) + ' s'),
        ),
    );
}

function SequenceTable({ c, sp, deposition }) {
    if (deposition.N === 0) {
        return h('div', { style: { color: c.textDim, padding: '8px 0' } }, sp.noLayers);
    }
    return h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
        h('thead', null,
            h('tr', { style: { color: c.textDim } },
                h('th', { style: { textAlign: 'left', padding: '4px 4px' } }, sp.layerNum),
                h('th', { style: { textAlign: 'left', padding: '4px 4px' } }, sp.layerMat),
                h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.layerThk),
                h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.layerTime),
            ),
        ),
        h(SequenceRows, { c, sp, deposition }),
    );
}

function RatesTable({ c, sp, setup, materials }) {
    let content = h('div', { style: { color: c.textDim, fontSize: 11 } }, '—');
    if (materials.length !== 0) {
        content = h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
            h('thead', null,
                h('tr', { style: { color: c.textDim } },
                    h('th', { style: { textAlign: 'left', padding: '4px 4px' } }, sp.layerMat),
                    h('th', { style: { textAlign: 'right', padding: '4px 4px' } }, sp.rateNmS),
                ),
            ),
            h('tbody', null,
                materials.map(materialId => h('tr', { key: materialId },
                    h('td', {
                        style: { padding: '4px 4px', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
                        title: materialDisplay(materialId),
                    }, cullName(materialDisplay(materialId))),
                    h('td', { style: { padding: '4px 4px', textAlign: 'right' } },
                        h(NumInput, {
                            value: setup.rates[materialId] != null ? setup.rates[materialId] : 1.0,
                            onChange: value => setup.setRates(previous => ({ ...previous, [materialId]: value })),
                            min: 0.001, max: 1000, step: 0.1,
                            c, width: 78,
                        }),
                    ),
                )),
            ),
        );
    }
    return content;
}

export function DepositionSidebar({ c, sp, setup, deposition }) {
    return h('div', {
        style: {
            width: 340, minWidth: 240,
            borderRight: `1px solid ${c.border}`,
            backgroundColor: c.panel,
            overflowY: 'auto', flexShrink: 0,
            fontSize: 11,
        },
    },
        h('div', { style: { padding: '8px 10px' } },
            h(SectionTitle, { c }, sp.sectionSequence),
            h(SequenceTable, { c, sp, deposition }),
        ),
        h('div', { style: { padding: '8px 10px', borderTop: `1px solid ${c.border}` } },
            h(SectionTitle, { c }, sp.sectionRates),
            h('div', { style: { color: c.textDim, fontSize: 10, marginBottom: 6, lineHeight: 1.4 } }, sp.rateHint),
            h(RatesTable, { c, sp, setup, materials: deposition.materials }),
        ),
    );
}
