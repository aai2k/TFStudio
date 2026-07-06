/**
 * Inhomogeneities & Interlayers window — configure graded transition layers
 * at every interface in the front stack and visualize the resulting spectrum
 * vs the homogeneous baseline.
 *
 * Two modes of effect on the design:
 *   - **Preview only** (default) — interlayers live in window-local state and
 *     are applied only to this window's spectrum overlay. The design is not
 *     mutated. Other windows see the homogeneous spectrum.
 *   - **Apply to design** — bake the interlayers into the front/back stack
 *     as real homogeneous sub-layers, then clear the local interlayer config.
 *     One undo checkpoint is pushed before mutating.
 *
 * Reference: Macleod 5th ed. "Inhomogeneous Layers".
 */

import { useDesign }       from '../../state/DesignContext.js';
import { EvalModeBadge }   from '../SurfaceModeBar.js';
import { getMaterialById } from '../../utils/materials/catalogManager.js';
import { getMaterial }     from '../../utils/materials/materialDatabase.js';
import { SpecVerdict }     from '../SpecVerdict.js';
import {
    evaluateSpectrum, evaluateSpectrumBack, evaluateSpectrumTotal,
} from '../../utils/physics/thinFilmMath.js';
import {
    emptyInhomogeneity, cloneInhomogeneity,
    PROFILE_IDS,
    expandLayersWithInterlayers, enumerateInterfaces, totalInterlayerThickness,
} from '../../utils/physics/inhomogeneity.js';
import { DebouncedInput } from '../ui/DebouncedInput.js';
import { Checkbox } from '../ui/Checkbox.js';

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

// Window-local cache so interlayer config survives docking-window switches
// per design. Same pattern Variator/Refinement use.
const _inhomCache = new Map();

// ── Spectrum overlay chart ──────────────────────────────────────────────────

function OverlayChart({ baseline, perturbed, channel, c }) {
    const divRef = useRef(null);
    const initRef = useRef(false);

    const traces = useMemo(() => {
        if (!perturbed) return [];
        const cFor = { T: '#4fc3f7', R: '#ef5350', A: '#66bb6a' };
        const out = [];
        const wantedKeys = channel === 'all' ? ['T', 'R', 'A'] : [channel];
        // Spectra are fractions [0,1]; render in percent to match the rest of the app.
        const pct = (arr) => arr.map(v => v * 100);
        for (const k of wantedKeys) {
            if (baseline) {
                out.push({
                    x: baseline.lambda, y: pct(baseline[k]),
                    type: 'scatter', mode: 'lines',
                    name: `${k} homogeneous`,
                    line: { color: cFor[k], dash: 'dot', width: 1.4 },
                    hoverinfo: 'skip',
                    opacity: 0.55,
                });
            }
            out.push({
                x: perturbed.lambda, y: pct(perturbed[k]),
                type: 'scatter', mode: 'lines',
                name: `${k} with interlayers`,
                line: { color: cFor[k], width: 2 },
                hovertemplate: `λ=%{x:.1f} nm<br>${k}=%{y:.3f}%<extra></extra>`,
            });
        }
        return out;
    }, [baseline, perturbed, channel]);

    const layout = useMemo(() => ({
        paper_bgcolor: c.panel || '#252526',
        plot_bgcolor:  c.bg    || '#1e1e1e',
        margin: { l: 56, r: 16, t: 16, b: 44 },
        xaxis: {
            title: { text: 'λ (nm)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
        },
        yaxis: {
            title: { text: 'T / R / A (%)', font: { color: c.text, size: 12 } },
            color: c.text, gridcolor: c.border, zerolinecolor: c.border,
            tickfont: { color: c.text, size: 10 },
            range: [0, 102],
        },
        legend: { orientation: 'h', x: 0, y: 1.08, font: { color: c.text, size: 10 }, bgcolor: 'rgba(0,0,0,0)' },
        hovermode: 'x unified',
    }), [c]);

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

export function Inhomogeneities({ c, theme, t }) {
    const { design, evalMode } = useDesign();
    const ih = (t && t.inhomogeneities) || {};

    const [inh, setInh] = useState(() => {
        const cached = design && _inhomCache.get(design.id);
        return cached ? cloneInhomogeneity(cached) : emptyInhomogeneity();
    });

    // Rehydrate from cache when design changes
    useEffect(() => {
        if (!design) return;
        const cached = _inhomCache.get(design.id);
        setInh(cached ? cloneInhomogeneity(cached) : emptyInhomogeneity());
    }, [design?.id]);

    // Persist to cache on change
    useEffect(() => {
        if (!design) return;
        _inhomCache.set(design.id, cloneInhomogeneity(inh));
    }, [inh, design?.id]);

    const [channel, setChannel] = useState('all');
    const [lambdaStart, setLambdaStart] = useState(400);
    const [lambdaEnd,   setLambdaEnd]   = useState(800);
    const [lambdaStep,  setLambdaStep]  = useState(5);
    const [aoi,         setAoi]         = useState(0);
    const [pol,         setPol]         = useState('avg');
    const [error,       setError]       = useState(null);

    // Which coating side(s) the current evaluation target touches — interlayers
    // are configurable on exactly those sides, matching what the spectrum shows:
    //   front → front stack · back → back stack · total/both → both stacks.
    const hasBack    = (design?.backLayers?.length || 0) > 0;
    const activeSides = evalMode === 'back'
        ? ['back']
        : evalMode === 'total'
            ? (hasBack ? ['front', 'back'] : ['front'])
            : ['front'];

    // ── Interface enumeration (front: Inc→…→Sub; back: Sub→…→Exit) ────────────
    // backLayers are stored substrate→exit, so the back stack's "incident" medium
    // is the substrate and its "exit" medium is design.exitMedium (Macleod §2.6).
    const frontIfaces = useMemo(() => {
        if (!design?.frontLayers) return [];
        return enumerateInterfaces(design.frontLayers, design.incidentMedium || 'Inc',
                                   design.substrate?.material || 'Sub');
    }, [design]);
    const backIfaces = useMemo(() => {
        if (!design?.backLayers?.length) return [];
        return enumerateInterfaces(design.backLayers, design.substrate?.material || 'Sub',
                                   design.exitMedium || 'Exit');
    }, [design]);
    const ifacesFor = (side) => (side === 'back' ? backIfaces : frontIfaces);

    const params = useMemo(() => ({
        lambdaStart, lambdaEnd, lambdaStep, theta: aoi, polarization: pol,
    }), [lambdaStart, lambdaEnd, lambdaStep, aoi, pol]);

    // ── Spectrum compute ────────────────────────────────────────────────────
    const { baseline, perturbed } = useMemo(() => {
        if (!design?.frontLayers) return { baseline: null, perturbed: null };
        try {
            setError(null);
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

            // Expand each stack with its own interlayer list. Back media run
            // substrate→exit to match the stored back-layer order.
            const frontExp = expandLayersWithInterlayers(frontRaw, incMat, subMat, inh.interlayers || []);
            const backExp  = expandLayersWithInterlayers(backRaw,  subMat, exitMat, inh.backInterlayers || []);

            let base, pert;
            if (evalMode === 'back') {
                base = evaluateSpectrumBack(params, exitMat, subMat, backRaw);
                pert = evaluateSpectrumBack(params, exitMat, subMat, backExp);
            } else if (evalMode === 'total') {
                base = evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontRaw, backRaw, subThk);
                pert = evaluateSpectrumTotal(params, incMat, subMat, exitMat, frontExp, backExp, subThk);
            } else {
                base = evaluateSpectrum(params, incMat, subMat, frontRaw);
                pert = evaluateSpectrum(params, incMat, subMat, frontExp);
            }
            return { baseline: base, perturbed: pert };
        } catch (e) {
            setError(e.message || String(e));
            return { baseline: null, perturbed: null };
        }
    }, [design, params, inh, evalMode]);

    // Design + resolver with the inhomogeneity baked into the layer structure,
    // for the live Specification check — so the verdict updates as the user
    // edits interlayers. The expanded interlayers carry material OBJECTS, so the
    // resolver lets objects through (and resolves plain id strings normally).
    const specInputs = useMemo(() => {
        if (!design?.frontLayers) return null;
        try {
            const incMat  = resolveMaterial(design.incidentMedium);
            const subMat  = resolveMaterial(design.substrate?.material);
            const exitMat = resolveMaterial(design.exitMedium);
            const frontRaw = (design.frontLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
            const backRaw = (design.backLayers || [])
                .filter(l => l.thickness > 0)
                .map(l => ({ material: resolveMaterial(l.material), thickness: l.thickness }));
            const frontExp = expandLayersWithInterlayers(frontRaw, incMat, subMat, inh.interlayers || []);
            const backExp  = expandLayersWithInterlayers(backRaw,  subMat, exitMat, inh.backInterlayers || []);
            const specDesign = {
                ...design,
                frontLayers: frontExp.map(l => ({ material: l.material, thickness: l.thickness })),
                backLayers:  backExp.map(l => ({ material: l.material, thickness: l.thickness })),
            };
            const resolve = (m) => (m && m.getNK) ? m : resolveMaterial(m);
            return { specDesign, resolve };
        } catch (_) { return null; }
    }, [design, inh]);

    // ── Find/edit/add helper functions (side: 'front' | 'back') ──────────────
    const keyFor = (side) => (side === 'back' ? 'backInterlayers' : 'interlayers');

    const findInterlayer = useCallback((side, afterIndex) => {
        return (inh[keyFor(side)] || []).find(il => il.afterIndex === afterIndex);
    }, [inh]);

    const upsertInterlayer = useCallback((side, afterIndex, patch) => {
        const key = keyFor(side);
        setInh(prev => {
            const list = (prev[key] || []).slice();
            const idx = list.findIndex(il => il.afterIndex === afterIndex);
            if (idx >= 0) {
                list[idx] = { ...list[idx], ...patch };
            } else {
                list.push({
                    afterIndex,
                    thickness: 5,
                    profile: 'linear',
                    slices: 10,
                    enabled: true,
                    ...patch,
                });
            }
            return { ...prev, [key]: list };
        });
    }, []);

    const removeInterlayer = useCallback((side, afterIndex) => {
        const key = keyFor(side);
        setInh(prev => ({
            ...prev,
            [key]: (prev[key] || []).filter(il => il.afterIndex !== afterIndex),
        }));
    }, []);

    const clearAll = useCallback(() => setInh(emptyInhomogeneity()), []);

    // ── Render guards ───────────────────────────────────────────────────────
    const placeholder = (msg) => h('div', {
        style: {
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: c.textDim, fontSize: 13, fontStyle: 'italic',
            fontFamily: 'system-ui, -apple-system, sans-serif', padding: 16, textAlign: 'center',
        }
    }, msg);

    if (!design) return placeholder(ih.noDesign || 'No design selected.');
    // M11: mode-aware — 'back' needs back layers, 'front' needs front, 'total'
    // accepts either (the back stack is configured directly in those modes).
    {
        const hasFront = !!design.frontLayers?.length;
        const hasBack  = !!design.backLayers?.length;
        const hasLayers = evalMode === 'back' ? hasBack
                        : evalMode === 'front' ? hasFront
                        : (hasFront || hasBack);
        if (!hasLayers) return placeholder(ih.noLayers || 'No layers in design.');
    }
    // Back/Total now configure the back stack directly (no more "switch side"
    // warning). The only remaining notice is back-needing modes with no back
    // coating defined.
    const backMissing = activeSides.includes('back') && !hasBack;

    // ── Styles ──────────────────────────────────────────────────────────────
    const sectionTitle = {
        fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
        letterSpacing: 0.4, color: c.textDim, margin: '6px 8px 4px',
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 11,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const labelStyle = { color: c.textDim, fontSize: 11, whiteSpace: 'nowrap' };
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    });

    // ── Toolbar ─────────────────────────────────────────────────────────────
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
            numField(lambdaStart, setLambdaStart, { ...inputStyle, width: 56, marginLeft: 4 }, { fallback: 0 }),
            h('span', { style: { margin: '0 2px' } }, '–'),
            numField(lambdaEnd, setLambdaEnd, { ...inputStyle, width: 56 }, { fallback: 0 }),
            h('span', { style: { marginLeft: 4 } }, 'nm'),
        ),
        h('label', { style: labelStyle }, ih.step || 'step',
            numField(lambdaStep, v => setLambdaStep(v > 0 ? v : 1), { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 1 }),
        ),
        h('label', { style: labelStyle }, 'AOI',
            numField(aoi, setAoi, { ...inputStyle, width: 48, marginLeft: 4 }, { fallback: 0 }),
            h('span', null, '°'),
        ),
        h('label', { style: labelStyle }, 'pol',
            h('select', { value: pol, onChange: (e) => setPol(e.target.value), style: { ...inputStyle, marginLeft: 4 } },
                ['avg', 's', 'p'].map(p => h('option', { key: p, value: p }, p)))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('div', { style: { display: 'flex', gap: 2 } },
            ['all', 'T', 'R', 'A'].map(k =>
                h('button', { key: k, onClick: () => setChannel(k), style: segBtnStyle(channel === k) },
                    k === 'all' ? 'T+R+A' : k))
        ),
        h('div', { style: { width: 1, height: 20, background: c.border } }),
        h('button', {
            onClick: clearAll, disabled: !(inh.interlayers?.length),
            style: {
                padding: '2px 8px', background: c.inputBg || c.hover, color: c.text,
                border: `1px solid ${c.border}`, borderRadius: 3, fontSize: 11,
                cursor: inh.interlayers?.length ? 'pointer' : 'default',
                opacity: inh.interlayers?.length ? 1 : 0.4,
            }
        }, ih.clearAll || 'Clear all'),
        (design?.qualifiers?.length > 0 && specInputs) && h('div', { style: { marginLeft: 'auto' } },
            h(SpecVerdict, {
                design: specInputs.specDesign, resolveMat: specInputs.resolve, c, t,
                label: (t.specification && t.specification.specLabel) || 'Spec:',
            })
        ),
        h('span', { style: { marginLeft: design?.qualifiers?.length > 0 ? 12 : 'auto', color: c.textDim, fontSize: 11 } },
            `${[...(inh.interlayers || []), ...(inh.backInterlayers || [])].filter(il => il.enabled !== false).length} ${ih.activeInterlayers || 'active'} · `,
            `Σ ${totalInterlayerThickness(inh).toFixed(2)} nm`,
        ),
    );

    // ── Interface table (parameterized by side) ──────────────────────────────
    const interfaceRow = (side, iface) => {
        const il = findInterlayer(side, iface.afterIndex);
        const enabled = il ? il.enabled !== false : false;
        return h('tr', {
            key: `${side}:${iface.afterIndex}`,
            style: { borderBottom: `1px solid ${c.border}`, fontSize: 11 }
        },
            h('td', { style: { padding: '4px 6px', whiteSpace: 'nowrap', color: c.text } },
                h(Checkbox, {
                    c,
                    checked: enabled,
                    onChange: (e) => {
                        if (e.target.checked) {
                            upsertInterlayer(side, iface.afterIndex, { enabled: true });
                        } else if (il) {
                            upsertInterlayer(side, iface.afterIndex, { enabled: false });
                        }
                    },
                    style: { marginRight: 6 }
                }),
                iface.label,
            ),
            h('td', { style: { padding: '4px 6px' } },
                numField(il?.thickness ?? 5,
                    (v) => upsertInterlayer(side, iface.afterIndex, { thickness: Math.max(0, v), enabled: true }),
                    { ...inputStyle, width: 56 }, { fallback: 0 }),
                h('span', { style: { marginLeft: 2, color: c.textDim } }, 'nm'),
            ),
            h('td', { style: { padding: '4px 6px' } },
                h('select', {
                    value: il?.profile ?? 'linear',
                    onChange: (e) => upsertInterlayer(side, iface.afterIndex, {
                        profile: e.target.value, enabled: true,
                    }),
                    style: { ...inputStyle, width: 100 }
                }, PROFILE_IDS.map(p => h('option', { key: p, value: p }, p)))
            ),
            h('td', { style: { padding: '4px 6px' } },
                numField(il?.slices ?? 10,
                    (v) => upsertInterlayer(side, iface.afterIndex, { slices: Math.max(2, Math.floor(v)), enabled: true }),
                    { ...inputStyle, width: 48 }, { fallback: 2, int: true })
            ),
            h('td', { style: { padding: '4px 6px' } },
                il && h('button', {
                    onClick: () => removeInterlayer(side, iface.afterIndex),
                    title: ih.removeRow || 'Remove',
                    style: {
                        padding: '0 6px', background: 'transparent', color: c.textDim,
                        border: 'none', cursor: 'pointer', fontSize: 14,
                    }
                }, '×')
            )
        );
    };

    const interfaceSection = (side) => {
        const ifaces = ifacesFor(side);
        const title = side === 'back'
            ? (ih.backInterfacesTitle || 'Back-stack interfaces')
            : (activeSides.length > 1
                ? (ih.frontInterfacesTitle || 'Front-stack interfaces')
                : (ih.interfaceListTitle || 'Front-stack interfaces'));
        return h('div', { key: side },
            h('div', { style: sectionTitle }, title),
            h('table', {
                style: {
                    width: '100%', borderCollapse: 'collapse',
                    background: c.bg, color: c.text, fontSize: 11,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            },
                h('thead', null,
                    h('tr', { style: { background: c.panel, color: c.textDim, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 } },
                        h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.interface || 'Interface'),
                        h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.thickness || 'Thickness'),
                        h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.profile || 'Profile'),
                        h('th', { style: { padding: '4px 6px', textAlign: 'left' } }, ih.slices || 'Slices'),
                        h('th', { style: { padding: '4px 6px' } }, ''),
                    )
                ),
                h('tbody', null, ifaces.map(iface => interfaceRow(side, iface)))
            )
        );
    };

    // ── Layout ──────────────────────────────────────────────────────────────
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column', height: '100%',
            background: c.bg, color: c.text, overflow: 'hidden',
            fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 12,
        }
    },
        toolbar,
        // Back-needing mode with no back coating defined: nothing to grade.
        backMissing && h('div', {
            style: {
                padding: '6px 12px', background: '#5a4a1a', color: '#ffe08a',
                borderBottom: `1px solid ${c.border}`, fontSize: 11, flexShrink: 0,
            }
        }, ih.noBackLayers || 'This evaluation includes the back coating, but the design has no back layers. Add a back coating in the Design Editor to grade its interfaces.'),
        h('div', {
            style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'row' }
        },
            // Left: interface table(s) — one per analyzed side (front / back / both).
            h('div', {
                style: {
                    width: 380, flexShrink: 0, borderRight: `1px solid ${c.border}`,
                    background: c.panel, overflowY: 'auto',
                }
            },
                ...activeSides
                    .filter(side => side === 'front' || hasBack)
                    .map(interfaceSection),
                h('div', {
                    style: {
                        padding: '8px', fontSize: 10, color: c.textDim, lineHeight: 1.5,
                        borderTop: `1px solid ${c.border}`,
                    }
                }, ih.helpText ||
                  'Each interlayer is sliced into N sub-layers with linearly-mixed n,k (Macleod-Marseille, §"Inhomogeneous Layers"). Thickness adds at the interface — host layers are not shortened.')
            ),
            // Right: spectrum overlay
            h('div', { style: { flex: 1, minHeight: 0, position: 'relative' } },
                error && h('div', {
                    style: {
                        position: 'absolute', top: 8, left: 8, right: 8,
                        padding: '6px 10px', background: '#5a1a1a', color: '#fff',
                        border: '1px solid #a33', borderRadius: 4, fontSize: 11, zIndex: 5,
                    }
                }, error),
                h(OverlayChart, { baseline, perturbed, channel, c })
            ),
        )
    );
}
