// The reflection view is bounded by |Gamma| = 1 whatever the design does.
const REFLECTION_RANGE = { xrange: [-1.06, 1.06], yrange: [-1.06, 1.06] };

function isReflection(series) {
    return series[0]?.view === 'reflection';
}

function arcExtent(arc) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < arc.re.length; i++) {
        if (arc.re[i] < x0) x0 = arc.re[i];
        if (arc.re[i] > x1) x1 = arc.re[i];
        if (arc.im[i] < y0) y0 = arc.im[i];
        if (arc.im[i] > y1) y1 = arc.im[i];
    }
    return Math.hypot(x1 - x0, y1 - y0);
}

// How many times the reference admittances the default view may span before
// loci are left outside it.
const FRAME_SPAN = 4;

/**
 * Admittance framing.
 *
 * Each high/low layer pair multiplies the admittance by (nH/nL)^2, so the outer
 * loci of a long stack are orders of magnitude wider than the ones close to the
 * incident medium, and a range covering all of them leaves the readable part a
 * single dot. Frame instead on the scale the coating is referred to -- the
 * incident medium and substrate admittances -- keeping every locus of that order
 * and leaving larger ones to be reached by zooming out. Short stacks, where no
 * locus is far from that scale, are still framed in full.
 */
function computeDisplayRange(series) {
    if (!series?.length) return null;
    if (isReflection(series)) return REFLECTION_RANGE;

    const sized = series.flatMap(s => s.arcs).map(arc => ({ arc, extent: arcExtent(arc) }));
    if (!sized.length) return null;
    const reference = Math.max(...series.flatMap(s => [
        Math.hypot(...s.marks.eta0), Math.hypot(...s.marks.etaS),
    ]));
    // Never clip every locus: a design whose loci are all far from the reference
    // scale still has to show one.
    const limit = Math.max(FRAME_SPAN * reference, Math.min(...sized.map(a => a.extent)));

    const lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
    const include = ([x, y]) => {
        lo[0] = Math.min(lo[0], x); hi[0] = Math.max(hi[0], x);
        lo[1] = Math.min(lo[1], y); hi[1] = Math.max(hi[1], y);
    };
    for (const { arc, extent } of sized) {
        if (extent > limit) continue;
        for (let i = 0; i < arc.re.length; i++) include([arc.re[i], arc.im[i]]);
    }
    for (const s of series) { include(s.marks.eta0); include(s.marks.etaS); }
    if (!Number.isFinite(lo[0])) return null;

    const cx = (lo[0] + hi[0]) / 2, cy = (lo[1] + hi[1]) / 2;
    const half = Math.max((hi[0] - lo[0]) / 2, (hi[1] - lo[1]) / 2, 1e-9) * 1.12;
    return { xrange: [cx - half, cx + half], yrange: [cy - half, cy + half] };
}

function arcTraces(s, matColorMap, polLabel, textColor, sym) {
    const dash = s.pol === 'p' ? 'dash' : 'solid';
    const traces = [];
    for (const arc of s.arcs) {
        const color = matColorMap[arc.material] || '#aaaaaa';
        traces.push({
            x: arc.re, y: arc.im,
            type: 'scatter', mode: 'lines',
            name: `L${arc.layerNum}${polLabel}`,
            legendgroup: `L${arc.layerNum}`,
            showlegend: true,
            line: { color, width: 2, dash },
            hovertemplate: `Layer ${arc.layerNum}${polLabel}<br>Re(${sym}): %{x:.5f}<br>Im(${sym}): %{y:.5f}<extra></extra>`,
        });
        const Y_L_re = arc.re[arc.re.length - 1];
        const Y_L_im = arc.im[arc.im.length - 1];
        traces.push({
            x: [Y_L_re], y: [Y_L_im],
            type: 'scatter', mode: 'markers',
            showlegend: false,
            legendgroup: `L${arc.layerNum}`,
            marker: { symbol: 'circle', size: 6, color, line: { color: textColor, width: 1 } },
            hovertemplate: `L${arc.layerNum} air side${polLabel}<br>Re(${sym}): %{x:.5f}<br>Im(${sym}): %{y:.5f}<extra></extra>`,
        });
    }
    return traces;
}

function markerTraces(s, polLabel, isMultiPol, textColor, sym) {
    const Y0 = s.marks.Y0;
    return [
        {
            x: [s.marks.etaS[0]], y: [s.marks.etaS[1]],
            type: 'scatter', mode: 'markers+text',
            name: `η_s${polLabel}`,
            showlegend: false,
            marker: { symbol: 'square', size: 10, color: '#ffca28', line: { color: textColor, width: 1 } },
            text: [s.pol === 'p' && isMultiPol ? '' : 'η_s'],
            textposition: 'top center',
            textfont: { color: '#ffca28', size: 11 },
            hovertemplate: `Substrate η_s${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`,
        },
        {
            x: [Y0[0]], y: [Y0[1]],
            type: 'scatter', mode: 'markers+text',
            name: `Y₀${polLabel}`,
            showlegend: false,
            marker: { symbol: 'diamond', size: 10, color: '#66bb6a', line: { color: textColor, width: 1 } },
            text: [s.pol === 'p' && isMultiPol ? '' : 'Y₀'],
            textposition: 'top right',
            textfont: { color: '#66bb6a', size: 11 },
            hovertemplate: `Final Y₀${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`,
        },
        {
            x: [s.marks.eta0[0]], y: [s.marks.eta0[1]],
            type: 'scatter', mode: 'markers+text',
            name: `η₀${polLabel}`,
            showlegend: false,
            marker: { symbol: 'cross', size: 12, color: '#ef5350', line: { color: '#ef5350', width: 2 } },
            text: [s.pol === 'p' && isMultiPol ? '' : 'η₀'],
            textposition: 'bottom right',
            textfont: { color: '#ef5350', size: 11 },
            hovertemplate: `Incident medium η₀${polLabel}<br>Re: %{x:.5f}<br>Im: %{y:.5f}<extra></extra>`,
        },
    ];
}

export function admittanceTraces(series, matColorMap, colors) {
    if (!series?.length) return [];
    const isMultiPol = series.length > 1;
    const sym = isReflection(series) ? 'Γ' : 'Y';
    const traces = [];
    for (const s of series) {
        const polLabel = isMultiPol ? ` (${s.pol})` : '';
        traces.push(...arcTraces(s, matColorMap, polLabel, colors.text, sym));
        traces.push(...markerTraces(s, polLabel, isMultiPol, colors.text, sym));
    }
    return traces;
}

// |Gamma| = 1 is total reflection, so the unit circle bounds every passive design.
function unitCircleShape(color) {
    return {
        type: 'circle', xref: 'x', yref: 'y',
        x0: -1, y0: -1, x1: 1, y1: 1,
        line: { color, width: 1, dash: 'dot' },
        fillcolor: 'rgba(0,0,0,0)', layer: 'below',
    };
}

export function admittanceLayout(series, colors) {
    const rr = computeDisplayRange(series);
    const reflection = !!series?.length && isReflection(series);
    const sym = reflection ? 'Γ' : 'Y';
    return {
        shapes: reflection ? [unitCircleShape(colors.border)] : [],
        margin: { l: 56, r: 16, t: 24, b: 48 },
        paper_bgcolor: colors.panel,
        plot_bgcolor: colors.bg,
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: `Re(${sym})`, standoff: 8 },
            gridcolor: colors.border, gridwidth: 1,
            zerolinecolor: colors.border, zeroline: true,
            tickfont: { size: 10 },
            scaleanchor: 'y', scaleratio: 1,
            ...(rr ? { range: rr.xrange, autorange: false } : {}),
        },
        yaxis: {
            title: { text: `Im(${sym})`, standoff: 8 },
            gridcolor: colors.border, gridwidth: 1,
            zerolinecolor: colors.border, zeroline: true,
            tickfont: { size: 10 },
            ...(rr ? { range: rr.yrange, autorange: false } : {}),
        },
        legend: {
            bgcolor: colors.panel + 'cc', bordercolor: colors.border, borderwidth: 1,
            font: { size: 10 }, x: 1, xanchor: 'right', y: 1, yanchor: 'top',
            tracegroupgap: 2,
        },
        hovermode: 'closest',
        autosize: true,
    };
}
