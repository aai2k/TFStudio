# Roadmap

What is planned for TFStudio, roughly in the order it is likely to happen.

This is a statement of direction rather than a set of commitments, and it carries no dates. Items move between sections as priorities change. A release ships whatever is finished at the time it is cut.

If something here matters to your work, or something you need is missing, open an issue. Feedback changes this list.

## Next

- **Fit a design to a measured Ψ and Δ.** Import an ellipsometric measurement, draw it against the calculated curve, and fit the layer thicknesses to it, the same way a design can already be fitted to a measured spectrum.
- **Better WDM design** Generate WDM filter designs that perform better further from normal incidence.
- **Pulse Analysis.** Propagate Gaussian, sech-squared or measured pulses through a coating and show temporal broadening, spectral phase and residual chirp.
- **Coating stress as a design target.** Enter the stress you measured for each material and the optimizer keeps the sum of stress times thickness near zero alongside the optical targets. A back-surface coating enters with a negative coefficient, so a matching back stack cancels the bow.
- **Stress analysis.** With Young's modulus, Poisson's ratio and expansion coefficient on the material and the substrate size entered, report the stress in each layer, the radius of curvature and centre deflection of the part, and cracking and delamination factors.

## After that

- **Merit-aware design cleanup.** Design Cleaner currently decides what to remove from layer thickness, which is a weak proxy for optical importance. Ranking candidates by the merit cost of removing and re-optimizing targets the layers that genuinely contribute least.
- **Sensitivity-directed refinement.** Penalize the thickness-sensitivity predicted by the optimizer Jacobian so designs move toward robust minima.
- **Interface-resolved roughness.** Replace the current lumped scattering loss with an interface-by-interface Névot–Croce treatment.
- **Robust refinement.** Optimize against a sampled cloud of manufacturing perturbations when the cheaper sensitivity penalty is not enough.

## Under consideration

Real candidates, not yet scheduled, listed so you can say if one of them matters to you:

crystal (QCM) deposition monitoring, rugate and graded-index synthesis, laser damage threshold estimation, optimizing across multiple environments at once, glazing U and g values, and CODE V sequence export.

## Not planned

- **Direct instrument or deposition controller control.** Reliable hardware integration needs vendor SDKs and physical instruments to test against, neither of which a project like this can maintain honestly. Importing and exporting measurement files is the supported path instead.

## Recently shipped

See the [releases page](https://github.com/aai2k/TFStudio/releases) for what has landed.
