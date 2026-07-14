import { Divider, FieldLabel, NumInput, SegBtn } from './controls.js';

const { createElement: h } = React;

export function SetupToolbar({ c, sp, setup, hasActive, save }) {
    return h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '6px 10px',
            backgroundColor: c.panel,
            borderBottom: `1px solid ${c.border}`,
            flexWrap: 'wrap', flexShrink: 0,
        },
    },
        h(FieldLabel, { c }, sp.activeSide),
        h('div', { style: { display: 'flex' } },
            h(SegBtn, { active: setup.activeSide === 'front', onClick: () => setup.setActiveSide('front'), c, position: 'first' }, sp.front),
            h(SegBtn, { active: setup.activeSide === 'back', onClick: () => setup.setActiveSide('back'), c, position: 'last' }, sp.back),
        ),
        h(Divider, { c }),
        h(FieldLabel, { c }, sp.secondSurface),
        h('div', { style: { display: 'flex' } },
            h(SegBtn, { active: setup.secondSurface === 'bare', onClick: () => setup.setSecondSurface('bare'), c, position: 'first' }, sp.bare),
            h(SegBtn, { active: setup.secondSurface === 'coated', onClick: () => setup.setSecondSurface('coated'), c, position: 'last' }, sp.coated),
        ),
        h(Divider, { c }),
        h(FieldLabel, { c }, sp.quantity),
        h('div', { style: { display: 'flex' } },
            h(SegBtn, { active: setup.quantity === 'T', onClick: () => setup.setQuantity('T'), c, position: 'first' }, 'T'),
            h(SegBtn, { active: setup.quantity === 'R', onClick: () => setup.setQuantity('R'), c }, 'R'),
            h(SegBtn, { active: setup.quantity === 'A', onClick: () => setup.setQuantity('A'), c, position: 'last' }, 'A'),
        ),
        h(Divider, { c }),
        h(FieldLabel, { c }, sp.aoi),
        h(NumInput, { value: setup.aoi, onChange: setup.setAoi, min: 0, max: 89, step: 1, c, width: 56 }),
        h(Divider, { c }),
        h(FieldLabel, { c }, sp.polarization),
        h('div', { style: { display: 'flex' } },
            h(SegBtn, { active: setup.polarization === 'avg', onClick: () => setup.setPolarization('avg'), c, position: 'first' }, sp.polAvg),
            h(SegBtn, { active: setup.polarization === 's', onClick: () => setup.setPolarization('s'), c }, 's'),
            h(SegBtn, { active: setup.polarization === 'p', onClick: () => setup.setPolarization('p'), c, position: 'last' }, 'p'),
        ),
        h('div', { style: { flex: 1 } }),
        h('button', {
            onClick: save.handleSave, disabled: !hasActive || save.saving,
            title: sp.saveBtn,
            style: {
                padding: '5px 12px', fontSize: 12,
                border: 'none', borderRadius: 4,
                backgroundColor: hasActive ? c.accent : c.border,
                color: hasActive ? '#fff' : c.textDim,
                cursor: hasActive ? 'pointer' : 'not-allowed',
                opacity: save.saving ? 0.6 : 1,
                fontWeight: 600, whiteSpace: 'nowrap',
            },
        }, save.saving ? sp.saving : sp.saveBtn),
    );
}
