/**
 * The colour ramps a surface or a flat map can be drawn with.
 *
 * Named the way the specification stores them; looked up case-insensitively so
 * a stored 'Viridis' and a written 'viridis' are the same ramp. Stops run low
 * to high and are interpolated, both by ECharts for the colour bar and by the
 * rasteriser for the image, so the two cannot disagree about a colour.
 */

const COLOR_SCALES = {
    // Turbo (Google, 2019): the rainbow ordering Jet gives, with the banding at
    // cyan and yellow taken out, so a gradient reads as a gradient.
    turbo: [
        '#30123b', '#4145ab', '#4675ed', '#39a2fc', '#1bcfd4', '#24eca6', '#61fc6c',
        '#a4fc3b', '#d1e834', '#f3c63a', '#fe9b2d', '#f36315', '#d93806', '#7a0402',
    ],
    viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
    cividis: ['#00204c', '#424086', '#7c7b78', '#bcae5c', '#ffea46'],
    plasma: ['#0d0887', '#7e03a8', '#cc4778', '#f89540', '#f0f921'],
    inferno: ['#000004', '#420a68', '#932667', '#dd513a', '#fca50a', '#fcffa4'],
    jet: ['#00007f', '#0000ff', '#00ffff', '#ffff00', '#ff0000', '#7f0000'],
    hot: ['#000000', '#b00000', '#ff7a00', '#ffff00', '#ffffff'],
    portland: ['#0c3383', '#0a88ba', '#f2d338', '#f28f38', '#d63230'],
    electric: ['#000000', '#1f00ff', '#ff00e6', '#ff1f00', '#ffff00'],
    greys: ['#111111', '#555555', '#aaaaaa', '#f5f5f5'],
};

export function colorScale(name) { return COLOR_SCALES[String(name || 'viridis').toLowerCase()] || COLOR_SCALES.viridis; }
