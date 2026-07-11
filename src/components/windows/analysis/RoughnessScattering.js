/**
 * Interface Roughness / Scattering window — visualize TIS(λ) and the
 * effective specular R/T after scattering loss, given per-interface or
 * uniform rms surface roughness σ.
 *
 *   TIS(λ) = R(λ) · (4π · σ_eff · cosθ / λ)²       (Macleod Eq. 16.30)
 *   σ_eff² = Σ σ_i²                                 (uncorrelated case)
 *
 * Reference: Macleod 5th ed. §16 "Scattering"; chunk 580 (Eq. 16.30) and
 * chunks 579–582 via the thinfilm-book MCP. v1 supports the uncorrelated
 * case only; correlated roughness, field-weighted per-interface TIS, and
 * angle-resolved scattering (ARS) are deferred to v2.
 */

import { useDesign }       from '../../../state/DesignContext.js';
import { EvalModeBadge }   from '../../SurfaceModeBar.js';
import { getMaterialById } from '../../../utils/materials/catalogManager.js';
import { getMaterial }     from '../../../utils/materials/materialDatabase.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../../utils/physics/thinFilmMath.js';
import { enumerateInterfaces } from '../../../utils/physics/inhomogeneity.js';
import {
    emptyRoughness, cloneRoughness, resolveSigmas, effectiveRoughness,
    tisSpectrum, applyScatteringLoss, countInterfaces,
} from '../../../utils/physics/scattering.js';
import { DebouncedInput } from '../../ui/DebouncedInput.js';

const { createElement: h, useState, useEffect, useMemo, useRef, useCallback } = React;

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

// Free-editing number field (DebouncedInput): clearable while typing, commits the
// parsed value on blur/Enter, empty/invalid → fallback. Replaces the controlled
// `parseFloat(e.target.value)||x` inputs that refused to go empty.
function numField(value, onNum, style, { fallback = 0, int = false } = {}) {
    return h(DebouncedInput, {
        value: String(value),
        onChange: (v) => {
            const s = String(v).trim();
            const n = s === '' ? fallback : (int ? parseInt(v, 10) : parseFloat(v));
            onNum(Number.isFinite(n) ? n : fallback);
        },
        style,
    });
}

// Per-design state cache (survives docking switches; matches Variator pattern)
const _scatterCache = new Map();

// ── Chart ────────────────────────────────────────────────────────────────────

function ScatterChart({ lambda, R, T, R_spec, T_spec, TIS_inc, units, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const traces = useMemo(() => {
        if (!lambda?.length) return [];
        const tisScale = units === 'ppm' ? 1e6 : 1;
        const tisName  = units === 'ppm' ? 'TIS (ppm)' : 'TIS (frac)';

        // R / T are fractions [0,1]; render the specular axis in percent to match
        // the rest of the app (TIS keeps its own ppm/fraction axis).
        const pct = (arr) => arr.map(v => v * 100);
        return [
            // Faint baseline R / T
            { x: lambda, y: pct(R), type: 'scatter', mode: 'lines', name: 'R (ideal)',
              line: { color: '#ef5350', dash: 'dot', width: 1.2 }, opacity: 0.6, hoverinfo: 'skip' },
            { x: lambda, y: pct(T), type: 'scatter', mode: 'lines', name: 'T (ideal)',
              line: { color: '#4fc3f7', dash: 'dot', width: 1.2 }, opacity: 0.6, hoverinfo: 'skip' },
            // Specular R / T after scatter loss
            { x: lambda, y: pct(R_spec), type: 'scatter', mode: 'lines', name: 'R spec',
              line: { color: '#ef5350', width: 2 },
              hovertemplate: 'λ=%{x:.1f} nm<br>R_spec=%{y:.3f}%<extra></extra>' },
            { x: lambda, y: pct(T_spec), type: 'scatter', mode: 'lines', name: 'T spec',
              line: { color: '#4fc3f7', width: 2 },
              hovertemplate: 'λ=%{x:.1f} nm<br>T_spec=%{y:.3f}%<extra></extra>' },
            // TIS on a secondary y-axis
            { x: lambda, y: TIS_inc.map(v => v * tisScale), type: 'scatter', mode: 'lines',
              name: tisName, yaxis: 'y2',
              line: { color: '#ffb74d', width: 2 },
              hovertemplate: `λ=%{x:.1f} nm<br>TIS=%{y:.2f} ${units}<extra></extra>` },
        ];
    }, [lambda, R, T, R_spec, T_spec, TIS_inc, units]);

    const layout = useMemo(() => ({
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor:  c.bg    || '#1e1e1e',
        margin: { l: 56, r: 64, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'R, T specular (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102],
        },
        yaxis2: {
            title: { text: units === 'ppm' ? 'TIS (ppm)' : 'TIS (fraction)',
                     font: { color: '#ffb74d', size: 12 } },
            color: '#ffb74d', gridcolor: 'rgba(255,183,77,0.15)',
            tickfont: { color: '#ffb74d', size: 10 },
            overlaying: 'y', side: 'right', rangemode: 'tozero',
        },
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
        hovermode: 'x unified',
    }), [c, units]);

    useEffect(() => {
        if (!divRef.current || typeof Plotly === 'undefined') return;
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [traces, layout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Main window ──────────────────────────────────────────────────────────────

export function RoughnessScattering({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const rs = (t && t.roughnessScattering) || {};

    // ── State ────────────────────────────────────────────────────────────────
    const [rough, setRough] = useState(() => {
        const cached = design && _scatterCache.get(design.id);
        return cached ? cloneRoughness(cached) : emptyRoughness();
    });

    // Rehydrate per design
    useEffect(() => {
        if (!design) return;
        const cached = _scatterCache.get(design.id);
        setRough(cached ? cloneRoughness(cached) : emptyRoughness());
    }, [design?.id]);

    useEffect(() => {
        if (!design) return;
        _scatterCache.set(design.id, cloneRoughness(rough));
    }, [rough, design?.id]);

    const [lambdaStart, setLambdaStart] = useState(400);
    const [lambdaEnd,   setLambdaEnd]   = useState(800);
    const [lambdaStep,  setLambdaStep]  = useState(5);
    const [aoi,         setAoi]         = useState(0);
    const [pol,         setPol]         = useState('avg');
    const [units,       setUnits]       = useState('ppm');

    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);

    // Which coating side(s) the current evaluation target touches. Roughness is
    // configured on exactly those interfaces, matching what the spectrum shows:
    //   front → front stack · back → back stack · total/both → both stacks.
    const hasBack = (design?.backLayers?.length || 0) > 0;
    const activeSides = evalMode === 'back'
        ? ['back']
        : evalMode === 'total'
            ? (hasBack ? ['front', 'back'] : ['front'])
            : ['front'];

    const frontN = countInterfaces(design?.frontLayers?.length || 0);
    const backN  = hasBack ? countInterfaces(design.backLayers.length) : 0;
    // Interfaces actually contributing to σ_eff in the current mode.
    const nIfaces = activeSides.reduce((s, side) => s + (side === 'back' ? backN : frontN), 0);

    // Interface labels per side (front: Inc→…→Sub; back: Sub→…→Exit, since back
    // layers are stored substrate→exit — Macleod §2.6).
    const frontIfaceLabels = useMemo(() => {
        if (!design?.frontLayers) return [];
        const layers = design.frontLayers.map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        return enumerateInterfaces(layers, design.incidentMedium || 'Inc', design.substrate?.material || 'Sub');
    }, [design]);
    const backIfaceLabels = useMemo(() => {
        if (!design?.backLayers?.length) return [];
        const layers = design.backLayers.map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
        return enumerateInterfaces(layers, design.substrate?.material || 'Sub', design.exitMedium || 'Exit');
    }, [design]);
    const labelsFor = (side) => (side === 'back' ? backIfaceLabels : frontIfaceLabels);

    // ── Spectrum + scatter calc ────────────────────────────────────────────
    // Returns { data, error } so the error is memo DATA, not setState-during-render
    // (which warns and never cleared on success — same class as LayerSensitivity).
    const calcM = useMemo(() => {
        if (!design?.frontLayers) return { data: null, error: null };
        try {
            const incMat  = resolveMaterial(design.incidentMedium);
            const subMat  = resolveMaterial(design.substrate?.material);
            const exitMat = resolveMaterial(design.exitMedium);
            const subThk  = design.substrate?.thickness ?? 1.0;
            const frontRaw = (design.frontLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
            const backRaw = (design.backLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));

            // Per-side σ list (uniform mode shares the single σ across both stacks).
            const sigForSide = (side, n) => resolveSigmas(
                { mode: rough.mode, sigma: rough.sigma, sigmas: side === 'back' ? rough.backSigmas : rough.sigmas }, n);

            let spec, sigmaList;
            if (evalMode === 'back') {
                spec = evaluateSpectrumBack(params, exitMat, subMat, backRaw);
                sigmaList = sigForSide('back', backN);
            } else if (evalMode === 'total') {
                spec = evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontRaw, backRaw, subThk);
                // Uncorrelated system roughness: σ_eff² = Σσ² over BOTH stacks'
                // interfaces (Macleod Eq. 16.30 summed across the whole system).
                sigmaList = [...sigForSide('front', frontN), ...(hasBack ? sigForSide('back', backN) : [])];
            } else {
                spec = evaluateSpectrum(params, incMat, subMat, frontRaw);
                sigmaList = sigForSide('front', frontN);
            }

            const sigmaEff = effectiveRoughness(sigmaList);
            const TIS_per_R = tisSpectrum(spec.lambda, sigmaEff, aoi, null);
            const TIS_inc = tisSpectrum(spec.lambda, sigmaEff, aoi, spec.R);
            const { R_spec, T_spec } = applyScatteringLoss(spec.lambda, spec.R, spec.T, sigmaEff, aoi);

            return { data: {
                lambda: spec.lambda,
                R: spec.R, T: spec.T,
                R_spec, T_spec,
                TIS_per_R, TIS_inc,
                sigmaEff,
                sigmas: sigmaList,
            }, error: null };
        } catch (e) {
            return { data: null, error: e.message || String(e) };
        }
    }, [design, params, rough, evalMode, aoi, frontN, backN, hasBack]);

    const calc = calcM.data;
    const error = calcM.error;

    // ── Sidebar update helpers ─────────────────────────────────────────────
    const setMode = useCallback((m) => setRough(r => ({ ...r, mode: m })), []);
    const setUniformSigma = useCallback((v) => {
        setRough(r => ({ ...r, sigma: Math.max(0, v) }));
    }, []);
    const setInterfaceSigma = useCallback((side, i, v) => {
        const key = side === 'back' ? 'backSigmas' : 'sigmas';
        setRough(r => {
            const arr = (r[key] || []).slice();
            while (arr.length <= i) arr.push(r.sigma ?? 0);
            arr[i] = Math.max(0, v);
            return { ...r, mode: 'perInterface', [key]: arr };
        });
    }, []);
    const clearAll = useCallback(() => setRough(emptyRoughness()), []);

    // ── Render guards ──────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);
    if (!design) return placeholder(rs.noDesign || 'No design selected.');
    if (!design.frontLayers?.length) return placeholder(rs.noLayers || 'No layers in design.');

    // ── Styles ─────────────────────────────────────────────────────────────
    const labelStyle = { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        whiteSpace: 'nowrap',
    });
    const sectionTitle = {
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.4, color: c.textDim, margin: '6px 8px 4px',
    };

    // ── Toolbar ────────────────────────────────────────────────────────────
    const toolbar = h('div', {
        style: {
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '5px 10px', borderBottom: `1px solid ${c.border}`,
            background: c.panel, flexShrink: 0, fontSize: 11,
        }
    },
        // Evaluation target — read-only, set in the Design Editor.
        h(EvalModeBadge, { design, c, t }),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('label', { style: labelStyle }, 'λ',
            numField(lambdaStart, setLambdaStart, { ...inputStyle, marginLeft: 4 }, { fallback: 0 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            numField(lambdaEnd, setLambdaEnd, inputStyle, { fallback: 0 }),
            h('span', { style: { marginLeft: 4 } }, 'nm'),
        ),
        h('label', { style: labelStyle }, rs.step || 'step',
            numField(lambdaStep, setLambdaStep, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 1 })
        ),
        h('label', { style: labelStyle }, 'AOI',
            numField(aoi, setAoi, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 0 }),
            h('span', null, '°'),
        ),
        h('label', { style: labelStyle }, 'pol',
            h('select', { value: pol, onChange: e => setPol(e.target.value), style: { ...inputStyle, width: 'auto', marginLeft: 4 } },
                ['avg', 's', 'p'].map(p => h('option', { key: p, value: p }, p)))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            h('button', { onClick: () => setUnits('ppm'),  style: segBtnStyle(units === 'ppm')  }, 'ppm'),
            h('button', { onClick: () => setUnits('frac'), style: segBtnStyle(units === 'frac') }, 'frac'),
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('button', {
            onClick: clearAll,
            style: {
                padding: '2px 8px', background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11, cursor: 'pointer',
            }
        }, rs.clear || 'Reset'),
        h('span', { style: { marginLeft: 'auto', color: c.textDim, fontSize: 11 } },
            calc ? `σ_eff = ${calc.sigmaEff.toFixed(2)} nm  ·  ${nIfaces} ${rs.interfaces || 'interfaces'}` : ''
        ),
    );

    // ── Sidebar ────────────────────────────────────────────────────────────
    const sidebar = h('div', {
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
                onChange: e => setUniformSigma(parseFloat(e.target.value) || 0),
                style: { width: '100%', accentColor: c.accent }
            }),
            h('div', { style: { color: c.textDim, fontSize: 10, marginTop: 4 } },
                rs.uniformHelp || 'Applied identically to all interfaces. Typical substrate ≈ 0.5–2 nm; PVD layers add ~0.3–0.8 nm each.'
            ),
        ),
        rough.mode === 'perInterface' && h('div', { style: { padding: '0 8px 10px' } },
            ...activeSides.filter(side => side === 'front' || hasBack).map(side => {
                const key = side === 'back' ? 'backSigmas' : 'sigmas';
                const labels = labelsFor(side);
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
                        h('tbody', null, labels.map((lbl, i) => {
                            const sig = (rough[key]?.[i] !== undefined) ? rough[key][i] : (rough.sigma ?? 0);
                            return h('tr', { key: i, style: { borderBottom: `1px solid ${c.border}` } },
                                h('td', { style: { padding: '3px 4px', color: c.text } }, lbl.label),
                                h('td', { style: { padding: '3px 4px', textAlign: 'right' } },
                                    numField(sig, (v) => setInterfaceSigma(side, i, v), { ...inputStyle, width: 56 }, { fallback: 0 })
                                ),
                            );
                        }))
                    )
                );
            }),
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

    // ── Layout ─────────────────────────────────────────────────────────────
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        toolbar,
        (activeSides.includes('back') && !hasBack) && h('div', {
            style: {
                padding: '6px 12px', background: '#5a4a1a', color: '#ffe08a',
                borderBottom: `1px solid ${c.border}`, fontSize: 11, flexShrink: 0,
            }
        }, rs.noBackLayers || 'This evaluation includes the back coating, but the design has no back layers. Add a back coating in the Design Editor to model its roughness.'),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            sidebar,
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                error && h('div', {
                    style: {
                        position: 'absolute', top: 8, left: 8, right: 8,
                        padding: '6px 10px', background: '#5a1a1a', color: '#fff',
                        border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
                    }
                }, error),
                calc
                    ? h(ScatterChart, {
                        lambda: calc.lambda, R: calc.R, T: calc.T,
                        R_spec: calc.R_spec, T_spec: calc.T_spec,
                        TIS_inc: calc.TIS_inc,
                        units, c,
                    })
                    : placeholder(rs.computing || 'Computing…')
            ),
        )
    );
}
