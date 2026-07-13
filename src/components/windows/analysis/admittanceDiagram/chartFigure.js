function pctl(sortedAsc, p) {
    if (!sortedAsc.length) return 0;
    const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round(p * (sortedAsc.length - 1))));
    return sortedAsc[i];
}

function computeRobustRange(series) {
    if (!series || !series.length) return null;
    const re = [], im = [], must = [];
    for (const s of series) {
        for (const arc of s.arcs) {
            for (let i = 0; i < arc.re.length; i++) { re.push(arc.re[i]); im.push(arc.im[i]); }
        }
        if (s.etaS) must.push(s.etaS);
        if (s.eta0) must.push(s.eta0);
        if (s.Y && s.Y[0]) must.push(s.Y[0]);
    }
    if (!re.length) return null;
    const reS = re.slice().sort((a, b) => a - b);
    const imS = im.slice().sort((a, b) => a - b);
    let reLo = pctl(reS, 0.02), reHi = pctl(reS, 0.95);
    let imLo = pctl(imS, 0.025), imHi = pctl(imS, 0.975);
    for (const [r, i] of must) {
        reLo = Math.min(reLo, r); reHi = Math.max(reHi, r);
        imLo = Math.min(imLo, i); imHi = Math.max(imHi, i);
    }
    const cx = (reLo + reHi) / 2, cy = (imLo + imHi) / 2;
    const half = Math.max((reHi - reLo) / 2, (imHi - imLo) / 2, 1.0) * 1.12;
    return { xrange: [cx - half, cx + half], yrange: [cy - half, cy + half] };
}

function arcTraces(s, matColorMap, polLabel, textColor) {
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
            hovertemplate: `Layer ${arc.layerNum}${polLabel}<br>Re(Y): %{x:.5f}<br>Im(Y): %{y:.5f}<extra></extra>`,
        });
        const Y_L_re = arc.re[arc.re.length - 1];
        const Y_L_im = arc.im[arc.im.length - 1];
        traces.push({
            x: [Y_L_re], y: [Y_L_im],
            type: 'scatter', mode: 'markers',
            showlegend: false,
            legendgroup: `L${arc.layerNum}`,
            marker: { symbol: 'circle', size: 6, color, line: { color: textColor, width: 1 } },
            hovertemplate: `L${arc.layerNum} air side${polLabel}<br>Re(Y): %{x:.5f}<br>Im(Y): %{y:.5f}<extra></extra>`,
        });
    }
    return traces;
}

function markerTraces(s, polLabel, isMultiPol, textColor) {
    const Y0 = s.Y[0];
    return [
        {
            x: [s.etaS[0]], y: [s.etaS[1]],
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
            x: [s.eta0[0]], y: [s.eta0[1]],
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
    const traces = [];
    for (const s of series) {
        const polLabel = isMultiPol ? ` (${s.pol})` : '';
        traces.push(...arcTraces(s, matColorMap, polLabel, colors.text));
        traces.push(...markerTraces(s, polLabel, isMultiPol, colors.text));
    }
    return traces;
}

export function admittanceLayout(series, colors) {
    const rr = computeRobustRange(series);
    return {
        margin: { l: 56, r: 16, t: 24, b: 48 },
        paper_bgcolor: colors.panel,
        plot_bgcolor: colors.bg,
        font: { color: colors.text, family: 'system-ui, -apple-system, sans-serif', size: 11 },
        xaxis: {
            title: { text: 'Re(Y)', standoff: 8 },
            gridcolor: colors.border, gridwidth: 1,
            zerolinecolor: colors.border, zeroline: true,
            tickfont: { size: 10 },
            scaleanchor: 'y', scaleratio: 1,
            ...(rr ? { range: rr.xrange, autorange: false } : {}),
        },
        yaxis: {
            title: { text: 'Im(Y)', standoff: 8 },
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
