import { Btn, Label, Num, Seg } from './ui.js';

const { createElement: h } = React;

function ExportOptions({ c, z, thMode, setThMode, scope, setScope, coatName, setCoatName }) {
    return h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center' } },
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Label, { c }, z.thicknessMode),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: thMode === 'absolute', onClick: () => setThMode('absolute'), c, position: 'first' }, z.thicknessAbs),
                h(Seg, { active: thMode === 'relative', onClick: () => setThMode('relative'), c, position: 'last' }, z.thicknessRel),
            ),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Label, { c }, z.materialScope),
            h('div', { style: { display: 'flex' } },
                h(Seg, { active: scope === 'used', onClick: () => setScope('used'), c, position: 'first' }, z.scopeUsed),
                h(Seg, { active: scope === 'all', onClick: () => setScope('all'), c, position: 'last' }, z.scopeAll),
            ),
        ),
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: 4 } },
            h(Label, { c }, z.coatingName),
            h('input', {
                value: coatName, onChange: (event) => setCoatName(event.target.value),
                style: { height: 24, width: 180, background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, padding: '0 6px', outline: 'none' },
            }),
        ),
    );
}

function SampleGrid({ c, z, gStart, setGStart, gEnd, setGEnd, gStep, setGStep }) {
    return h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        h(Label, { c }, z.sampleGrid),
        h(Label, { c }, z.from), h(Num, { value: gStart, onChange: setGStart, min: 100, max: 30000, step: 10, c, width: 64 }),
        h(Label, { c }, z.to), h(Num, { value: gEnd, onChange: setGEnd, min: 100, max: 30000, step: 10, c, width: 64 }),
        h(Label, { c }, z.step), h(Num, { value: gStep, onChange: setGStep, min: 1, max: 1000, step: 5, c, width: 56 }),
    );
}

export function ExportTab(props) {
    const {
        c, z, design, thMode, gStart, gEnd, gStep, scope, coatName,
        preview, onGenerate, onSave, refNm,
    } = props;
    const layerCount = (design.frontLayers || []).length;
    return h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10, height: '100%' } },
        h('div', { style: { fontSize: 12, fontWeight: 600 } }, z.exportTitle),
        h('div', { style: { fontSize: 10.5, color: c.textDim } }, `${layerCount} front-coating layer${layerCount === 1 ? '' : 's'}`),
        h(ExportOptions, props),
        h(SampleGrid, props),
        h('div', { style: { fontSize: 10.5, color: c.textDim } },
            thMode === 'absolute' ? z.thicknessAbsHint : `${z.thicknessRelHint}  (λ₀ = ${refNm} nm)`),
        h('div', { style: { display: 'flex', gap: 8 } },
            h(Btn, { onClick: onGenerate, c, primary: true }, z.generate),
            h(Btn, { onClick: onSave, c, disabled: !preview }, z.saveBtn),
        ),
        h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', minHeight: 120 } },
            h(Label, { c }, z.preview),
            h('textarea', {
                value: preview, readOnly: true, spellCheck: false,
                style: {
                    flex: 1, marginTop: 4, width: '100%', resize: 'none',
                    background: c.bg, color: c.text, border: `1px solid ${c.border}`, borderRadius: 4,
                    fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 10.5, padding: 8, outline: 'none', whiteSpace: 'pre',
                },
            }),
        ),
    );
}
