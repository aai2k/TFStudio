/**
 * Page 2 — Parameters Deviation (shared by BBM / Mono).
 *
 * Per-material systematic & random Re(n) deviation + systematic inhomogeneity,
 * a per-layer "exclude from monitoring" table with relative thickness error,
 * and the shutter-delay mean / RMS row.
 */

import { Checkbox }                      from '../../../ui/Checkbox.js';
import { matName, cullName, cellNum, NumField } from '../wizardShared.js';

const { createElement: h } = React;

export function PageDeviations({ p, set, materialIds, layers, c, B }) {
    const th = { textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${c.border}`, fontWeight: 600, color: c.textDim, fontSize: 11.5, whiteSpace: 'nowrap' };
    const td = { padding: '3px 8px', borderBottom: `1px solid ${c.border}55`, fontSize: 12, color: c.text };

    const setDev = (id, key, v) => set('matDev', { ...p.matDev, [id]: { ...(p.matDev[id] || {}), [key]: v } });
    const setLayer = (i, key, v) => { const arr = p.layers.map(x => ({ ...x })); arr[i] = { ...arr[i], [key]: v }; set('layers', arr); };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 } },
        // Table 1 — systematic & random deviations (per material)
        h('div', null,
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.systRandTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', maxHeight: 150 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', { style: { background: c.panel } },
                        [B.colNum, B.colMaterial, B.colReNSyst, B.colReNRand, B.colSystInh].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, materialIds.map((id, i) => {
                        const dv = p.matDev[id] || {};
                        return h('tr', { key: id },
                            h('td', { style: td }, i + 1),
                            h('td', { style: { ...td, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(id) }, cullName(matName(id), 30)),
                            h('td', { style: td }, cellNum({ value: dv.reNSyst ?? 0, step: 0.001, min: -1, max: 1, c, width: 80, onChange: (v) => setDev(id, 'reNSyst', v) })),
                            h('td', { style: td }, cellNum({ value: dv.reNRand ?? 0, step: 0.001, min: 0, max: 1, c, width: 80, onChange: (v) => setDev(id, 'reNRand', v) })),
                            h('td', { style: td }, cellNum({ value: dv.systInh ?? 0, step: 0.01, min: -50, max: 50, c, width: 70, onChange: (v) => setDev(id, 'systInh', v) })));
                    })))),
        ),
        // Table 2 — exclude design layers from monitoring (per layer)
        h('div', { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            h('div', { style: { fontSize: 12.5, fontWeight: 600, color: c.text, marginBottom: 6 } }, B.excludeTitle),
            h('div', { style: { border: `1px solid ${c.border}`, borderRadius: 4, overflow: 'auto', flex: 1 } },
                h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                    h('thead', null, h('tr', { style: { background: c.panel, position: 'sticky', top: 0 } },
                        [B.colNum, B.colMaterial, B.colPhysThk, B.colExclude, B.colRelThkErr].map((x, i) => h('th', { key: i, style: th }, x)))),
                    h('tbody', null, layers.map((l, i) => h('tr', { key: i },
                        h('td', { style: td }, i + 1),
                        h('td', { style: { ...td, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: matName(l.material) }, cullName(matName(l.material), 22)),
                        h('td', { style: td }, (l.thickness || 0).toFixed(2)),
                        h('td', { style: { ...td, textAlign: 'center' } },
                            h(Checkbox, { c, checked: !!p.layers[i]?.exclude,
                                onChange: (e) => setLayer(i, 'exclude', e.target.checked) })),
                        h('td', { style: td }, cellNum({ value: p.layers[i]?.relThkErr ?? 0, step: 0.01, min: 0, max: 100,
                            c, width: 80, onChange: (v) => setLayer(i, 'relThkErr', v) })))))))),
        // shutter delay row
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 18, flexShrink: 0 } },
            h(NumField, { label: B.shutterMean, value: p.shutterMean, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterMean', v) }),
            h(NumField, { label: B.shutterRms, value: p.shutterRms, min: 0, max: 30, step: 0.1, c, width: 90, suffix: 's', onChange: (v) => set('shutterRms', v) })),
    );
}
