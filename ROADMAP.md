# Roadmap

What is planned for TFStudio, roughly in the order it is likely to happen.

This is a statement of direction rather than a set of commitments, and it carries no dates. Items move between sections as priorities change. A release ships whatever is finished at the time it is cut.

If something here matters to your work, or something you need is missing, open an issue. Feedback changes this list.

## Next

- **A tabbed ribbon.** Replace the single overflowing strip and duplicate menu bar with task-oriented tabs while preserving shortcuts, layouts, tours and development-only commands.
- **Draging windows out of the main window.** A docked window should be able to leave the docking layout entirely and become its own top-level window, dragged anywhere on the desktop, including onto a second monitor. Dragging it back should redock it.
- **Fit a design to a measured curve.** Turn an imported spectrum into merit targets so known layer thicknesses can be fitted to an actual deposition.
- **Determine n and k from measurements.** Fit refractive index, extinction andthickness from measured R/T data with regularized material models.
- **Optical monitoring worksheet and plot.** User-requested spreadsheet-style per-layer table. Monitor wavelength, stop signal, turning points, signal swing, cutoff ratio and witness-chip assignment - together with a full-run monitoring plot whose layer cuts are marked and numbered.

## After that

- **Coating Library.** Saving and reusing user-made coating stacks. A curated set of starting designs with real materials will be shipped too. 
- **New window with a layer thicknesses diagram.** 
- **Report layout.** Denser layer tables and better defaults in generated reports.
- **Visual GD/GDD target editing.** Draw, move and remove dispersion targets directly on the GD/GDD plot instead of switching to the merit table.
- **Pulse Analysis.** Propagate Gaussian, sech-squared or measured pulses through a coating and show temporal broadening, spectral phase and residual chirp.
  
## Later

- **Merit-aware design cleanup.** Design Cleaner currently decides what to remove from layer thickness, which is a weak proxy for optical importance. Ranking candidates by the merit cost of removing and re-optimizing targets the layers that genuinely contribute least.
- **Sensitivity-directed refinement.** Penalize the thickness-sensitivity predicted by the optimizer Jacobian so designs move toward robust minima.
- **Interface-resolved roughness.** Replace the current lumped scattering loss with an interface-by-interface Névot–Croce treatment.
- **Robust refinement.** Optimize against a sampled cloud of manufacturing perturbations when the cheaper sensitivity penalty is not enough.

## Under consideration

Real candidates, not yet scheduled, listed so you can say if one of them matters to you:

crystal (QCM) deposition monitoring, rugate and graded-index synthesis, laser damage threshold estimation, optimizing across multiple environments at once, coating stress as an optimization target, glazing U and g values, and CODE V sequence export.

## Not planned

- **Direct instrument or deposition controller control.** Reliable hardware integration needs vendor SDKs and physical instruments to test against, neither of which a project like this can maintain honestly. Importing and exporting measurement files is the supported path instead.

## Recently shipped

See the [releases page](https://github.com/aai2k/TFStudio/releases) for what has landed.
