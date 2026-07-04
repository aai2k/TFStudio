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
const Ld  = (x1, y1, x2, y2, w) => h('line', { x1, y1, x2, y2, stroke: 'currentColor', strokeWidth: w || 0.9, strokeLinecap: 'round', strokeDasharray: '1.5 1.5' });
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
    'ri-profiler':    I([ R(2,4,4,12), R(6,4,4,12), R(10,4,4,12), R(14,4,4,12) ]),

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

    // Tolerance group icon — Gaussian bell curve over baseline (statistical/tolerance theme)
    'tolerance':      I([
                          P('M2 16C6 16 7 4 10 4C13 4 14 16 18 16',1.7),
                          L(2,16,18,16,1),
                          Ld(10,5.2,10,16,0.9),
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

    // Needle group (dropdown parent) — same sewing-needle silhouette as Needle Automatic
    'needle-group':   I([
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

// ── Per-group signature colors (the "colorful" ribbon mode) ──────
// One hue per ribbon group; used to tint icons in colorful mode and the mini
// icons in the docking tabs. Chosen to read on both dark and light themes.
export const GROUP_COLORS = {
    file:         '#4a90e2',  // blue
    edit:         '#7c8aa5',  // slate
    design:       '#1abc9c',  // teal
    analysis:     '#46b450',  // green
    optimization: '#e8943a',  // amber
    simulation:   '#a472d8',  // purple
    'data-exchange': '#cf5fa0', // rose — import/export hub
    information:  '#9aa0a8',  // gray
};

// toolId → group key (locale-independent). Includes dropdown sub-tools, which
// inherit their parent group's color. Drives both the colorful ribbon icons and
// the docking-tab mini icons.
const TOOL_GROUP = {
    'new-design': 'file', 'open-project': 'file', 'save': 'file', 'save-as': 'file',
    'undo': 'edit', 'redo': 'edit', 'history': 'edit',
    'design-editor': 'design', 'material-editor': 'design', 'specification': 'design', 'stack-formula': 'design',
    'optical-eval': 'analysis', 'color-eval': 'analysis', 'admittance': 'analysis', 'efield': 'analysis',
    'ellipsometry': 'analysis', 'gd-gdd': 'analysis', 'ri-profiler': 'analysis', 'integral-values': 'analysis',
    'tolerance': 'analysis', 'plot-engine': 'analysis', 'error-analysis': 'analysis', 'sensitivity': 'analysis',
    'inhomogeneities': 'analysis', 'systematic-dev': 'analysis', 'roughness': 'analysis',
    'merit-function': 'optimization', 'refinement': 'optimization', 'needle-group': 'optimization', 'needle': 'optimization',
    'needle-manual': 'optimization', 'gradual': 'optimization', 'structural': 'optimization', 'variator': 'optimization', 'design-cleaner': 'optimization', 'filter-design': 'optimization',
    'bbm-simulator': 'simulation', 'mono-simulator': 'simulation',
    'process-sim': 'data-exchange', 'zemax-coatings': 'data-exchange', 'spectrum-exchange': 'data-exchange',
    'report-gen': 'information', 'help-docs': 'information',
};

// Signature color for a tool's group, or null if unknown. Returns null when not
// in colorful mode is the caller's responsibility.
export const iconColorForTool = (id) => GROUP_COLORS[TOOL_GROUP[id]] || null;

// IDs that live inside the Tolerance / Sensitivity dropdown
const TOLERANCE_TOOL_IDS = ['error-analysis', 'sensitivity', 'inhomogeneities', 'systematic-dev', 'roughness'];

// IDs that live inside the Needle dropdown (Automatic + Manual)
const NEEDLE_TOOL_IDS = ['needle', 'needle-manual'];

// ── Ribbon groups definition (locale-driven) ──────────────────────────────────

function makeGroups(t) {
    const tb = t.toolbar;
    return [
        {
            key: 'file',
            label: tb.groups.file,
            items: [
                { id: 'new-design',   label: tb.buttons['new-design'],   title: tb.tooltips['new-design']   },
                { id: 'open-project', label: tb.buttons['open-project'], title: tb.tooltips['open-project'] },
                { id: 'save',         label: tb.buttons['save'],         title: tb.tooltips['save']         },
                { id: 'save-as',      label: tb.buttons['save-as'],      title: tb.tooltips['save-as']      },
            ]
        },
        {
            key: 'edit',
            label: tb.groups.edit,
            items: [
                { id: 'undo',    label: tb.buttons['undo'],    title: tb.tooltips['undo']    },
                { id: 'redo',    label: tb.buttons['redo'],    title: tb.tooltips['redo']    },
                { id: 'history', label: tb.buttons['history'], title: tb.tooltips['history'] },
            ]
        },
        {
            key: 'design',
            label: tb.groups.design,
            items: [
                { id: 'design-editor',   label: tb.buttons['design-editor'],   title: tb.tooltips['design-editor']   },
                { id: 'material-editor', label: tb.buttons['material-editor'], title: tb.tooltips['material-editor'] },
                { id: 'specification',   label: tb.buttons['specification'],   title: tb.tooltips['specification']   },
                { id: 'stack-formula',   label: tb.buttons['stack-formula'],   title: tb.tooltips['stack-formula']   },
            ]
        },
        {
            key: 'analysis',
            label: tb.groups.analysis,
            items: [
                { id: 'optical-eval',    label: tb.buttons['optical-eval'],    title: tb.tooltips['optical-eval']    },
                { id: 'color-eval',      label: tb.buttons['color-eval'],      title: tb.tooltips['color-eval']      },
                { id: 'admittance',      label: tb.buttons['admittance'],      title: tb.tooltips['admittance']      },
                { id: 'efield',          label: tb.buttons['efield'],          title: tb.tooltips['efield']          },
                { id: 'ellipsometry',    label: tb.buttons['ellipsometry'],    title: tb.tooltips['ellipsometry']    },
                { id: 'gd-gdd',          label: tb.buttons['gd-gdd'],          title: tb.tooltips['gd-gdd']          },
                { id: 'ri-profiler',     label: tb.buttons['ri-profiler'],     title: tb.tooltips['ri-profiler']     },
                { id: 'integral-values', label: tb.buttons['integral-values'], title: tb.tooltips['integral-values'] },
                {
                    id: 'tolerance',
                    label: tb.buttons['tolerance'],
                    title: tb.tooltips['tolerance'],
                    dropdown: TOLERANCE_TOOL_IDS.map(sid => ({
                        id: sid,
                        label: tb.buttons[sid],
                        title: tb.tooltips[sid],
                    }))
                },
                { id: 'plot-engine',     label: tb.buttons['plot-engine'],     title: tb.tooltips['plot-engine']     },
            ]
        },
        {
            key: 'optimization',
            label: tb.groups.optimization,
            items: [
                { id: 'merit-function', label: tb.buttons['merit-function'], title: tb.tooltips['merit-function'] },
                { id: 'refinement',     label: tb.buttons['refinement'],     title: tb.tooltips['refinement']     },
                {
                    id: 'needle-group',
                    label: tb.buttons['needle-group'],
                    title: tb.tooltips['needle-group'],
                    dropdown: NEEDLE_TOOL_IDS.map(sid => ({
                        id: sid,
                        label: tb.buttons[sid],
                        title: tb.tooltips[sid],
                    }))
                },
                { id: 'gradual',        label: tb.buttons['gradual'],        title: tb.tooltips['gradual']        },
                { id: 'structural',     label: tb.buttons['structural'],     title: tb.tooltips['structural']     },
                { id: 'variator',       label: tb.buttons['variator'],       title: tb.tooltips['variator']       },
                { id: 'design-cleaner', label: tb.buttons['design-cleaner'], title: tb.tooltips['design-cleaner'] },
                { id: 'filter-design',  label: tb.buttons['filter-design'],  title: tb.tooltips['filter-design']  },
            ]
        },
        {
            key: 'simulation',
            label: tb.groups.simulation,
            items: [
                { id: 'bbm-simulator',  label: tb.buttons['bbm-simulator'],  title: tb.tooltips['bbm-simulator']  },
                { id: 'mono-simulator', label: tb.buttons['mono-simulator'], title: tb.tooltips['mono-simulator'] },
            ]
        },
        {
            key: 'data-exchange',
            label: tb.groups.dataExchange,
            items: [
                { id: 'spectrum-exchange', label: tb.buttons['spectrum-exchange'], title: tb.tooltips['spectrum-exchange'] },
                { id: 'zemax-coatings',    label: tb.buttons['zemax-coatings'],    title: tb.tooltips['zemax-coatings'] },
                { id: 'process-sim',       label: tb.buttons['process-sim'],       title: tb.tooltips['process-sim']    },
            ]
        },
        {
            key: 'information',
            label: tb.groups.information,
            items: [
                { id: 'report-gen',   label: tb.buttons['report-gen'],   title: tb.tooltips['report-gen']   },
                { id: 'help-docs',    label: tb.buttons['help-docs'],    title: tb.tooltips['help-docs']    },
            ]
        },
    ];
}

// ── Ribbon button ─────────────────────────────────────────────────────────────

function RibbonBtn({ id, label, title, active, disabled, c, onClick, chevron, iconColor }) {
    const [hov, setHov] = useState(false);
    const icon = ICONS[id];
    // In colorful mode the icon wears its group hue (label keeps the button's
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
        h('span', { style: { whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 2 } },
            label,
            chevron && h('span', { style: { fontSize: 8, opacity: 0.7, lineHeight: 1 } }, '▾')
        )
    );
}

// ── Dropdown menu item ────────────────────────────────────────────────────────

function DropdownItem({ id, label, title, active, c, onClick, iconColor }) {
    const [hov, setHov] = useState(false);
    const icon = ICONS[id];
    return h('div', {
        title: title || label,
        onClick,
        onMouseEnter: () => setHov(true),
        onMouseLeave: () => setHov(false),
        style: {
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '6px 10px', borderRadius: 3,
            backgroundColor: active ? c.accent + '30' : hov ? c.hover : 'transparent',
            color: active ? c.accent : c.text,
            cursor: 'pointer',
            fontSize: 12, fontFamily: 'system-ui, -apple-system, sans-serif',
            userSelect: 'none', whiteSpace: 'nowrap'
        }
    },
        h('span', { style: { display: 'flex', color: iconColor || 'inherit' } },
            icon || h('div', { style: { width: 20, height: 20 } })),
        h('span', null, label)
    );
}

// ── Ribbon dropdown (button + popup menu) ─────────────────────────────────────

function RibbonDropdown({ id, label, title, items, c, active, onToolAction, iconColor }) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ x: 0, y: 0 });
    const wrapRef = useRef(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e) => {
            if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
        };
        const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', esc);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', esc);
        };
    }, [open]);

    const handleClick = () => {
        if (!open && wrapRef.current) {
            const r = wrapRef.current.getBoundingClientRect();
            setPos({ x: r.left, y: r.bottom });
        }
        setOpen(o => !o);
    };

    return h('div', { ref: wrapRef, style: { position: 'relative', flexShrink: 0 } },
        h(RibbonBtn, { id, label, title, active, c, chevron: true, onClick: handleClick, iconColor }),
        open && h('div', {
            style: {
                position: 'fixed',
                top: pos.y + 2, left: pos.x,
                zIndex: 10000,
                backgroundColor: c.panel,
                border: `1px solid ${c.border}`,
                borderRadius: 4,
                boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
                padding: 4,
                minWidth: 180,
            }
        }, items.map(it =>
            h(DropdownItem, {
                key: it.id,
                id: it.id, label: it.label, title: it.title,
                active: false,
                c, iconColor,
                onClick: () => { onToolAction(it.id); setOpen(false); }
            })
        ))
    );
}

// ── Ribbon group (buttons + labeled footer) ───────────────────────────────────

function RibbonGroup({ label, children, c, isLast, tourId }) {
    return h('div', {
        'data-tour': tourId || undefined,
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
        h('div', {
            style: {
                textAlign: 'center', fontSize: 9.5,
                color: c.textDim, paddingTop: 2,
                borderTop: `1px solid ${c.border}`,
                letterSpacing: '0.04em', textTransform: 'uppercase',
                userSelect: 'none', lineHeight: 1, paddingBottom: 17
            }
        }, label)
    );
}

// ── Ribbon ────────────────────────────────────────────────────────────────────

export function Toolbar({ c, onToolAction, openWindows = [], t, ribbonStyle = 'colorful' }) {
    const groups = makeGroups(t);
    const colorful = ribbonStyle !== 'minimalist';

    return h('div', {
        className: 'tf-ribbon',
        style: {
            display: 'flex', alignItems: 'stretch',
            height: 74, minHeight: 74,
            backgroundColor: c.panel,
            borderBottom: `1px solid ${c.border}`,
            padding: '4px 8px 0',
            gap: 0, userSelect: 'none',
            overflowX: 'auto', overflowY: 'hidden',
            flexShrink: 0
        }
    },
        groups.map((group, gi) => {
            const groupColor = colorful ? (GROUP_COLORS[group.key] || null) : null;
            return h(RibbonGroup, {
                key: group.label,
                label: group.label,
                c,
                isLast: gi === groups.length - 1,
                tourId: `ribbon-${group.key}`
            },
                group.items.map(btn =>
                    btn.dropdown
                      ? h(RibbonDropdown, {
                            key: btn.id,
                            id: btn.id,
                            label: btn.label,
                            title: btn.title,
                            items: btn.dropdown,
                            active: false,
                            c,
                            onToolAction,
                            iconColor: groupColor,
                        })
                      : h(RibbonBtn, {
                            key: btn.id,
                            id: btn.id,
                            label: btn.label,
                            title: btn.title,
                            active: false,
                            c,
                            iconColor: groupColor,
                            onClick: () => onToolAction(btn.id)
                        })
                )
            );
        })
    );
}
