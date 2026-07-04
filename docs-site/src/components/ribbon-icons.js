// Plain SVG strings of every ribbon-feature icon, ported from
// src/components/Toolbar.js. Used by PageTitle.astro to stamp each ribbon
// feature's icon at the top of its docs page.
//
// Primitives mirror Toolbar.js's I/P/Pd/F/Fop/R/Rf/L/Ld/C/Cf helpers so the
// SVG output is structurally identical to what the in-app ribbon renders.

const P  = (d, s) => `<path d="${d}" stroke="currentColor" stroke-width="${s || 1.4}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
const Pd = (d, s) => `<path d="${d}" stroke="currentColor" stroke-width="${s || 1}" stroke-linecap="round" stroke-linejoin="round" fill="none" stroke-dasharray="2 1.6"/>`;
const F  = (d, c) => `<path d="${d}" fill="${c || 'currentColor'}"/>`;
const Fop = (d, op) => `<path d="${d}" fill="currentColor" opacity="${op != null ? op : 0.28}"/>`;
const R  = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx || 0}" stroke="currentColor" stroke-width="1.4" fill="none"/>`;
const Rf = (x, y, w, h, rx, fill) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx || 0}" fill="${fill || 'currentColor'}"/>`;
const L  = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${w || 1.4}" stroke-linecap="round"/>`;
const Ld = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="currentColor" stroke-width="${w || 0.9}" stroke-linecap="round" stroke-dasharray="1.5 1.5"/>`;
const C  = (cx, cy, r, sw) => `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="currentColor" stroke-width="${sw || 1.4}" fill="none"/>`;
const Cf = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="currentColor"/>`;

const I = (parts, size = 40) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 20 20" fill="none" style="display:block;flex-shrink:0">${parts.join('')}</svg>`;

// Wide-canvas variant (mirrors Toolbar.js IW) for icons that need more
// horizontal room than a 20×20 square — e.g. the stack-formula "(HL)ⁿ". The
// PageTitle CSS forces the svg to fit its 48×48 box (preserveAspectRatio meet),
// so a w×20 viewBox just letterboxes without distortion.
const IW = (parts, w) =>
  `<svg width="${w * 2}" height="40" viewBox="0 0 ${w} 20" fill="none" style="display:block;flex-shrink:0">${parts.join('')}</svg>`;

export const ICONS = {
  'design-editor':   I([ R(2,2,16,16,1), L(2,7,18,7), L(7,7,7,18), L(2,12,18,12) ]),
  'material-editor': I([ R(3,2,10,14,1), P('M7 6h4M7 9h4M7 12h2'), Rf(13,11,4,5,1,'currentColor'), L(13,9,17,9,1.4) ]),
  'merit-function':  I([ R(2,2,16,16,1), L(2,7,18,7,1.8), L(2,11,18,11), L(2,15,18,15), L(8,7,8,18), L(13,7,13,18), P('M4 4h3',1.4), P('M10 4.5h4',0.8) ]),
  'general-info':    I([ C(10,10,8), L(10,9,10,14,1.6), C(10,6.5,0.5,2) ]),
  // Stack formula — "(HL)ⁿ" on a wide canvas (ported from Toolbar IW).
  'stack-formula':   IW([
                       P('M4 3 Q1.8 5.5 1.8 10 Q1.8 14.5 4 17',1.6),
                       L(6,5,6,15,1.8), L(8.8,5,8.8,15,1.8), L(6,10,8.8,10,1.8),
                       L(12.3,5,12.3,15,1.8), L(12.3,15,15.1,15,1.8),
                       P('M17 3 Q19.2 5.5 19.2 10 Q19.2 14.5 17 17',1.6),
                       L(21.2,8,21.2,3.5,1.6),
                       P('M21.2 4.5 Q22.7 3 24.2 4.5 L24.2 8',1.6),
                     ], 28),
  // Report Generator — document page with heading bar, text lines and a chart.
  'report-gen':      I([
                       P('M4 2.5 L12 2.5 L16 6.5 L16 17.5 L4 17.5 Z', 1.4),
                       P('M12 2.5 L12 6.5 L16 6.5', 1.2),
                       Rf(6,8,7,1.4,0,'currentColor'),
                       L(6,11,11,11,1),
                       P('M6 14.5 L8 12.5 L10 13.8 L13 10.8', 1.2),
                     ]),
  // Filter Design — bandpass transmission curve T(λ).
  'filter-design':   I([
                       L(2,17,18,17,1),
                       L(2,2,2,17,1),
                       P('M3 15L7 15L9 4L11 4L13 15L17 15',1.8),
                     ]),

  'optical-eval':    I([ P('M2 16L6 8l4 4 3-6 3 6'), L(2,16,18,16) ]),
  'color-eval':      I([ F('M10 2a8 8 0 100 16A8 8 0 0010 2z','none'), P('M10 2a8 8 0 100 16A8 8 0 0010 2z'), P('M10 10L4.5 6.5'), P('M10 10L10 3'), P('M10 10L15.5 6.5') ]),
  'admittance':      I([ C(10,10,7), L(3,10,17,10,0.7), L(10,3,10,17,0.7), C(13,10,4,1.3) ]),
  'efield':          I([ P('M2 10q3-6 4-0t4 0t4 0t4 0',1.5), L(10,3,10,6), L(10,14,10,17) ]),
  'ellipsometry':    I([ P('M3 10q2-5 7 0t7 0'), P('M10 3v14',1.2), P('M3 10h14',1.2) ]),
  'gd-gdd':          I([ P('M2 14l3-4 3 2 3-5 3 3 2-4'), L(2,16,18,16) ]),
  'ri-profiler':     I([ R(2,4,4,12), R(6,4,4,12), R(10,4,4,12), R(14,4,4,12) ]),
  'sensitivity':     I([
                       R(2,3,11,3),
                       Rf(2,8,11,3,0,'currentColor'),
                       R(2,13,11,3),
                       L(17,5,17,15,1.2),
                       P('M15.4 6.6L17 4.6L18.6 6.6',1.4),
                       P('M15.4 13.4L17 15.4L18.6 13.4',1.4),
                     ]),
  'error-analysis':  I([
                       Pd('M2 6Q6 2 10 6T18 6'),
                       P('M2 10Q6 6 10 10T18 10',1.6),
                       Pd('M2 14Q6 10 10 14T18 14'),
                     ]),
  'integral-values': I([
                       Fop('M3 17L3 11Q6 3 10 3Q14 3 17 11L17 17Z'),
                       P('M3 11Q6 3 10 3Q14 3 17 11',1.7),
                       L(3,17,17,17,1),
                       L(3,3,3,17,1),
                     ]),
  'systematic-dev':  I([ L(2,16,18,16), P('M3 14q3-4 5-4t4 4 5-4',1.4), P('M3 11q3-4 5-4t4 4 5-4',1.4), L(10,2,10,4,1), L(10,17,10,19,1) ]),
  'inhomogeneities': I([
                       Rf(3,3,14,3,0,'currentColor'),
                       L(3,7,17,7,1.5),
                       L(3,8.5,17,8.5,1.2),
                       L(3,10,17,10,0.95),
                       L(3,11.5,17,11.5,0.7),
                       L(3,13,17,13,0.45),
                       R(3,14,14,3),
                     ]),
  'roughness':       I([ P('M2 12q1-1 2 0t2 0t2 0t2 0t2 0t2 0t2 0t2 0',1.4), L(2,16,18,16), P('M3 13l-1 2M5 13l-1 2M7 13l-1 2M9 13l-1 2M11 13l-1 2M13 13l-1 2M15 13l-1 2',1) ]),
  'plot-engine':     I([ L(3,17,3,3,1.4), L(3,17,17,17,1.4), P('M3 13l4-4 3 2 3-6 4 5'), C(7,9,1.2,1.2), C(10,11,1.2,1.2), C(13,5,1.2,1.2) ]),

  'refinement':      I([ C(10,10,3), P('M10 2v3M10 15v3M2 10h3M15 10h3'), P('M4.9 4.9l2.1 2.1M12.9 12.9l2.1 2.1M4.9 15.1l2.1-2.1M12.9 7.1l2.1-2.1') ]),
  'needle':          I([
                       C(10,3,1.5),
                       L(10,4.5,10,14,2.6),
                       F('M8.4 14L11.6 14L10 17.5Z'),
                       L(3,19,17,19,0.8),
                     ]),
  'gradual':         I([ Rf(2,14,3,4), Rf(6,10,3,8), Rf(10,6,3,12), Rf(14,2,3,16) ]),
  'random-opt':      I([
                       R(3,3,14,14,2.5),
                       Cf(7,7,1.3),
                       Cf(13,7,1.3),
                       Cf(10,10,1.3),
                       Cf(7,13,1.3),
                       Cf(13,13,1.3),
                     ]),
  'design-cleaner':  I([
                       L(10,2,10,9,1.8),
                       P('M6 9L14 9L13 14L7 14Z',1.4),
                       L(7.5,14,6,18,0.9),
                       L(9,14,8.5,18,0.9),
                       L(11,14,11.5,18,0.9),
                       L(12.5,14,14,18,0.9),
                       Cf(3,17,0.55),
                       Cf(4.4,18.6,0.4),
                     ]),
  'wdm-wizard':      I([
                       L(2,17,18,17,1),
                       L(2,2,2,17,1),
                       P('M3 15L7 15L9 4L11 4L13 15L17 15',1.8),
                     ]),

  'bbm-simulator':   I([ P('M2 10h3l2-5 3 10 2-7 2 4h4'), L(2,10,2,10) ]),
  'mono-simulator':  I([ L(2,10,18,10), P('M6 10a4 4 0 008 0', 1.4), C(10,10,1.2,2) ]),
  'process-sim':     I([
                       R(3, 3, 14, 14, 1),
                       Rf(5, 13, 10, 2, 0, 'currentColor'),
                       Rf(5, 11, 10, 2, 0, 'currentColor'),
                       L(7, 6, 7, 10, 0.9),
                       L(10, 5, 10, 10, 0.9),
                       L(13, 6, 13, 10, 0.9),
                       Cf(7, 5, 0.6),
                       Cf(10, 4, 0.6),
                       Cf(13, 5, 0.6),
                     ]),

  'variator':        I([
                       L(3,5,17,5,1.2),
                       Cf(6,5,1.8),
                       L(3,10,17,10,1.2),
                       Cf(10,10,1.8),
                       L(3,15,17,15,1.2),
                       Cf(14,15,1.8),
                     ]),
  'history':         I([ C(10,10,7), P('M10 6v4l3 3'), P('M4 10a6 6 0 001 3') ]),

  // Specification — clipboard with PASS (✓) rows and a FAIL (✗) row.
  'specification':   I([
                       R(4,3,12,14,1),
                       Rf(7,2,6,2,1,'currentColor'),
                       L(6,7,9,7,1.2),
                       P('M9.4 7L10.4 8L12.4 6',1.4),
                       L(6,11,9,11,1.2),
                       P('M9.4 11L10.4 12L12.4 10',1.4),
                       L(6,15,9,15,1.2),
                       L(10,14.4,12,15.6,1.4),
                       L(10,15.6,12,14.4,1.4),
                     ]),

  // Structural Optimizer — layer bars with up/down restructuring arrows.
  'structural':      I([
                       Rf(2,5,9,2,0.6,'currentColor'),
                       Rf(2,9,9,2,0.6,'currentColor'),
                       Rf(2,13,9,2,0.6,'currentColor'),
                       P('M15.5 9.5L15.5 4M13.5 6L15.5 4L17.5 6',1.3),
                       P('M15.5 10.5L15.5 16M13.5 14L15.5 16L17.5 14',1.3),
                     ]),

  // Measured Spectra — plot axes with a spectral curve and measured data points.
  'spectrum-exchange': I([
                       L(2,17,18,17,1),
                       L(2,2,2,17,1),
                       P('M3 14 C6 5 9 5 11 9 C13 13 15 8 17 5',1.5),
                       Cf(6,8.2,0.9),
                       Cf(11,9,0.9),
                       Cf(15,6.2,0.9),
                     ]),

  // Zemax Coatings — a data file (coating-layer lines) + bidirectional exchange arrow.
  'zemax-coatings': I([
                       R(2.5, 3, 8, 14, 1.2),
                       L(4.5, 6.5, 8.5, 6.5, 1),
                       L(4.5, 9, 8.5, 9, 1),
                       L(4.5, 11.5, 8.5, 11.5, 1),
                       L(11.5, 10, 17.5, 10, 1.4),
                       P('M15 7.5 L17.8 10 L15 12.5', 1.4),
                       P('M14 5 L11.5 7 L14 9', 1.2),
                     ]),

  'help-docs':       I([ C(10,10,8), P('M7.5 7.8q0-2 2.5-2t2.5 2q0 1.5-2.5 2.5v1', 1.5), Cf(10,14.7,0.7) ]),
};
