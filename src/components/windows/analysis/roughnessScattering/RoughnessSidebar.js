import { numField } from './controls.js';

const { createElement: h } = React;

function InterfaceControls(props) {
    const {
        activeSides, hasBack, labels, rough, setInterfaceSigma,
        c, rs, inputStyle, sectionTitle,
    } = props;
    return activeSides.filter(side => side === 'front' || hasBack).map(side => {
        const key = side === 'back' ? 'backSigmas' : 'sigmas';
        const sideLabels = side === 'back' ? labels.back : labels.front;
        const sideTitle = side === 'back'
            ? (rs.backInterfaces || 'Back-stack interfaces')
            : (activeSides.length > 1 ? (rs.frontInterfaces || 'Front-stack interfaces') : null);
        return h('div', { key: side },
            sideTitle && h('div', { style: { ...sectionTitle, margin: '4px 0 2px' } }, sideTitle),
            h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: 11 } },
                h('thead', null, h('tr', { style: { background: c.bg, color: c.textDim } },
                    h('th', { style: { textAlign: 'left', padding: '3px 4px' } }, rs.interface || 'Interface'),
                    h('th', { style: { textAlign: 'right', padding: '3px 4px' } }, 'σ (nm)'),
                )),
                h('tbody', null, sideLabels.map((label, index) => {
                    const sigma = rough[key]?.[index] !== undefined ? rough[key][index] : (rough.sigma ?? 0);
                    return h('tr', { key: index, style: { borderBottom: `1px solid ${c.border}` } },
                        h('td', { style: { padding: '3px 4px', color: c.text } }, label.label),
                        h('td', { style: { padding: '3px 4px', textAlign: 'right' } },
                            numField(sigma, value => setInterfaceSigma(side, index, value), { ...inputStyle, width: 56 }, { fallback: 0 })
                        ),
                    );
                }))
            )
        );
    });
}

export function RoughnessSidebar(props) {
    const {
        c, rs, rough, setMode, setUniformSigma, calc,
        labelStyle, inputStyle, segBtnStyle, sectionTitle,
    } = props;
    return h('div', {
        style: {
            width: 260, flexShrink: 0, borderRight: `1px solid ${c.border}`,
            background: c.panel, overflowY: 'auto',
        }
    },
        h('div', { style: sectionTitle }, rs.modeSection || 'Roughness model'),
        h('div', { style: { padding: '4px 8px 8px', display: 'flex', gap: 4 } },
            h('button', { onClick: () => setMode('uniform'), style: segBtnStyle(rough.mode === 'uniform') }, rs.uniform || 'Uniform σ'),
            h('button', { onClick: () => setMode('perInterface'), style: segBtnStyle(rough.mode === 'perInterface') }, rs.perInterface || 'Per-interface'),
        ),
        rough.mode === 'uniform' && h('div', { style: { padding: '0 8px 10px' } },
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 } },
                h('span', { style: labelStyle }, 'σ'),
                numField(rough.sigma, setUniformSigma, { ...inputStyle, width: 72 }, { fallback: 0 }),
                h('span', { style: labelStyle }, 'nm'),
            ),
            h('input', {
                type: 'range', min: 0, max: 20, step: 0.1, value: rough.sigma,
                onChange: event => setUniformSigma(parseFloat(event.target.value) || 0),
                style: { width: '100%', accentColor: c.accent }
            }),
            h('div', { style: { color: c.textDim, fontSize: 10, marginTop: 4 } },
                rs.uniformHelp || 'Applied identically to all interfaces. Typical substrate ≈ 0.5–2 nm; PVD layers add ~0.3–0.8 nm each.'
            ),
        ),
        rough.mode === 'perInterface' && h('div', { style: { padding: '0 8px 10px' } },
            ...InterfaceControls(props)
        ),
        h('div', { style: sectionTitle }, rs.outputSection || 'Output summary'),
        h('div', { style: { padding: '0 8px 12px', fontSize: 11, color: c.text, lineHeight: 1.6 } },
            calc
                ? h('div', null,
                    h('div', null, `σ_eff = ${calc.sigmaEff.toFixed(3)} nm`),
                    h('div', null, `TIS(λ_min) = ${(calc.TIS_inc[0] * 1e6).toFixed(1)} ppm`),
                    h('div', null, `TIS(λ_max) = ${(calc.TIS_inc[calc.TIS_inc.length - 1] * 1e6).toFixed(1)} ppm`),
                  )
                : h('div', { style: { color: c.textDim, fontStyle: 'italic' } }, '—')
        ),
        h('div', {
            style: {
                padding: '8px', fontSize: 10, color: c.textDim, lineHeight: 1.5,
                borderTop: `1px solid ${c.border}`,
            }
        }, rs.helpText ||
          'Uncorrelated roughness model: TIS = R · (4πσ_eff cosθ/λ)² (Macleod Eq. 16.30). σ_eff² = Σσ_i² across all interfaces.')
    );
}
