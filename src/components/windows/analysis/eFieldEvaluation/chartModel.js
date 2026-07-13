export function efieldTraces(profileData, pol) {
    if (!profileData) return [];
    const traces = [];
    const addCurve = (e2arr, z, label, color, dash) => {
        traces.push({
            x: z, y: e2arr.map(v => v * 100),
            type: 'scatter', mode: 'lines', name: label,
            line: { color, width: 2, dash: dash || 'solid' },
            hovertemplate: `${label}<br>z: %{x:.1f} nm<br>|E|²: %{y:.1f}%<extra></extra>`,
        });
    };
    if (pol === 'avg' && profileData.avg) {
        addCurve(profileData.avg.e2, profileData.avg.z, '|E|² (avg)', '#66bb6a');
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', '#4fc3f7', 'dot');
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', '#ef5350', 'dash');
    } else if (pol === 's' && profileData.s) {
        addCurve(profileData.s.e2, profileData.s.z, '|E|² (s)', '#4fc3f7');
    } else if (pol === 'p' && profileData.p) {
        addCurve(profileData.p.e2, profileData.p.z, '|E|² (p)', '#ef5350');
    }
    return traces;
}

export function efieldLayout(profileData, pol, matColorMap, colors) {
    const { bgColor, paperColor, gridColor, textColor, accentColor } = colors;
    const profileRef = pol === 'avg' ? profileData?.avg : profileData?.[pol];
    const bounds = profileRef?.layerBounds || [];
    const totalZ = bounds.length > 1 ? bounds[bounds.length - 1] : 0;
    const shapes = bounds.slice(1, -1).map(b => ({
        type: 'line', x0: b, x1: b, y0: 0, y1: 1, yref: 'paper',
        line: { color: gridColor, width: 1, dash: 'dot' },
    }));
    shapes.push({
        type: 'line', x0: 0, x1: 1, xref: 'paper', y0: 100, y1: 100,
        line: { color: accentColor + '88', width: 1, dash: 'dot' },
    });
    const validLayers = profileData?.validLayers || [];
    for (let k = 0; k < validLayers.length && k + 1 < bounds.length; k++) {
        const color = matColorMap[validLayers[k]?.materialId] || '#555555';
        shapes.push({
            type: 'rect', x0: bounds[k], x1: bounds[k + 1], xref: 'x',
            y0: 0, y1: 1, yref: 'paper', fillcolor: color,
            opacity: 0.13, layer: 'below', line: { width: 0 },
        });
    }
    return {
        paper_bgcolor: paperColor, plot_bgcolor: bgColor,
        margin: { l: 55, r: 16, t: 10, b: 45 }, showlegend: true,
        legend: { x: 1, xanchor: 'right', y: 1, font: { size: 11, color: textColor }, bgcolor: 'transparent' },
        xaxis: {
            range: totalZ > 0 ? [0, totalZ] : undefined, autorange: totalZ <= 0,
            title: { text: 'Depth (nm)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 },
        },
        yaxis: {
            title: { text: '|E|² (%)', font: { color: textColor, size: 12 } },
            color: textColor, gridcolor: gridColor, zerolinecolor: gridColor,
            tickfont: { color: textColor, size: 11 }, rangemode: 'tozero',
        },
        shapes,
    };
}
