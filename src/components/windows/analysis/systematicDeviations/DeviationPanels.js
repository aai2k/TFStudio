import { NumberInput, UnitSelect, controlStyles } from './ui.js';

const { createElement: h } = React;

export function GlobalDeviationPanel({ controller, c, sd }) {
    const { dev, updateGlobal } = controller;
    const { sectionTitle, fieldRow, lbl, unit } = controlStyles(c);
    return h('div', { style: { padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`, flexShrink: 0 } },
        h('div', { style: sectionTitle }, sd.globalSection || 'Global deviation'),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, sd.thkScale || 'd × scale'),
            h(NumberInput, { value: dev.globalThicknessScale, step: 0.005, min: 0.5, max: 2.0,
                onChange: (value) => updateGlobal('globalThicknessScale', value), c }),
            h('span', { style: unit }, '×'),
        ),
        h('div', { style: fieldRow, title: sd.thkOffsetTip || 'Flat thickness offset added to every layer after the scale: d′ = d·scale + offset. Units: nm (physical), OT (optical thickness, nm), QW (quarter-waves) or FW (full-waves) at the design reference λ₀ — optical units convert to physical nm per layer via n(λ₀).' },
            h('span', { style: lbl }, sd.thkOffset || 'd + offset'),
            h(NumberInput, { value: dev.globalThicknessOffset || 0, step: 1,
                onChange: (value) => updateGlobal('globalThicknessOffset', value), c }),
            h(UnitSelect, { value: dev.globalThicknessOffsetUnit || 'nm',
                onChange: (value) => updateGlobal('globalThicknessOffsetUnit', value), c }),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δn'),
            h(NumberInput, { value: dev.globalDeltaN, step: 0.005,
                onChange: (value) => updateGlobal('globalDeltaN', value), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δk'),
            h(NumberInput, { value: dev.globalDeltaK, step: 0.0005,
                onChange: (value) => updateGlobal('globalDeltaK', value), c }),
            h('span', { style: unit }, ''),
        ),
    );
}

function MaterialFields({ id, source, deviation, updateMat, c, sd }) {
    const { fieldRow, lbl, unit } = controlStyles(c);
    return h('div', { style: { marginBottom: 8 } },
        h('div', { style: { fontSize: 11, fontWeight: 600, color: c.text, marginBottom: 2 } },
            id, h('span', { style: { fontWeight: 400, color: c.textDim, marginLeft: 4 } }, `(${source})`),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'd × scale'),
            h(NumberInput, { value: deviation.dScale ?? 1, step: 0.005, min: 0.5, max: 2.0,
                onChange: (value) => updateMat(id, 'dScale', value), c }),
            h('span', { style: unit }, '×'),
        ),
        h('div', { style: fieldRow, title: sd.thkOffsetTip || 'Flat thickness offset for this material, added after the scale (combines additively with the global offset). Units: nm / OT / QW / FW at the design reference λ₀.' },
            h('span', { style: lbl }, sd.thkOffset || 'd + offset'),
            h(NumberInput, { value: deviation.dOffset || 0, step: 1,
                onChange: (value) => updateMat(id, 'dOffset', value), c }),
            h(UnitSelect, { value: deviation.dOffsetUnit || 'nm',
                onChange: (value) => updateMat(id, 'dOffsetUnit', value), c }),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δn'),
            h(NumberInput, { value: deviation.dn || 0, step: 0.005,
                onChange: (value) => updateMat(id, 'dn', value), c }),
            h('span', { style: unit }, ''),
        ),
        h('div', { style: fieldRow },
            h('span', { style: lbl }, 'Δk'),
            h(NumberInput, { value: deviation.dk || 0, step: 0.0005,
                onChange: (value) => updateMat(id, 'dk', value), c }),
            h('span', { style: unit }, ''),
        ),
    );
}

export function PerMaterialPanel({ controller, c, sd }) {
    const { dev, uniqueMats, updateMat } = controller;
    const { sectionTitle } = controlStyles(c);
    return h('div', {
        style: {
            padding: '6px 8px 10px', borderBottom: `1px solid ${c.border}`,
            flex: 1, minHeight: 80, overflowY: 'auto',
        }
    },
        h('div', { style: sectionTitle }, sd.perMaterialSection || 'Per-material'),
        uniqueMats.length === 0
            ? h('div', { style: { color: c.textDim, fontSize: 11 } }, sd.noMaterials || 'No materials in design')
            : uniqueMats.map(({ id, source }) => h(MaterialFields, {
                key: id,
                id,
                source,
                deviation: dev.perMaterial?.[id] || { dn: 0, dk: 0, dScale: 1, dOffset: 0, dOffsetUnit: 'nm' },
                updateMat,
                c,
                sd,
            }))
    );
}
