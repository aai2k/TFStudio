import { Checkbox } from '../../../ui/Checkbox.js';
import { Btn, td, th } from './ui.js';

const { createElement: h } = React;

function materialRow(material, index, { c, selMats, toggle }) {
    const low = material.points.length ? material.points[0][0] : 0;
    const high = material.points.length ? material.points[material.points.length - 1][0] : 0;
    const checked = selMats.has(material.name);
    return h('tr', {
        key: index, onClick: () => toggle(material.name),
        style: { cursor: 'pointer', background: checked ? c.accent + '18' : 'transparent' },
    },
        h('td', { style: { ...td(c), textAlign: 'center' } }, h(Checkbox, { c, checked, readOnly: true })),
        h('td', { style: td(c) }, material.name),
        h('td', { style: { ...td(c), textAlign: 'right', color: c.textDim } }, material.points.length),
        h('td', { style: { ...td(c), color: c.textDim } }, material.points.length ? `${low}–${high}` : '—'),
    );
}

export function MaterialsTab({ c, z, doc, selMats, setSelMats, importMaterials }) {
    if (!doc) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noFile);
    if (!doc.materials.length) return h('div', { style: { color: c.textDim, fontSize: 12, padding: 20, textAlign: 'center' } }, z.noMaterials);

    const toggle = (name) => {
        const next = new Set(selMats);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        setSelMats(next);
    };

    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 8, height: '100%' } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h(Btn, { onClick: () => setSelMats(new Set(doc.materials.map((material) => material.name))), c }, z.selectAll),
            h(Btn, { onClick: () => setSelMats(new Set()), c }, z.clearSel),
            h('div', { style: { flex: 1 } }),
            h(Btn, { onClick: () => importMaterials(false), c, primary: true }, z.importSelected),
            h(Btn, { onClick: () => importMaterials(true), c }, z.importAll),
        ),
        h('div', { style: { flex: 1, overflow: 'auto', border: `1px solid ${c.border}`, borderRadius: 4 } },
            h('table', { style: { width: '100%', borderCollapse: 'collapse' } },
                h('thead', null, h('tr', null,
                    h('th', { style: { ...th(c), width: 28 } }, ''),
                    h('th', { style: th(c) }, z.colName),
                    h('th', { style: { ...th(c), textAlign: 'right' } }, z.colPoints),
                    h('th', { style: th(c) }, z.colRange),
                )),
                h('tbody', null, doc.materials.map((material, index) => materialRow(material, index, { c, selMats, toggle }))),
            ),
        ),
    );
}
