const { createElement: h } = React;

export function Legend({ c }) {
    return h('div', { style: { fontSize: 11, color: c.textDim, padding: '4px 2px', lineHeight: 1.5 } },
        '★ = lowest MF in the case · ◆ = Pareto-optimal (not dominated in MF/time/layers). ',
        'MF is OPTICAL-only (comparable across constrained/unconstrained). ',
        '"Min t" = thinnest layer (nm); on a ·MNT row it turns red + "!" if violated. ',
        'NEEDLE strips thickness constraints by design (optical-only scan) so it ignores MNT (violations expected); GE (which couples its floor to MNT), Structural & Refinement honor it. ',
        'Refinement layer count is FIXED; Needle/GE/Structural GROW the stack (Needle from a THICK seed, GE/Structural from a THIN seed). ',
        'dMin = synthesis insertion/cleanup floor; MNT = a true min-thickness penalty in the merit function. ',
        'DE/SA are stochastic (vary by seed). ',
        'Inspect: "design" loads that cell\'s result and opens Optical Evaluation; "seed" loads its starting point. ',
        'Both are TRANSIENT previews — shown live but NOT added to the project explorer or saved to disk.');
}
