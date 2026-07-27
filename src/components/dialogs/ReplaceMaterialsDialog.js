/**
 * ReplaceMaterialsDialog — swap any material used in the design for another.
 *
 * Lists every distinct material referenced by the media, substrate and both
 * layer stacks, with its usage count. Applying a replacement changes every
 * matching reference; thicknesses and layer order are untouched.
 */

import { getMaterialById, resolveColor, materialLabel } from '../../utils/materials/catalogManager.js';
import { resolveDesignMaterial } from '../../utils/materials/designMaterials.js';
import { MaterialPicker } from '../ui/MaterialPicker.js';

const { createElement: h, useState, useMemo } = React;

/** Distinct material ids across the complete optical stack, in first-seen order. */
export function collectMaterials(design) {
    const order = [];
    const counts = new Map();
    const add = (id) => {
        if (!id) return;
        if (!counts.has(id)) { counts.set(id, 0); order.push(id); }
        counts.set(id, counts.get(id) + 1);
    };

    add(design.incidentMedium);
    add(design.substrate?.material);
    add(design.exitMedium);
    for (const arr of [design.frontLayers || [], design.backLayers || []]) {
        for (const layer of arr) add(layer.material);
    }
    return order.map(id => ({ id, count: counts.get(id) }));
}

/** Return a design with every reference in `replacements` changed atomically. */
export function replaceMaterialReferences(design, replacements) {
    const replace = (id) => replacements[id] || id;
    const swapLayers = (layers) => (layers || []).map(layer => {
        const material = replace(layer.material);
        return material === layer.material ? layer : { ...layer, material };
    });
    return {
        ...design,
        incidentMedium: replace(design.incidentMedium),
        substrate: { ...design.substrate, material: replace(design.substrate?.material) },
        exitMedium: replace(design.exitMedium),
        frontLayers: swapLayers(design.frontLayers),
        backLayers: swapLayers(design.backLayers),
    };
}

export function ReplaceMaterialsDialog({ design, updateDesign, c, t, onClose }) {
    const de = t.designEditor;
    const rm = de.replaceMaterials;
    const used = useMemo(() => collectMaterials(design), [design]);

    // Replacement map: original id → chosen id. Absent / equal ⇒ unchanged.
    const [repl, setRepl] = useState({});

    const changed = used.filter(m => repl[m.id] && repl[m.id] !== m.id);

    const apply = () => {
        if (changed.length === 0) { onClose(); return; }
        const map = Object.fromEntries(changed.map(m => [m.id, repl[m.id]]));
        updateDesign(replaceMaterialReferences(design, map));
        onClose();
    };

    const overlay = {
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    };
    const panel = {
        backgroundColor: c.panel, borderRadius: 8, padding: 24,
        width: 460, maxWidth: '92vw', maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 10px 40px rgba(0,0,0,0.3)', border: `1px solid ${c.border}`,
    };
    const btn = (primary) => ({
        padding: '7px 16px', fontSize: 12, cursor: 'pointer', borderRadius: 6,
        border: `1px solid ${primary ? c.accent : c.border}`,
        backgroundColor: primary ? c.accent : 'transparent',
        color: primary ? '#fff' : c.text,
        opacity: (primary && changed.length === 0) ? 0.5 : 1,
    });

    const nameOf = (id) => {
        const resolved = resolveDesignMaterial(design, id);
        const mat = resolved.status === 'missing' ? null : resolved.material;
        return mat ? (mat.name || materialLabel(id)) : materialLabel(id);
    };
    const colorOf = (id) => {
        const resolved = resolveDesignMaterial(design, id);
        if (resolved.status === 'missing') return c.error;
        const mat = getMaterialById(id) || resolved.material;
        return mat ? resolveColor(mat) : '#888';
    };

    return h('div', { style: overlay, onMouseDown: (e) => { if (e.target === e.currentTarget) onClose(); } },
        h('div', { style: panel },
            h('h2', { style: { marginTop: 0, marginBottom: 6, fontSize: 17, fontWeight: 'bold', color: c.text } },
                rm.title),
            h('p', { style: { marginTop: 0, marginBottom: 16, fontSize: 12, color: c.textDim, lineHeight: 1.4 } },
                rm.desc),

            used.length === 0
                ? h('div', { style: { padding: '18px 4px', fontSize: 13, color: c.textDim, textAlign: 'center' } },
                    rm.none)
                : h('div', null,
                    // Column headers
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6,
                        fontSize: 10, fontWeight: 600, color: c.textDim, textTransform: 'uppercase', letterSpacing: 0.5 } },
                        h('span', { style: { flex: 1 } }, rm.from),
                        h('span', { style: { width: 18, textAlign: 'center' } }, '→'),
                        h('span', { style: { flex: 1 } }, rm.to)),
                    used.map(m => h('div', { key: m.id,
                        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 } },
                        // Current material (static)
                        h('div', { style: { flex: 1, display: 'flex', alignItems: 'center', gap: 6, minWidth: 0,
                            height: 22, padding: '0 4px', border: `1px solid ${c.border}`, borderRadius: 3,
                            backgroundColor: c.bg } },
                            h('span', { style: { width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
                                backgroundColor: colorOf(m.id) } }),
                            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap', fontSize: 12, color: c.text } }, nameOf(m.id)),
                            h('span', { style: { fontSize: 10, color: c.textDim, flexShrink: 0 },
                                title: rm.usageTip }, rm.usage(m.count))),
                        h('span', { style: { width: 18, textAlign: 'center', color: c.textDim, flexShrink: 0 } }, '→'),
                        // Replacement picker (same control the layer rows use)
                        h('div', { style: { flex: 1, minWidth: 0 } },
                            h(MaterialPicker, {
                                value: repl[m.id] || m.id, c, t,
                                onChange: (newId) => setRepl(prev => ({ ...prev, [m.id]: newId })),
                            })))),
                ),

            h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 } },
                h('button', { onClick: onClose, style: btn(false) }, rm.cancel),
                h('button', { onClick: apply, disabled: changed.length === 0, style: btn(true) },
                    changed.length ? rm.applyN(changed.length) : rm.apply))
        )
    );
}
