/**
 * Refractive Index Profiler — n(z) and k(z) step-profile vs physical depth.
 *
 * Structural (non-optical) view of the design: dispersive material n,k
 * sampled at one wavelength and laid out as a step function of geometrical
 * depth, incident medium → front layers → substrate.
 *
 * Re(n) / Im(n) tabs. The material-coloured bands behind the curve are an
 * alternative "bar diagram" representation of the same structure.
 */

import { useDesign }          from '../../state/DesignContext.js';
import { computeRIProfile }   from '../../utils/physics/thinFilmMath.js';
import { getMaterialById, resolveColor }    from '../../utils/materials/catalogManager.js';
import { getMaterial }        from '../../utils/materials/materialDatabase.js';
import { DataTablePanel }     from '../ui/DataTablePanel.js';

const { createElement: h, useState, useEffect, useCallback, useRef } = React;

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveMaterial(id) {
    if (!id) return getMaterial('Air');
    return getMaterialById(id) || getMaterial(id) || getMaterial('Air');
}

function buildMatColorMap(layers) {
    const map = {};
    for (const l of layers) {
        const key = l.materialId;
        if (key && !map[key]) {
            const mat = resolveMaterial(key);
            map[key] = mat ? resolveColor(mat) : '#555555';
        }
    }
    return map;
}

// Build the n(z)/k(z) depth profile for one side of the design.
//
// Convention (mirrors EllipsometryEvaluation):
//   front → light enters from incidentMedium, crosses frontLayers in stored
//           (deposition / incident→substrate) order, then the substrate.
//   back  → light enters from exitMedium, crosses backLayers in *reversed*
//           build order (so the deposition-order list reads outward→inward,
//           the same orientation as the front), then the substrate.
// In both cases the depth profile runs  incident-medium → coating → substrate.
function computeProfileForSide(design, lambda_nm, side) {
    const rawLayers = side === 'back'
        ? (design?.backLayers || [])
        : (design?.frontLayers || []);
    if (!rawLayers.length) return null;

    const n0Id = side === 'back' ? design.exitMedium : design.incidentMedium;
    const n0mat = resolveMaterial(n0Id);
    const nsmat = resolveMaterial(design.substrate?.material);
    const [n0n, n0k] = n0mat.getNK(lambda_nm);
    const [nsn, nsk] = nsmat.getNK(lambda_nm);

    const ordered = side === 'back' ? [...rawLayers].reverse() : rawLayers;
    const layers = ordered
        .filter(l => l.material && l.thickness > 0)
        .map(l => {
            const mat = resolveMaterial(l.material);
            const [nr, nk] = mat.getNK(lambda_nm);
            return {
                n: nr, k: nk, d: l.thickness,
                materialId: l.material,
                name: mat?.name || l.material,
            };
        });

    if (!layers.length) return null;
    return computeRIProfile({ n: n0n, k: n0k }, { n: nsn, k: nsk }, layers);
}

// Build a single region's step-profile from an ordered list of layers, in the
// region's OWN local depth coordinate (z starts at 0 at the region's left edge).
// Returns null for an empty layer list. No medium lead-in/out padding — the
// piecewise layout separates the regions visually.
//
//   z = [ 0, d1, d1+d2, …, totalThk ]   (left-hand 'hv' step nodes)
//   n = [ n1, n2, …,        nN       ]
// The trailing point repeats the last layer so the final step is drawn.
function buildRegionProfile(layers) {
    if (!layers?.length) return null;
    const z = [0];
    const n = [layers[0].n];
    const k = [layers[0].k];
    let acc = 0;
    const layerBounds = [0];
    for (let i = 0; i < layers.length; i++) {
        acc += layers[i].d;
        layerBounds.push(acc);
        // For 'hv' steps the node at the START of segment i carries layer i's
        // value; push the boundary with the NEXT layer's value (or repeat the
        // last layer at the region end).
        z.push(acc);
        const next = layers[i + 1] || layers[i];
        n.push(next.n);
        k.push(next.k);
    }
    return { z, n, k, layerBounds, validLayers: layers, totalThk: acc };
}

// Build the three regions of the continuous Total profile, each in its own
// local depth coordinate and physical unit. Light travels incident → exit:
//   Region 1 — front coating : frontLayers in STORED order (incident→substrate)
//   Region 2 — substrate     : one block, thickness design.substrate.thickness
//                              (mm → nm ×1e6), shown in mm
//   Region 3 — back coating  : backLayers in STORED order (substrate→exit) — NOT
//                              reversed: in the continuous geometry the light
//                              reaches the back coating substrate-side-first,
//                              which is exactly the stored deposition order.
// Coating regions are reported in nm; the substrate region in mm. A region with
// no layers is skipped (e.g. bare back → only Front + Substrate appear).
function computeTotalRegions(design, lambda_nm, rp) {
    const sampleLayers = (rawLayers) => (rawLayers || [])
        .filter(l => l.material && l.thickness > 0)
        .map(l => {
            const mat = resolveMaterial(l.material);
            const [nr, nk] = mat.getNK(lambda_nm);
            return { n: nr, k: nk, d: l.thickness, materialId: l.material,
                     name: mat?.name || l.material };
        });

    const regions = [];

    // Region 1 — front coating (nm).
    const frontLayers = sampleLayers(design?.frontLayers);
    if (frontLayers.length) {
        const prof = buildRegionProfile(frontLayers);
        regions.push({
            key: 'front',
            label: rp?.front || 'Front',
            unit: 'nm',
            title: `${rp?.front || 'Front'} (nm)`,
            ...prof,
        });
    }

    // Region 2 — substrate bulk (mm). Single homogeneous block.
    const subThkMm = design?.substrate?.thickness;
    if (subThkMm && subThkMm > 0) {
        const subMat = resolveMaterial(design?.substrate?.material);
        const [sn, sk] = subMat.getNK(lambda_nm);
        const subThkNm = subThkMm * 1e6;            // mm → nm
        regions.push({
            key: 'substrate',
            label: rp?.substrate || 'Substrate',
            unit: 'mm',
            title: `${rp?.substrate || 'Substrate'} (mm)`,
            // Local z plotted in mm so axis ticks read in mm; single flat block.
            z: [0, subThkMm],
            n: [sn, sn],
            k: [sk, sk],
            layerBounds: [0, subThkMm],
            validLayers: [{ n: sn, k: sk, d: subThkNm,
                            materialId: design?.substrate?.material,
                            name: subMat?.name || design?.substrate?.material }],
            totalThk: subThkMm,
        });
    }

    // Region 3 — back coating (nm), STORED order (substrate→exit, not reversed).
    const backLayers = sampleLayers(design?.backLayers);
    if (backLayers.length) {
        const prof = buildRegionProfile(backLayers);
        regions.push({
            key: 'back',
            label: rp?.back || 'Back',
            unit: 'nm',
            title: `${rp?.back || 'Back'} (nm)`,
            ...prof,
        });
    }

    return regions;
}

// ── Plotly chart ──────────────────────────────────────────────────────────────

function RIChart({ profile, quantity, matColorMap, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    const buildTraces = useCallback(() => {
        if (!profile) return [];
        const traces = [];
        const step = { shape: 'hv' };

        if (quantity === 'n' || quantity === 'both') {
            traces.push({
                x: profile.z, y: profile.n,
                type: 'scatter', mode: 'lines',
                name: 'n',
                line: { color: '#4fc3f7', width: 2, shape: step.shape },
                hovertemplate: 'n<br>z: %{x:.1f} nm<br>n: %{y:.4f}<extra></extra>',
            });
        }
        if (quantity === 'k' || quantity === 'both') {
            traces.push({
                x: profile.z, y: profile.k,
                type: 'scatter', mode: 'lines',
                name: 'k',
                yaxis: quantity === 'both' ? 'y2' : 'y',
                line: { color: '#ef5350', width: 2, shape: step.shape,
                        dash: quantity === 'both' ? 'dash' : 'solid' },
                hovertemplate: 'k<br>z: %{x:.1f} nm<br>k: %{y:.5f}<extra></extra>',
            });
        }
        return traces;
    }, [profile, quantity]);

    const buildLayout = useCallback(() => {
        const bounds  = profile?.layerBounds || [];
        const totalZ  = profile?.totalThk || 0;
        const z0      = profile?.z?.[0] ?? 0;
        const zEnd    = profile?.z?.[profile.z.length - 1] ?? totalZ;
        const shapes  = [];

        // Translucent material bands behind the curve ("bar diagram").
        const validLayers = profile?.validLayers || [];
        for (let kk = 0; kk < validLayers.length && kk + 1 < bounds.length; kk++) {
            const color = matColorMap[validLayers[kk]?.materialId] || '#555555';
            shapes.push({
                type: 'rect',
                x0: bounds[kk], x1: bounds[kk + 1], xref: 'x',
                y0: 0, y1: 1, yref: 'paper',
                fillcolor: color, opacity: 0.14,
                layer: 'below', line: { width: 0 },
            });
        }
        // Layer boundary guide lines.
        for (const b of bounds.slice(1, -1)) {
            shapes.push({
                type: 'line', x0: b, x1: b, y0: 0, y1: 1, yref: 'paper',
                line: { color: gridColor, width: 1, dash: 'dot' },
            });
        }

        const showN = quantity === 'n' || quantity === 'both';

        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 56, r: quantity === 'both' ? 56 : 16, t: 10, b: 45 },
            showlegend: quantity === 'both',
            legend: { x: 1, xanchor: 'right', y: 1,
                      font: { size: 11, color: textColor }, bgcolor: 'transparent' },
            xaxis: {
                range: [z0, zEnd],
                title: { text: 'Depth (nm)', font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 11 },
            },
            yaxis: {
                title: { text: showN ? 'n' : 'k', font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 11 },
                rangemode: 'tozero',
            },
            shapes,
        };
        if (quantity === 'both') {
            layout.yaxis2 = {
                title: { text: 'k', font: { color: '#ef5350', size: 12 } },
                color: '#ef5350', overlaying: 'y', side: 'right',
                tickfont: { color: '#ef5350', size: 11 },
                showgrid: false, rangemode: 'tozero',
            };
        }
        return layout;
    }, [profile, quantity, bgColor, paperColor, gridColor, textColor, matColorMap]);

    useEffect(() => {
        if (!divRef.current) return;
        const traces = buildTraces();
        const layout = buildLayout();
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [buildTraces, buildLayout]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Total (continuous single-axis broken layout) ───────────────────────────────
//
// One continuous physical n(z)/k(z) profile across front coating → substrate →
// back coating. The substrate is mm-thick while coatings are nm-thick, so a
// single real-units ruler would crush the coatings to invisible slivers. We map
// every region onto ONE synthetic "plot units" x-axis: coatings keep their real
// nm width, the substrate is COMPRESSED to a fixed visual width, and a gap
// between regions renders the break. (Per-region Plotly axes with subplot
// domains do not render reliably in this app — single-axis piecewise is the
// robust pattern, mirrored from EFieldEvaluation's placeTotalRegions.)
//
// Each region exposes its real depth nodes in `z` (region's own unit) and value
// arrays `n`/`k`; `totalThk` is the region span in that unit. We map a real
// depth v → plotX = start + (v / span) * w.
function placeTotalRegions(regions) {
    const coatW = (regions || [])
        .filter(r => r.key !== 'substrate')
        .map(r => r.totalThk || 1);
    const avgCoat = coatW.length ? coatW.reduce((a, b) => a + b, 0) / coatW.length : 200;
    const subPlotW = Math.max(80, avgCoat * 0.5);   // compressed substrate width
    const GAP = Math.max(20, avgCoat * 0.08);
    let cursor = 0;
    const placed = (regions || []).map(r => {
        const span = r.totalThk || 1;
        const w = r.key === 'substrate' ? subPlotW : span;
        const start = cursor;
        const plotX = (r.z || []).map(v => start + (v / span) * w);
        cursor = start + w + GAP;
        return { ...r, start, end: start + w, w, span, plotX };
    });
    const totalW = placed.length ? placed[placed.length - 1].end : 1;
    return { placed, totalW };
}

function RITotalChart({ regions, quantity, matColorMap, c }) {
    const divRef  = useRef(null);
    const initRef = useRef(false);

    const bgColor    = c.bg     || '#1e1e1e';
    const paperColor = c.panel  || '#252526';
    const gridColor  = c.border || '#3a3a3a';
    const textColor  = c.text   || '#cccccc';

    const build = useCallback(() => {
        const { placed, totalW } = placeTotalRegions(regions);
        if (!placed.length) return { traces: [], layout: {} };

        const showBoth = quantity === 'both';
        const mapX = (r, v) => r.start + (v / r.span) * r.w;

        const traces = [];
        placed.forEach((r, idx) => {
            const cd = (r.z || []).map(v => [v, r.unit]);
            const showInLegend = idx === 0; // one legend entry per quantity
            if (quantity === 'n' || showBoth) {
                traces.push({
                    x: r.plotX, y: r.n, customdata: cd,
                    type: 'scatter', mode: 'lines',
                    name: 'n', legendgroup: 'n', showlegend: showBoth && showInLegend,
                    xaxis: 'x', yaxis: 'y',
                    line: { color: '#4fc3f7', width: 2, shape: 'hv' },
                    hovertemplate: `n<br>${r.label}<br>z: %{customdata[0]:.3f} %{customdata[1]}<br>n: %{y:.4f}<extra></extra>`,
                });
            }
            if (quantity === 'k' || showBoth) {
                traces.push({
                    x: r.plotX, y: r.k, customdata: cd,
                    type: 'scatter', mode: 'lines',
                    name: 'k', legendgroup: 'k', showlegend: showBoth && showInLegend,
                    xaxis: 'x', yaxis: showBoth ? 'y2' : 'y',
                    line: { color: '#ef5350', width: 2, shape: 'hv',
                            dash: showBoth ? 'dash' : 'solid' },
                    hovertemplate: `k<br>${r.label}<br>z: %{customdata[0]:.3f} %{customdata[1]}<br>k: %{y:.5f}<extra></extra>`,
                });
            }
        });

        const shapes = [];
        placed.forEach(r => {
            // Faint background tint over the compressed substrate region.
            if (r.key === 'substrate') {
                shapes.push({
                    type: 'rect', x0: r.start, x1: r.end, xref: 'x',
                    y0: 0, y1: 1, yref: 'paper',
                    fillcolor: gridColor, opacity: 0.10, layer: 'below', line: { width: 0 },
                });
            }
            // Material colour bands + dotted boundary guides (mapped to plot x).
            const bounds = r.layerBounds || [];
            const vl = r.validLayers || [];
            for (let k = 0; k < vl.length && k + 1 < bounds.length; k++) {
                const color = matColorMap[vl[k]?.materialId] || '#555555';
                shapes.push({
                    type: 'rect',
                    x0: mapX(r, bounds[k]), x1: mapX(r, bounds[k + 1]), xref: 'x',
                    y0: 0, y1: 1, yref: 'paper',
                    fillcolor: color, opacity: 0.14, layer: 'below', line: { width: 0 },
                });
            }
            for (const b of bounds.slice(1, -1)) {
                shapes.push({
                    type: 'line', x0: mapX(r, b), x1: mapX(r, b), xref: 'x',
                    y0: 0, y1: 1, yref: 'paper',
                    line: { color: gridColor, width: 1, dash: 'dot' },
                });
            }
        });
        // Dash-dot separators at the gaps between regions.
        for (let i = 0; i < placed.length - 1; i++) {
            const gx = (placed[i].end + placed[i + 1].start) / 2;
            shapes.push({
                type: 'line', x0: gx, x1: gx, xref: 'x', y0: 0, y1: 1, yref: 'paper',
                line: { color: textColor, width: 1, dash: 'dashdot' },
            });
        }

        // Centered region labels (with real span) above each region.
        const annotations = placed.map(r => ({
            x: (r.start + r.end) / 2, xref: 'x', y: 1.02, yref: 'paper', yanchor: 'bottom',
            text: r.key === 'substrate'
                ? `${r.label} · ${(r.totalThk).toFixed(2)} mm`
                : `${r.label} · ${Math.round(r.totalThk)} nm`,
            showarrow: false, font: { color: textColor, size: 11 },
        }));

        const showN = quantity === 'n' || showBoth;
        const layout = {
            paper_bgcolor: paperColor,
            plot_bgcolor:  bgColor,
            margin: { l: 56, r: showBoth ? 56 : 16, t: 24, b: 30 },
            showlegend: showBoth,
            legend: { x: 1, xanchor: 'right', y: 1.08, orientation: 'h',
                      font: { size: 11, color: textColor }, bgcolor: 'transparent' },
            xaxis: {
                range: [0, totalW],
                showticklabels: false, showgrid: false, zeroline: false,
                color: textColor,
            },
            yaxis: {
                title: { text: showN ? 'n' : 'k', font: { color: textColor, size: 12 } },
                color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
                tickfont: { color: textColor, size: 11 },
                rangemode: 'tozero',
            },
            shapes, annotations,
        };
        if (showBoth) {
            layout.yaxis2 = {
                title: { text: 'k', font: { color: '#ef5350', size: 12 } },
                color: '#ef5350', overlaying: 'y', side: 'right',
                tickfont: { color: '#ef5350', size: 11 },
                showgrid: false, rangemode: 'tozero',
            };
        }
        return { traces, layout };
    }, [regions, quantity, bgColor, paperColor, gridColor, textColor, matColorMap]);

    useEffect(() => {
        if (!divRef.current) return;
        const { traces, layout } = build();
        if (!initRef.current) {
            Plotly.newPlot(divRef.current, traces, layout, { responsive: true, displayModeBar: false });
            initRef.current = true;
        } else {
            Plotly.react(divRef.current, traces, layout);
        }
    }, [build]);

    useEffect(() => {
        const el = divRef.current;
        if (!el) return;
        const ro = new ResizeObserver(() => { if (initRef.current) Plotly.Plots.resize(el); });
        ro.observe(el);
        return () => { ro.disconnect(); if (el) Plotly.purge(el); };  // purge on unmount (leak fix)
    }, []);

    return h('div', { ref: divRef, style: { width: '100%', height: '100%' } });
}

// ── Main component ────────────────────────────────────────────────────────────

export function RefractiveIndexProfiler({ c, theme, t }) {
    const rp = t.riProfile;
    const { design } = useDesign();

    const [lambda,    setLambda]    = useState(() => design?.referenceWavelength || 550);
    const [lambdaStr, setLambdaStr] = useState(() => String(design?.referenceWavelength || 550));
    const [quantity,  setQuantity]  = useState('n');     // 'n' | 'k' | 'both'
    // Local view switch: 'front'/'back' plot a single coating side; 'total'
    // plots one continuous front→substrate→back profile on a broken axis.
    // Independent of the design's evaluation mode.
    const [side,      setSide]      = useState('front'); // 'front' | 'back' | 'total'

    useEffect(() => {
        if (design?.referenceWavelength) {
            setLambda(design.referenceWavelength);
            setLambdaStr(String(design.referenceWavelength));
        }
    }, [design?.id]);

    // Default the side to 'back' when the design has only a back coating
    // (front empty, back populated). Runs on design change.
    useEffect(() => {
        const hasFrontL = (design?.frontLayers?.length ?? 0) > 0;
        const hasBackL  = (design?.backLayers?.length  ?? 0) > 0;
        if (!hasFrontL && hasBackL) setSide('back');
    }, [design?.id]);

    const [profile,     setProfile]     = useState(null);
    const [regions,     setRegions]     = useState([]);   // Total-mode regions
    const [matColorMap, setMatColorMap] = useState({});

    useEffect(() => {
        if (!design) { setProfile(null); setRegions([]); return; }

        if (side === 'total') {
            const regs = computeTotalRegions(design, lambda, rp);
            setRegions(regs);
            setProfile(null);
            // Material colours from all regions' layers (coatings + substrate).
            const allLayers = regs.flatMap(r => r.validLayers || []);
            setMatColorMap(allLayers.length ? buildMatColorMap(allLayers) : {});
        } else {
            const result = computeProfileForSide(design, lambda, side);
            setProfile(result);
            setRegions([]);
            if (result?.validLayers) setMatColorMap(buildMatColorMap(result.validLayers));
            else setMatColorMap({});
        }
    }, [design, lambda, side, rp]);

    const isTotal    = side === 'total';
    const hasProfile = isTotal ? regions.length > 0 : !!profile;

    // ── Readouts ──────────────────────────────────────────────────────────────
    // In Total mode aggregate across regions: n-range over all regions; layer
    // count = coating layers (the substrate block is not a "coating layer");
    // total/optical thickness reported for the COATINGS only (the mm substrate
    // would otherwise swamp the nm readout — it has its own labelled axis).
    let nRangeStr, totalThkStr, optThkStr, layerCount;
    if (isTotal) {
        let minN = Infinity, maxN = -Infinity, coatThk = 0, coatOpt = 0, coatN = 0;
        for (const r of regions) {
            for (const v of (r.n || [])) { if (v < minN) minN = v; if (v > maxN) maxN = v; }
            if (r.key !== 'substrate') {
                for (const l of (r.validLayers || [])) { coatThk += l.d; coatOpt += l.n * l.d; coatN++; }
            }
        }
        nRangeStr   = hasProfile && isFinite(minN) ? `${minN.toFixed(3)} – ${maxN.toFixed(3)}` : '—';
        totalThkStr = hasProfile ? coatThk.toFixed(1) : '—';
        optThkStr   = hasProfile ? coatOpt.toFixed(1) : '—';
        layerCount  = coatN;
    } else {
        nRangeStr   = profile ? `${profile.minN.toFixed(3)} – ${profile.maxN.toFixed(3)}` : '—';
        totalThkStr = profile ? profile.totalThk.toFixed(1) : '—';
        optThkStr   = profile ? profile.optThk.toFixed(1)   : '—';
        layerCount  = profile?.validLayers?.length ?? 0;
    }

    // ── Data-table rows (display only; mirrors the plotted z/n/k arrays) ─────────
    const tableColumns = isTotal
        ? [
            { key: 'region', label: 'region', align: 'left', fmt: v => v },
            { key: 'z',      label: 'z',       align: 'left', fmt: (v, row) => `${(+v).toFixed(3)} ${row?.unit || ''}`.trim() },
            { key: 'n',      label: 'n',                       fmt: v => v.toFixed(4) },
            { key: 'k',      label: 'k',                       fmt: v => v.toFixed(5) },
          ]
        : [
            { key: 'z', label: 'z (nm)', align: 'left', fmt: v => v.toFixed(1) },
            { key: 'n', label: 'n',                      fmt: v => v.toFixed(4) },
            { key: 'k', label: 'k',                      fmt: v => v.toFixed(5) },
          ];
    let tableRows;
    if (isTotal) {
        tableRows = [];
        for (const r of regions) {
            if (!r.z) continue;
            for (let i = 0; i < r.z.length; i++) {
                tableRows.push({ region: r.label, unit: r.unit, z: r.z[i], n: r.n[i], k: r.k[i] });
            }
        }
    } else {
        tableRows = profile?.z
            ? profile.z.map((z, i) => ({ z, n: profile.n[i], k: profile.k[i] }))
            : [];
    }

    // ── Render ────────────────────────────────────────────────────────────────
    if (!design) {
        return h('div', {
            style: {
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: c.textDim, fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif',
            },
        }, rp.noDesign);
    }
    // NOTE: do NOT early-return when the selected side is empty — that removes the
    // controls (incl. the Side switch) and traps the user on an empty side. The
    // controls always render; the chart area below shows the no-layers placeholder
    // when the profile/regions are empty.

    const labelStyle = {
        color: c.textDim, fontSize: 11, fontFamily: 'system-ui, -apple-system, sans-serif',
        whiteSpace: 'nowrap',
    };
    const inputStyle = {
        background: c.inputBg || c.hover, color: c.text,
        border: `1px solid ${c.border}`, borderRadius: 3,
        padding: '1px 4px', fontSize: 12, width: 64,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    };
    const segBtnStyle = (active) => ({
        padding: '2px 10px',
        background: active ? c.accent : (c.inputBg || c.hover),
        color: active ? '#fff' : c.text,
        border: `1px solid ${active ? c.accent : c.border}`,
        borderRadius: 3, cursor: 'pointer', fontSize: 12,
        fontFamily: 'system-ui, -apple-system, sans-serif',
    });

    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            width: '100%', height: '100%', overflow: 'hidden',
            backgroundColor: c.bg, color: c.text,
        },
    },
        // ── Controls bar ───────────────────────────────────────────────────────
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0,
                padding: '5px 8px', borderBottom: `1px solid ${c.border}`,
                backgroundColor: c.panel, flexWrap: 'wrap',
            },
        },
            h('label', { style: labelStyle }, rp.wavelength,
                h('input', {
                    type: 'number', min: 100, max: 10000, step: 10,
                    value: lambdaStr,
                    onChange: e => setLambdaStr(e.target.value),
                    onBlur: e => {
                        const v = parseFloat(e.target.value);
                        const clamped = isNaN(v) ? lambda : Math.max(100, Math.min(10000, v));
                        setLambda(clamped);
                        setLambdaStr(String(clamped));
                    },
                    onKeyDown: e => { if (e.key === 'Enter') e.target.blur(); },
                    style: { ...inputStyle, marginLeft: 6 },
                })
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('span', { style: { ...labelStyle, marginRight: 3 } }, rp.quantity + ':'),
                ['n', 'k', 'both'].map(q =>
                    h('button', { key: q, onClick: () => setQuantity(q), style: segBtnStyle(quantity === q) },
                        q === 'n' ? rp.qN : q === 'k' ? rp.qK : rp.qBoth
                    )
                )
            ),
            h('div', { style: { display: 'flex', alignItems: 'center', gap: 3 } },
                h('button', { onClick: () => setSide('front'), style: segBtnStyle(side === 'front') },
                    rp.front || 'Front'),
                h('button', { onClick: () => setSide('back'), style: segBtnStyle(side === 'back') },
                    rp.back || 'Back'),
                h('button', { onClick: () => setSide('total'), style: segBtnStyle(side === 'total') },
                    rp.total || 'Total')
            ),
            h('span', { style: { ...labelStyle, marginLeft: 'auto', color: c.text } },
                `${rp.nRange}: ${nRangeStr}  |  ${rp.layersLabel}: ${layerCount}  |  ` +
                `${rp.totalThk}: ${totalThkStr} nm  |  ${rp.optThk}: ${optThkStr} nm`
            )
        ),

        // ── Chart ─────────────────────────────────────────────────────────────
        h('div', { style: { flex: 1, minHeight: 0, overflow: 'hidden' } },
            hasProfile
                ? (isTotal
                    ? h(RITotalChart, { regions, quantity, matColorMap, c })
                    : h(RIChart, { profile, quantity, matColorMap, c }))
                : h('div', {
                    style: {
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        color: c.textDim, fontSize: 13,
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                    },
                }, rp.noLayers)
        ),

        // ── Data (text) panel ───────────────────────────────────────────────────
        hasProfile && h(DataTablePanel, { columns: tableColumns, rows: tableRows, c, t }),
    );
}
