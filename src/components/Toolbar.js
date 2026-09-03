import APP_ICON from '../constants/icon.js';
import { useUpdate } from './ui/UpdateContext.js';

const { createElement: h, useState, useRef, useEffect } = React;

// ── SVG icon primitives ───────────────────────────────────────────────────────

const I = (paths, size = 20) =>
    h('svg', { width: size, height: size, viewBox: '0 0 20 20', fill: 'none', style: { display: 'block', flexShrink: 0 } }, ...paths);

// Wide-canvas variant for icons that need more horizontal room than a 20×20
// square (e.g. the stack-formula "(HL)ⁿ"): renders at w×20 with a 0 0 w 20 box.
const IW = (paths, w) =>
    h('svg', { width: w, height: 20, viewBox: `0 0 ${w} 20`, fill: 'none', style: { display: 'block', flexShrink: 0 } }, ...paths);

const P   = (d, s) => h('path', { d, stroke: 'currentColor', strokeWidth: s || 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' });
const Pd  = (d, s) => h('path', { d, stroke: 'currentColor', strokeWidth: s || 1, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none', strokeDasharray: '2 1.6' });
const F   = (d, c) => h('path', { d, fill: c || 'currentColor' });
const Fop = (d, op) => h('path', { d, fill: 'currentColor', opacity: op != null ? op : 0.28 });
const R   = (x, y, w, hh, rx) => h('rect', { x, y, width: w, height: hh, rx: rx || 0, stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' });
const Rf  = (x, y, w, hh, rx, fill) => h('rect', { x, y, width: w, height: hh, rx: rx || 0, fill: fill || 'currentColor' });
const L   = (x1, y1, x2, y2, w) => h('line', { x1, y1, x2, y2, stroke: 'currentColor', strokeWidth: w || 1.4, strokeLinecap: 'round' });
const C   = (cx, cy, r, sw) => h('circle', { cx, cy, r, stroke: 'currentColor', strokeWidth: sw || 1.4, fill: 'none' });
const Cf  = (cx, cy, r) => h('circle', { cx, cy, r, fill: 'currentColor' });

export const ICONS = {
    'new-design':     I([ R(3,2,11,14,1), P('M10 2v4h4'), L(6,9,12,9), L(6,12,12,12) ]),
    'open-project':   I([ P('M3 8h14l-1.5 8H4.5L3 8z'), P('M3 8V6a1 1 0 011-1h4l2 2h5a1 1 0 011 1v0') ]),
    'save':           I([ R(2,2,16,16,2), P('M6 2v5h8V2'), P('M5 11h10v5H5z'), Rf(7,3,4,3,0,'currentColor') ]),
    // Save As — full floppy disk (matching `save`) with a bold "+" on the label
    // = "save as a new one".
    'save-as':        I([
                          R(2,2,16,16,2),
                          P('M6 2v5h8V2'),
                          Rf(7,3,4,3,0,'currentColor'),
                          L(10,10,10,15,1.8),
                          L(7.5,12.5,12.5,12.5,1.8),
                      ]),
    'undo':           I([ P('M7 4L3 8l4 4'), P('M3 8h10a4 4 0 010 8h-3', 1.4) ]),
    'redo':           I([ P('M13 4l4 4-4 4'), P('M17 8H7a4 4 0 000 8h3', 1.4) ]),

    'design-editor':  I([ R(2,2,16,16,1), L(2,7,18,7), L(7,7,7,18), L(2,12,18,12) ]),
    'material-editor':I([ R(3,2,10,14,1), P('M7 6h4M7 9h4M7 12h2'), Rf(13,11,4,5,1,'currentColor'), L(13,9,17,9,1.4) ]),

    // Coating Library — a shelf of layer stacks: a bookcase frame with a
    // three-layer stack on the shelf and a bookmark tab on the top edge.
    'coating-library': I([
                          R(2.5,3,15,14,1),
                          L(5,13,15,13,1.6), L(5,10,15,10,1.6), L(5,7,15,7,1.6),
                          Rf(12.5,1.5,3,4,0.5,'currentColor'),
                      ]),

    // n,k Characterization — the measurement it works from: a beam onto an
    // unknown film (solid) on a substrate (outline), reflected back out.
    'nk-characterization': I([
                          Rf(2.5,9,15,2,0.5,'currentColor'),
                          R(2.5,11,15,5,0.5),
                          P('M5.5 3L10 9'),
                          P('M10 9L14.5 3'),
                          P('M14.5 3L12.9 3.5M14.5 3L14.1 4.7'),
                      ]),

    // Specification — clipboard with checkmark + check rows (PASS/FAIL spec sheet)
    'specification':  I([
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
    // Stack formula — the layer-stack repeat formula "(HL)ⁿ" on a WIDE (28×20)
    // canvas so the parens, H, L and exponent each get real gaps (H↔L ~3.5px).
    'stack-formula':  IW([
                          P('M4 3 Q1.8 5.5 1.8 10 Q1.8 14.5 4 17',1.6),
                          L(6,5,6,15,1.8), L(8.8,5,8.8,15,1.8), L(6,10,8.8,10,1.8),
                          L(12.3,5,12.3,15,1.8), L(12.3,15,15.1,15,1.8),
                          P('M17 3 Q19.2 5.5 19.2 10 Q19.2 14.5 17 17',1.6),
                          L(21.2,8,21.2,3.5,1.6),
                          P('M21.2 4.5 Q22.7 3 24.2 4.5 L24.2 8',1.6),
                      ], 28),
    'help-docs':      I([ C(10,10,8), P('M7.5 7.8q0-2 2.5-2t2.5 2q0 1.5-2.5 2.5v1', 1.5), Cf(10,14.7,0.7) ]),

    // Welcome — a flag planted at the start of the route the tour walks.
    'welcome':        I([
                          L(5,2.5,5,17.5,1.7),
                          P('M5 3.5h9.5l-2.4 2.8 2.4 2.8H5z'),
                      ]),

    // Tutorials — a graduation cap over its tassel.
    'tutorials':      I([
                          P('M2 7.6L10 4l8 3.6L10 11.2z'),
                          P('M5.6 9.2v4.1c0 1.2 2 2.2 4.4 2.2s4.4-1 4.4-2.2V9.2'),
                          L(17.4,8.3,17.4,12.4,1.2),
                          Cf(17.4,13.2,0.8),
                      ]),

    // About — the information mark.
    'about':          I([ C(10,10,8), Cf(10,6.1,1), L(10,9,10,14.2,1.8) ]),

    // Check for updates — a download arrow inside a re-check arc.
    'check-updates':  I([
                          P('M16.4 10a6.4 6.4 0 1 1-1.9-4.5'),
                          P('M16.9 3v3.4h-3.4'),
                          L(10,6.6,10,12.2,1.6),
                          P('M7.7 10L10 12.4L12.3 10',1.6),
                      ]),

    // Preferences — a cogwheel with square teeth. Deliberately heavier than the
    // thin sun-gear the Refinement icon uses, so the two never read as the same
    // button at 20px.
    'preferences':    I([
                          P('M8.15 2.3h3.7l.33 2.1 1.42.82 1.96-.79 1.85 3.2-1.6 1.4v1.64l1.6 1.4-1.85 3.2-1.96-.79-1.42.82-.33 2.1h-3.7l-.33-2.1-1.42-.82-1.96.79-1.85-3.2 1.6-1.4V9.03l-1.6-1.4 1.85-3.2 1.96.79 1.42-.82z', 1.3),
                          C(10,10,2.5),
                      ]),

    // Optical Evaluation — axes with complementary R (descending) and T (ascending)
    // spectral sigmoids crossing in the middle (T/R vs λ).
    'optical-eval':   I([
                          L(3.2,2.5,3.2,17,1), L(3.2,17,17.5,17,1),
                          P('M4 5.5 C8 5.5 12 14.5 16.5 14.5',1.7),
                          P('M4 14.5 C8 14.5 12 5.5 16.5 5.5',1.7),
                      ]),
    'color-eval':     I([ F('M10 2a8 8 0 100 16A8 8 0 0010 2z','none'), P('M10 2a8 8 0 100 16A8 8 0 0010 2z'), P('M10 10L4.5 6.5'), P('M10 10L10 3'), P('M10 10L15.5 6.5') ]),

    // Admittance — Re/Im axes with a spiralling admittance locus (the trajectory
    // the optical admittance traces through the layer stack) + start-point dot.
    'admittance':     I([
                          L(2,10,18,10,0.8),
                          L(10,2,10,18,0.8),
                          P('M10 10 A1.4 1.4 0 0 1 11.2 8.7 A2.9 2.9 0 0 1 12.6 12.8 A4.6 4.6 0 0 1 6.6 13.4 A6.4 6.4 0 0 1 6.2 5.6',1.5),
                          Cf(6.2,5.6,0.95),
                      ]),

    'efield':         I([ P('M2 10q3-6 4-0t4 0t4 0t4 0',1.5), L(10,3,10,6), L(10,14,10,17) ]),
    'ellipsometry':   I([ P('M3 10q2-5 7 0t7 0'), P('M10 3v14',1.2), P('M3 10h14',1.2) ]),
    'gd-gdd':         I([ P('M2 14l3-4 3 2 3-5 3 3 2-4'), L(2,16,18,16) ]),
    'material-dispersion': I([ P('M2 15l4-7 4 4 4-8 4 5'), L(2,17,18,17), Cf(14,4,1) ]),
    'ri-profiler':    I([ R(2,4,4,12), R(6,4,4,12), R(10,4,4,12), R(14,4,4,12) ]),

    // Layer Thicknesses — bar chart of uneven heights on a baseline, unlike the
    // equal-height stack the RI Profiler icon draws.
    'layer-thicknesses': I([
                          R(2.5,9,3,8), R(6.5,4,3,13), R(10.5,12,3,5), R(14.5,7,3,10),
                          L(2,17,18,17,1),
                      ]),

    // Sensitivity — layer stack with middle layer highlighted + bidirectional thickness arrows
    'sensitivity':    I([
                          R(2,3,11,3),
                          Rf(2,8,11,3,0,'currentColor'),
                          R(2,13,11,3),
                          L(17,5,17,15,1.2),
                          P('M15.4 6.6L17 4.6L18.6 6.6',1.4),
                          P('M15.4 13.4L17 15.4L18.6 13.4',1.4),
                      ]),

    // Error analysis — central solid curve flanked by dashed corridor bands (Monte-Carlo envelope)
    'error-analysis': I([
                          Pd('M2 6Q6 2 10 6T18 6'),
                          P('M2 10Q6 6 10 10T18 10',1.6),
                          Pd('M2 14Q6 10 10 14T18 14'),
                      ]),

    // Integral values — area under a curve (∫ shading) with axes
    'integral-values': I([
                           Fop('M3 17L3 11Q6 3 10 3Q14 3 17 11L17 17Z'),
                           P('M3 11Q6 3 10 3Q14 3 17 11',1.7),
                           L(3,17,17,17,1),
                           L(3,3,3,17,1),
                       ]),

    'systematic-dev': I([ L(2,16,18,16), P('M3 14q3-4 5-4t4 4 5-4',1.4), P('M3 11q3-4 5-4t4 4 5-4',1.4,0.5), L(10,2,10,4,1), L(10,17,10,19,1) ]),

    // Inhomogeneities — solid block → fading horizontal lines (graded interface) → outlined block
    'inhomogeneities': I([
                           Rf(3,3,14,3,0,'currentColor'),
                           L(3,7,17,7,1.5),
                           L(3,8.5,17,8.5,1.2),
                           L(3,10,17,10,0.95),
                           L(3,11.5,17,11.5,0.7),
                           L(3,13,17,13,0.45),
                           R(3,14,14,3),
                       ]),

    'roughness':      I([ P('M2 12q1-1 2 0t2 0t2 0t2 0t2 0t2 0t2 0t2 0',1.4), L(2,16,18,16), P('M3 13l-1 2M5 13l-1 2M7 13l-1 2M9 13l-1 2M11 13l-1 2M13 13l-1 2M15 13l-1 2',1) ]),
    'plot-engine':    I([ L(3,17,3,3,1.4), L(3,17,17,17,1.4), P('M3 13l4-4 3 2 3-6 4 5'), C(7,9,1.2,1.2), C(10,11,1.2,1.2), C(13,5,1.2,1.2) ]),

    // Wavelength vs angle — axes around a heatmap whose cells shade along the
    // diagonal, the shape the window draws.
    'wavelength-angle-map': I([
                          L(3,17,3,3,1.4),
                          L(3,17,17,17,1.4),
                          Fop('M5 4h3.6v3.6H5z', 0.22),
                          Fop('M9 4h3.6v3.6H9z', 0.5),
                          Fop('M13 4h3.6v3.6H13z', 0.88),
                          Fop('M5 8h3.6v3.6H5z', 0.5),
                          Fop('M9 8h3.6v3.6H9z', 0.88),
                          Fop('M13 8h3.6v3.6H13z', 0.5),
                          Fop('M5 12h3.6v3.6H5z', 0.88),
                          Fop('M9 12h3.6v3.6H9z', 0.5),
                          Fop('M13 12h3.6v3.6H13z', 0.22),
                      ]),

    'merit-function': I([ R(2,2,16,16,1), L(2,7,18,7,1.8), L(2,11,18,11), L(2,15,18,15), L(8,7,8,18), L(13,7,13,18), P('M4 4h3',1.4), P('M10 4.5h4',0.8) ]),
    'refinement':     I([ C(10,10,3), P('M10 2v3M10 15v3M2 10h3M15 10h3'), P('M4.9 4.9l2.1 2.1M12.9 12.9l2.1 2.1M4.9 15.1l2.1-2.1M12.9 7.1l2.1-2.1') ]),

    // Needle — clear sewing-needle silhouette: circular eye, thick shaft, sharp triangular tip
    'needle':         I([
                          C(10,3,1.5),
                          L(10,4.5,10,14,2.6),
                          F('M8.4 14L11.6 14L10 17.5Z'),
                          L(3,19,17,19,0.8),
                      ]),

    // Needle Manual — needle silhouette with a click/cursor target (hand-picked insertion)
    'needle-manual':  I([
                          C(7,3,1.4),
                          L(7,4.4,7,12,2.4),
                          F('M5.6 12L8.4 12L7 15Z'),
                          C(14,14,2.6),
                          L(14,9.5,14,11.4,1.2),
                          L(14,16.6,14,18.5,1.2),
                          L(9.5,14,11.4,14,1.2),
                          L(16.6,14,18.5,14,1.2),
                      ]),

    'gradual':        I([ Rf(2,14,3,4), Rf(6,10,3,8), Rf(10,6,3,12), Rf(14,2,3,16) ]),

    // Structural Optimizer — a stack of layers with up/down arrows = randomly
    // ADD / REMOVE layers (structural mutation, distinct from gradual's ramp).
    'structural':     I([
                          Rf(2,5,9,2,0.6,'currentColor'),
                          Rf(2,9,9,2,0.6,'currentColor'),
                          Rf(2,13,9,2,0.6,'currentColor'),
                          P('M15.5 9.5L15.5 4M13.5 6L15.5 4L17.5 6',1.3),
                          P('M15.5 10.5L15.5 16M13.5 14L15.5 16L17.5 14',1.3),
                      ]),

    // Design cleaner — broom with bristles + small debris dots
    'design-cleaner': I([
                          L(10,2,10,9,1.8),
                          P('M6 9L14 9L13 14L7 14Z',1.4),
                          L(7.5,14,6,18,0.9),
                          L(9,14,8.5,18,0.9),
                          L(11,14,11.5,18,0.9),
                          L(12.5,14,14,18,0.9),
                          Cf(3,17,0.55),
                          Cf(4.4,18.6,0.4),
                      ]),

    // Filter Design wizard — bandpass filter transmission curve T(λ)
    'filter-design':  I([
                          L(2,17,18,17,1),
                          L(2,2,2,17,1),
                          P('M3 15L7 15L9 4L11 4L13 15L17 15',1.8),
                      ]),

    // BBM — broadband optical monitoring: a monitor screen showing a full
    // spectrum (many wavelengths) as a bar spectrum.
    'bbm-simulator':  I([
                          R(2,3.5,16,12,1.5),
                          L(3.5,13,16.5,13,0.9),
                          L(5,13,5,9,1.2), L(7,13,7,6.5,1.2), L(9,13,9,10,1.2),
                          L(11,13,11,5.5,1.2), L(13,13,13,8,1.2), L(15,13,15,10.5,1.2),
                      ]),
    // Mono — monochromatic monitoring: a monitor screen with the single-wavelength
    // oscillating signal (turning-point monitoring). Pairs with BBM.
    'mono-simulator': I([
                          R(2,3.5,16,12,1.5),
                          L(2.5,13,17.5,13,0.8),
                          P('M3.8 10.5 C5.2 6.5 6.6 6.5 8 10.5 C9.4 14.5 10.8 14.5 12.2 10.5 C13.1 7.9 14 7.2 16.2 7.2',1.4),
                      ]),

    // Monitor Worksheet — the worksheet itself: a sheet with a header row and a
    // first column, carrying the monitoring signal and the cut it stops at.
    'monitor-worksheet': I([
                          R(2,3,16,14,1),
                          L(2,6.8,18,6.8,0.9),
                          L(6.5,6.8,6.5,17,0.9),
                          P('M7.5 14.6 C8.4 9.6 9.3 9.1 10 9.1 C11 9.1 11.8 11.2 12.5 14.6 C13.2 12.1 14.5 10.6 16.2 10.1',1.4),
                          L(10,9.1,10,16.6,0.9),
                      ]),

    // Process Simulator — chamber with substrate, descending vapor stream and
    // a building stack of layers on top (deposition in progress).
    'process-sim':    I([
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

    // Variator — three horizontal slider tracks with knobs at different positions
    'variator':       I([
                          L(3,5,17,5,1.2),
                          Cf(6,5,1.8),
                          L(3,10,17,10,1.2),
                          Cf(10,10,1.8),
                          L(3,15,17,15,1.2),
                          Cf(14,15,1.8),
                      ]),

    'history':        I([ C(10,10,7), P('M10 6v4l3 3'), P('M4 10a6 6 0 001 3') ]),

    // Report Generator — document page with a heading bar, text lines and a
    // small chart (the multi-section report deliverable).
    'report-gen':     I([
                          P('M4 2.5 L12 2.5 L16 6.5 L16 17.5 L4 17.5 Z', 1.4),
                          P('M12 2.5 L12 6.5 L16 6.5', 1.2),
                          Rf(6,8,7,1.4,0,'currentColor'),
                          L(6,11,11,11,1),
                          P('M6 14.5 L8 12.5 L10 13.8 L13 10.8', 1.2),
                      ]),

    // Measured Spectra — plot axes with a spectral curve and measured data
    // points (import/export measured R/T/A).
    'spectrum-exchange': I([
                          L(2,17,18,17,1),
                          L(2,2,2,17,1),
                          P('M3 14 C6 5 9 5 11 9 C13 13 15 8 17 5',1.5),
                          Cf(6,8.2,0.9),
                          Cf(11,9,0.9),
                          Cf(15,6.2,0.9),
                      ]),

    // Measured Ellipsometry — the polarization ellipse of the Ellipsometry icon
    // carrying measured points, matching how Measured Spectra marks its own.
    'measured-ellipsometry': I([
                          P('M3 10q2-5 7 0t7 0'),
                          P('M10 3v14', 1.2),
                          Cf(5.4, 7.6, 0.9),
                          Cf(10, 10, 0.9),
                          Cf(14.6, 12.4, 0.9),
                      ]),

    // Zemax coatings — a data file (page with stacked coating-layer lines) and a
    // bidirectional exchange arrow (import/export COATING.DAT).
    'zemax-coatings': I([
                          R(2.5, 3, 8, 14, 1.2),
                          L(4.5, 6.5, 8.5, 6.5, 1),
                          L(4.5, 9, 8.5, 9, 1),
                          L(4.5, 11.5, 8.5, 11.5, 1),
                          L(11.5, 10, 17.5, 10, 1.4),
                          P('M15 7.5 L17.8 10 L15 12.5', 1.4),
                          P('M14 5 L11.5 7 L14 9', 1.2),
                      ]),
};

// ── Per-family signature colors (the "colorful" ribbon mode) ──────
// One hue per tool family; used to tint icons in colorful mode and the mini
// icons in the docking tabs, so a tool keeps its color wherever it appears.
// Chosen to read on both dark and light themes.
export const GROUP_COLORS = {
    file:         '#4a90e2',  // blue
    edit:         '#7c8aa5',  // slate
    design:       '#1abc9c',  // teal
    analysis:     '#46b450',  // green
    optimization: '#e8943a',  // amber
    simulation:   '#a472d8',  // purple
    'data-exchange': '#cf5fa0', // rose, import/export hub
    information:  '#9aa0a8',  // gray
};

// toolId → family key (locale-independent). A tool's family is what kind of
// tool it is, which is not always the ribbon tab it is filed under.
const TOOL_GROUP = {
    'new-design': 'file', 'open-project': 'file', 'save': 'file', 'save-as': 'file',
    'undo': 'edit', 'redo': 'edit', 'history': 'edit',
    'design-editor': 'design', 'material-editor': 'design', 'coating-library': 'design',
    'specification': 'design', 'stack-formula': 'design',
    'preferences': 'information',
    'optical-eval': 'analysis', 'color-eval': 'analysis', 'admittance': 'analysis', 'efield': 'analysis',
    'ellipsometry': 'analysis', 'gd-gdd': 'analysis', 'material-dispersion': 'analysis', 'ri-profiler': 'analysis', 'layer-thicknesses': 'analysis', 'integral-values': 'analysis',
    'plot-engine': 'analysis', 'error-analysis': 'analysis', 'sensitivity': 'analysis',
    'wavelength-angle-map': 'analysis',
    'inhomogeneities': 'analysis', 'systematic-dev': 'analysis', 'roughness': 'analysis',
    'merit-function': 'optimization', 'refinement': 'optimization', 'needle': 'optimization',
    'needle-manual': 'optimization', 'gradual': 'optimization', 'structural': 'optimization',
    'variator': 'optimization', 'design-cleaner': 'optimization', 'filter-design': 'optimization',
    'bbm-simulator': 'simulation', 'mono-simulator': 'simulation', 'monitor-worksheet': 'simulation',
    'process-sim': 'simulation',
    'zemax-coatings': 'data-exchange', 'spectrum-exchange': 'data-exchange', 'measured-ellipsometry': 'data-exchange',
    'nk-characterization': 'data-exchange',
    'report-gen': 'information', 'help-docs': 'information',
    'welcome': 'information', 'tutorials': 'information',
    'about': 'information', 'check-updates': 'information',
};

// Signature color for a tool's family, or null if unknown. Returning null when
// not in colorful mode is the caller's responsibility.
export const iconColorForTool = (id) => GROUP_COLORS[TOOL_GROUP[id]] || null;

// ── Ribbon tabs (locale-driven) ───────────────────────────────────────────────
//
// Four tabs in the order a design is worked on: build it, look at it, optimize
// it, take it to the coating plant. The title bar repeats New/Open/Save/Undo/Redo
// as a quick-access strip so those never cost a tab switch, but they stay on the
// Design tab too, where anyone looking for them will look first.

export const RIBBON_TABS = ['setup', 'analysis', 'optimization', 'production', 'help'];

export function makeTabs(t) {
    const tb = t.toolbar;
    // Most buttons open a tool. A few run an application action instead (the
    // welcome tour, the tutorials, About, an update check); those carry the
    // action and are routed to the same handler the application menu uses.
    const btn = (id, action) => ({ id, label: tb.buttons[id], title: tb.tooltips[id], action });
    const grp = (key, ids) => ({
        key,
        label: tb.groups[key],
        items: ids.map(id => (Array.isArray(id) ? btn(id[0], id[1]) : btn(id))),
    });
    return [
        {
            key: 'setup', label: tb.tabs.setup, groups: [
                grp('project',     ['new-design', 'open-project', 'save', 'save-as']),
                grp('edit',        ['undo', 'redo', 'history']),
                grp('design',      ['design-editor', 'material-editor', 'coating-library', 'specification', 'stack-formula']),
                grp('preferences', ['preferences']),
            ]
        },
        {
            key: 'analysis', label: tb.tabs.analysis, groups: [
                grp('general',   ['optical-eval', 'wavelength-angle-map', 'color-eval', 'integral-values',
                                  'admittance', 'efield', 'ri-profiler', 'layer-thicknesses', 'plot-engine']),
                grp('phase',     ['gd-gdd', 'material-dispersion', 'ellipsometry']),
                grp('tolerance', ['error-analysis', 'sensitivity', 'inhomogeneities', 'systematic-dev', 'roughness']),
            ]
        },
        {
            key: 'optimization', label: tb.tabs.optimization, groups: [
                grp('refinement', ['merit-function', 'refinement', 'variator']),
                grp('synthesis',  ['needle', 'needle-manual', 'gradual', 'structural', 'filter-design']),
                grp('cleanup',    ['design-cleaner']),
            ]
        },
        {
            key: 'production', label: tb.tabs.production, groups: [
                grp('monitoring', ['bbm-simulator', 'mono-simulator', 'monitor-worksheet', 'process-sim']),
                grp('measured',   ['spectrum-exchange', 'measured-ellipsometry', 'nk-characterization']),
                grp('exchange',   ['zemax-coatings', 'report-gen']),
            ]
        },
        {
            key: 'help', label: tb.tabs.help, groups: [
                grp('guides', [['welcome', 'welcome'], ['tutorials', 'tutorials'], 'help-docs']),
                grp('about',  [['about', 'about'], ['check-updates', 'check-updates']]),
            ]
        },
    ];
}

// ── Application and help menus ────────────────────────────────────────────────
//
// The former File and Edit menus are gone: every entry they carried is a ribbon
// button or a quick-access button. What is left needs a menu, and sits behind
// the logo button (application) and the ? button (help) on the tab strip. The
// Reload / DevTools / Optimizer Benchmark entries are dev-only and are hidden in
// packaged builds unless started with --debug.

function appMenuItems(t, devAllowed) {
    return [
        { label: t.menu.layoutFilterDesign, action: 'layout-filter-design', shortcut: 'Ctrl+1' },
        { label: t.menu.layoutFullAnalysis, action: 'layout-full-analysis' },
        { label: t.menu.layoutSynthesis,    action: 'layout-synthesis' },
        { label: t.menu.saveLayout,         action: 'layout-save' },
        { label: t.menu.restoreLayout,      action: 'layout-restore' },
        { type: 'sep' },
        { label: t.menu.toggleFullscreen, action: 'toggleFullscreen', shortcut: 'F11' },
        ...(devAllowed ? [
            { label: t.menu.reload,         action: 'reload',          shortcut: 'Ctrl+R' },
            { label: t.menu.toggleDevTools, action: 'toggle-devtools', shortcut: 'Ctrl+Shift+I' },
            { label: t.menu.optimizerBenchmark || 'Optimizer Benchmark…', action: 'tool:optimizer-benchmark' },
        ] : []),
    ];
}

// Window-level actions have no renderer state to change, so they are handled
// here; everything else is forwarded.
function runMenuAction(action, onMenuAction) {
    if (action === 'reload')          { window.location.reload(); return; }
    if (action === 'toggle-devtools') { window.electronAPI?.toggleDevTools?.(); return; }
    if (action === 'toggleFullscreen') {
        document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
        return;
    }
    onMenuAction?.(action);
}

// ── Ribbon button ─────────────────────────────────────────────────────────────

function RibbonBtn({ id, label, title, active, disabled, c, onClick, iconColor }) {
    const [hov, setHov] = useState(false);
    const icon = ICONS[id];
    // In colorful mode the icon wears its family hue (label keeps the button's
    // text/accent color). Disabled icons fall back to the dim text color.
    const iconTint = iconColor ? (disabled ? c.textDim : iconColor) : null;
    return h('button', {
        title: title || label,
        disabled: !!disabled,
        onClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 3,
            padding: '5px 8px',
            border: 'none', borderRadius: 3,
            backgroundColor: active  ? c.accent + '30'
                           : hov     ? c.hover
                           : 'transparent',
            color: disabled ? c.textDim : active ? c.accent : c.text,
            cursor: disabled ? 'default' : 'pointer',
            fontSize: 10, fontFamily: 'system-ui, -apple-system, sans-serif',
            lineHeight: 1, minWidth: 44,
            outline: 'none', flexShrink: 0,
            opacity: disabled ? 0.4 : 1,
            transition: 'background-color 0.1s'
        }
    },
        h('span', {
            style: {
                display: 'flex',
                color: iconTint || 'inherit',
                filter: hov && iconTint ? 'brightness(1.25)' : 'none',
                transition: 'color 0.1s, filter 0.1s'
            }
        }, icon || h('div', { style: { width: 20, height: 20 } })),
        h('span', { style: { whiteSpace: 'nowrap' } }, label)
    );
}

// ── Menu button (logo / help) with its popup ──────────────────────────────────

function MenuButton({ c, items, title, tourId, onAction, align = 'left', width = 230, children }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const outside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', outside);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', outside);
            document.removeEventListener('keydown', esc);
        };
    }, [open]);

    const toggle = () => {
        if (!open && wrapRef.current) {
            const r = wrapRef.current.getBoundingClientRect();
            setPos({ x: align === 'right' ? r.right - width : r.left, y: r.bottom });
        }
        setOpen(o => !o);
    };

    const pick = (action) => { setOpen(false); onAction(action); };

    return h('div', {
        ref: wrapRef,
        'data-tour': tourId || undefined,
        style: { position: 'relative', flexShrink: 0, WebkitAppRegion: 'no-drag' }
    },
        h('button', {
            onClick: toggle,
            title,
            style: {
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
                height: '100%', padding: '0 8px',
                border: 'none', borderRadius: 3,
                backgroundColor: open ? c.hover : 'transparent',
                color: c.text, cursor: 'pointer', outline: 'none',
                fontSize: 13, fontFamily: 'system-ui, -apple-system, sans-serif'
            },
            onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
            onMouseLeave: (e) => { if (!open) e.currentTarget.style.backgroundColor = 'transparent'; }
        }, children),
        open && h('div', {
            style: {
                position: 'fixed', left: pos.x, top: pos.y + 2, zIndex: 10000,
                backgroundColor: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 5, boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
                minWidth: width, padding: 4
            }
        }, items.map((item, i) =>
            item.type === 'sep'
                ? h('div', { key: i, style: { height: 1, backgroundColor: c.border, margin: '3px 8px' } })
                : h('div', {
                    key: i,
                    onClick: () => pick(item.action),
                    style: {
                        padding: '6px 12px', fontSize: 13, color: c.text,
                        cursor: 'pointer', borderRadius: 4,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    },
                    onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
                    onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
                },
                    h('span', null, item.label),
                    item.shortcut && h('span', { style: { color: c.textDim, fontSize: 11, marginLeft: 24 } }, item.shortcut)
                )
        ))
    );
}

// ── Ribbon group (buttons + labeled footer) ───────────────────────────────────

function RibbonGroup({ label, children, c, isLast }) {
    return h('div', {
        style: {
            display: 'flex', flexDirection: 'column',
            borderRight: isLast ? 'none' : `1px solid ${c.border}`,
            paddingRight: isLast ? 0 : 6,
            marginRight: isLast ? 0 : 6,
            flexShrink: 0
        }
    },
        h('div', {
            style: { display: 'flex', alignItems: 'center', gap: 1, flex: 1, paddingBottom: 2 }
        }, children),
        // The group is as wide as its buttons and no wider. `width: 0` keeps the
        // label out of that measurement, `minWidth: 100%` then stretches it back
        // over the buttons, so a long name wraps to a second line instead of
        // padding the whole ribbon out sideways.
        h('div', {
            style: {
                width: 0, minWidth: '100%', boxSizing: 'border-box',
                textAlign: 'center', fontSize: 9,
                color: c.textDim, paddingTop: 3, paddingBottom: 2,
                borderTop: `1px solid ${c.border}`,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                userSelect: 'none', lineHeight: 1.2,
                maxHeight: 24, overflow: 'hidden'
            }
        }, label)
    );
}

// ── Ribbon search ─────────────────────────────────────────────────────────────
//
// Forty-odd tools across four tabs means knowing which tab a tool is on before
// you can reach it. Typing its name finds it wherever it lives, and the result
// says which tab it came from so the next time you go straight there.

// Ranked matches for `query` across every tab. A label that starts with the
// query beats one that merely contains it, which beats a tooltip match, so the
// tool someone is typing the name of comes first.
export function searchRibbon(tabs, query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    for (const tab of tabs) {
        for (const group of tab.groups) {
            for (const item of group.items) {
                const label = (item.label || '').toLowerCase();
                const title = (item.title || '').toLowerCase();
                let rank = -1;
                if (label.startsWith(q)) rank = 0;
                else if (label.includes(q)) rank = 1;
                else if (item.id.includes(q)) rank = 2;
                else if (title.includes(q)) rank = 3;
                if (rank >= 0) hits.push({ ...item, rank, tabKey: tab.key, tabLabel: tab.label });
            }
        }
    }
    return hits.sort((a, b) => a.rank - b.rank || a.label.localeCompare(b.label)).slice(0, 8);
}

function RibbonSearch({ c, t, tabs, onPick }) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const [cursor, setCursor] = useState(0);
    const wrapRef = useRef(null);

    const hits = open ? searchRibbon(tabs, query) : [];

    useEffect(() => { setCursor(0); }, [query]);

    useEffect(() => {
        if (!open) return;
        const outside = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', outside);
        return () => document.removeEventListener('mousedown', outside);
    }, [open]);

    const choose = (hit) => {
        if (!hit) return;
        setQuery('');
        setOpen(false);
        onPick(hit);
    };

    const onKeyDown = (e) => {
        if (e.key === 'Escape') { setQuery(''); setOpen(false); e.currentTarget.blur(); return; }
        if (!hits.length) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(i => (i + 1) % hits.length); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(i => (i - 1 + hits.length) % hits.length); }
        else if (e.key === 'Enter') { e.preventDefault(); choose(hits[cursor]); }
    };

    // Same shape as the explorer's search box: magnifier, field, clear button.
    return h('div', {
        ref: wrapRef,
        style: {
            position: 'relative',
            // The strip stretches its children, so the box has to centre itself
            // or it sits against the top border.
            display: 'flex', alignItems: 'center',
            flexShrink: 1, minWidth: 110, maxWidth: 240, width: 240,
            WebkitAppRegion: 'no-drag',
        }
    },
        h('div', {
            style: {
                display: 'flex', alignItems: 'center', gap: 5, width: '100%',
                padding: '0 6px', height: 22, boxSizing: 'border-box',
                backgroundColor: c.field, border: `1px solid ${c.border}`,
                borderRadius: 4, color: c.textDim,
            }
        },
            h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', style: { flexShrink: 0 } },
                h('circle', { cx: 7, cy: 7, r: 4, stroke: 'currentColor', strokeWidth: 1.3 }),
                h('path', { d: 'M10 10l3 3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })),
            h('input', {
                value: query,
                type: 'search',
                placeholder: t.toolbar.searchPlaceholder,
                'aria-label': t.toolbar.searchPlaceholder,
                onChange: (e) => { setQuery(e.target.value); setOpen(true); },
                onFocus: () => setOpen(true),
                onKeyDown,
                style: {
                    flex: 1, minWidth: 0, border: 'none', outline: 'none', padding: 0,
                    backgroundColor: 'transparent', color: c.text, fontSize: 12,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            }),
            query && h('span', {
                onClick: () => { setQuery(''); setOpen(false); },
                title: t.toolbar.clearSearch,
                style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 14, height: 14, flexShrink: 0, cursor: 'pointer', color: c.textDim,
                }
            },
                h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', fill: 'none' },
                    h('path', { d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })))
        ),

        open && hits.length > 0 && h('div', {
            style: {
                position: 'absolute', top: 26, right: 0, zIndex: 10000,
                minWidth: 280, maxWidth: 360,
                background: c.panel, border: `1px solid ${c.border}`,
                borderRadius: 5, boxShadow: '0 6px 18px rgba(0,0,0,0.35)', padding: 4,
            }
        }, hits.map((hit, i) =>
            h('div', {
                key: hit.id,
                onMouseEnter: () => setCursor(i),
                onMouseDown: (e) => { e.preventDefault(); choose(hit); },
                title: hit.title,
                style: {
                    display: 'flex', alignItems: 'center', gap: 9,
                    padding: '6px 9px', borderRadius: 4, cursor: 'pointer',
                    background: i === cursor ? c.hover : 'transparent',
                    color: c.text, fontSize: 12.5,
                    fontFamily: 'system-ui, -apple-system, sans-serif',
                }
            },
                h('span', { style: { display: 'flex', flexShrink: 0, color: iconColorForTool(hit.id) || 'inherit' } },
                    ICONS[hit.id] || h('div', { style: { width: 20, height: 20 } })),
                h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, hit.label),
                h('span', { style: { color: c.textDim, fontSize: 10.5, flexShrink: 0 } }, hit.tabLabel)
            )
        ))
    );
}

// ── Tab button ────────────────────────────────────────────────────────────────

function TabBtn({ label, active, c, onMouseDown, onClick, onDoubleClick }) {
    const [hov, setHov] = useState(false);
    return h('button', {
        onMouseDown, onClick, onDoubleClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            height: '100%', padding: '0 14px',
            border: 'none', borderBottom: `2px solid ${active ? c.accent : 'transparent'}`,
            backgroundColor: active ? c.panel : hov ? c.hover : 'transparent',
            color: active ? c.accent : c.text,
            fontSize: 12.5, fontWeight: active ? 600 : 400,
            fontFamily: 'system-ui, -apple-system, sans-serif',
            cursor: 'pointer', outline: 'none', flexShrink: 0,
            WebkitAppRegion: 'no-drag'
        }
    }, label);
}

// ── Ribbon ────────────────────────────────────────────────────────────────────

// Renderer-local UI state: which tab was last used and whether the ribbon body
// is collapsed. Kept out of settings.json because it is per-window chrome, not a
// preference the user configures.
const TAB_KEY = 'tfstudio-ribbon-tab';
const COLLAPSE_KEY = 'tfstudio-ribbon-collapsed';

const readTab = () => {
    try {
        const v = localStorage.getItem(TAB_KEY);
        return RIBBON_TABS.includes(v) ? v : RIBBON_TABS[0];
    } catch (_) { return RIBBON_TABS[0]; }
};
const readCollapsed = () => {
    try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch (_) { return false; }
};

export function Toolbar({ c, onToolAction, onMenuAction, t, devAllowed = true, ribbonStyle = 'colorful' }) {
    const tabs = makeTabs(t);
    const colorful = ribbonStyle !== 'minimalist';

    const [activeTab, setActiveTab] = useState(readTab);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    // Collapse-on-double-click has to know whether the ribbon was already open
    // when the click sequence started, since the first click of the pair expands
    // a collapsed ribbon.
    const wasCollapsed = useRef(false);

    useEffect(() => { try { localStorage.setItem(TAB_KEY, activeTab); } catch (_) {} }, [activeTab]);
    useEffect(() => { try { localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch (_) {} }, [collapsed]);

    // The guided tour steps through tabs it does not own; it asks for one by
    // dispatching this event rather than reaching into ribbon state.
    useEffect(() => {
        const onRequest = (e) => {
            if (!RIBBON_TABS.includes(e.detail)) return;
            setActiveTab(e.detail);
            setCollapsed(false);
        };
        window.addEventListener('tfstudio:ribbon-tab', onRequest);
        return () => window.removeEventListener('tfstudio:ribbon-tab', onRequest);
    }, []);

    const tab = tabs.find(x => x.key === activeTab) || tabs[0];

    // Checking for updates is the ribbon's own business: the shared check is
    // already in context here, so the menu runs it rather than routing an action
    // out to the renderer and back.
    const update = useUpdate();
    const runAction = (action) => {
        if (action === 'check-updates') { update?.onBadgeClick?.(); return; }
        runMenuAction(action, onMenuAction);
    };

    const chevron = h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none' },
        h('path', {
            d: collapsed ? 'M2.5 4.5L6 8l3.5-3.5' : 'M2.5 7.5L6 4l3.5 3.5',
            stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round'
        })
    );

    return h('div', { style: { display: 'flex', flexDirection: 'column', flexShrink: 0 } },
        // Tab strip. Empty space stays draggable so the window keeps a grab area
        // beyond the 32px title bar.
        h('div', {
            className: 'tf-ribbon-tabs',
            style: {
                display: 'flex', alignItems: 'stretch',
                height: 30, minHeight: 30,
                backgroundColor: c.bg,
                borderBottom: `1px solid ${c.border}`,
                padding: '0 6px', gap: 2, userSelect: 'none',
                WebkitAppRegion: 'drag'
            }
        },
            h(MenuButton, {
                c, t,
                items: appMenuItems(t, devAllowed),
                title: 'TFStudio',
                onAction: runAction,
                width: 240,
            },
                h('img', { src: APP_ICON, alt: '', style: { width: 18, height: 18, objectFit: 'contain' } }),
                h('span', { style: { fontSize: 15, opacity: 0.9, lineHeight: 1 } }, '▾')
            ),

            h('div', { style: { width: 1, backgroundColor: c.border, margin: '6px 4px' } }),

            tabs.map(x => h(TabBtn, {
                key: x.key,
                label: x.label,
                active: x.key === activeTab,
                c,
                onMouseDown: (e) => { if (e.detail === 1) wasCollapsed.current = collapsed; },
                onClick: () => { setActiveTab(x.key); if (collapsed) setCollapsed(false); },
                onDoubleClick: () => { if (!wasCollapsed.current && x.key === activeTab) setCollapsed(true); },
            })),

            h('div', { style: { flex: 1, minWidth: 8 } }),

            h(RibbonSearch, {
                c, t, tabs,
                // Run the tool, and move to its tab so the button it came from
                // is where the eye lands next.
                onPick: (hit) => {
                    setActiveTab(hit.tabKey);
                    setCollapsed(false);
                    if (hit.action) runAction(hit.action); else onToolAction(hit.id);
                },
            }),

            h('button', {
                onClick: () => setCollapsed(v => !v),
                title: collapsed ? t.toolbar.expandRibbon : t.toolbar.collapseRibbon,
                style: {
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 28, border: 'none', borderRadius: 3,
                    backgroundColor: 'transparent', color: c.textDim,
                    cursor: 'pointer', outline: 'none', flexShrink: 0,
                    WebkitAppRegion: 'no-drag'
                },
                onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = c.hover; },
                onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; }
            }, chevron)
        ),

        // Ribbon body for the active tab.
        !collapsed && h('div', {
            className: 'tf-ribbon',
            'data-tour': `ribbon-${tab.key}`,
            style: {
                display: 'flex', alignItems: 'stretch',
                height: 74, minHeight: 74,
                backgroundColor: c.panel,
                borderBottom: `1px solid ${c.border}`,
                padding: '4px 8px 0',
                gap: 0, userSelect: 'none',
                overflowX: 'auto', overflowY: 'hidden'
            }
        },
            tab.groups.map((group, gi) =>
                h(RibbonGroup, {
                    key: group.key,
                    label: group.label,
                    c,
                    isLast: gi === tab.groups.length - 1,
                },
                    group.items.map(b => h(RibbonBtn, {
                        key: b.id,
                        id: b.id,
                        label: b.label,
                        title: b.title,
                        active: false,
                        c,
                        iconColor: colorful ? iconColorForTool(b.id) : null,
                        onClick: () => (b.action ? runAction(b.action) : onToolAction(b.id))
                    }))
                )
            )
        )
    );
}
