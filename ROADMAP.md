# Roadmap

What is planned for TFStudio, roughly in the order it is likely to happen.

TFStudio is developed by one person alongside a full-time job, so this is a statement of direction rather than a set of commitments, and it carries no dates. Items move between sections as priorities change. A release ships whatever is finished at the time it is cut.

If something here matters to your work, or something you need is missing, open an issue. Feedback changes this list.

## Next

- **Design Editor tools.** Replacing a material while preserving optical thickness rather than physical thickness, rounding or quantizing thicknesses to a deposition resolution, applying a manual perturbation to the stack, and copying the layer table to the clipboard.
- **Merit-aware design cleanup.** Design Cleaner currently decides what to remove from layer thickness, which is a weak proxy for optical importance. Ranking candidates by the merit cost of removing and re-optimizing targets the layers that genuinely contribute least.
- **Draging windows out of the main window.** A docked window should be able to leave the docking layout entirely and become its own top-level window, dragged anywhere on the desktop, including onto a second monitor. Dragging it back should redock it.

## After that

- **New window with a layer thicknesses diagram.** 
- **Fitting a design to a measured spectrum.** Measured spectra can already be imported and plotted. The next step is generating merit function targets from an imported curve, so layer thicknesses can be fitted to what was actually deposited.
- **Report layout.** Denser layer tables and better defaults in generated reports.
- **Equivalent layers.** Converting a layer group to an equivalent single index layer and back.

## Later

- **Designing for manufacturability.** Refinement that penalizes sensitivity directly, so the optimizer prefers designs that survive deposition error instead of only reporting afterwards that a design is fragile.
- **Determining n, k from measurement.** Deriving a film's refractive index, extinction and thickness from measured spectra, so materials can be characterized as deposited rather than taken from published data.
- **Interface-resolved roughness.** The current scattering model treats roughness as a single lumped loss, which is adequate in the visible range and less so at short wavelengths.

## Under consideration

Real candidates, not yet scheduled, listed so you can say if one of them matters to you:

Migration from plotly to Apache ECharts,

crystal (QCM) deposition monitoring, rugate and graded-index synthesis, laser damage threshold estimation, optimizing across multiple environments at once, pulse propagation for ultrafast coatings, coating stress as an optimization target, glazing U and g values, and CODE V sequence export.

## Not planned

- **Direct instrument or deposition controller control.** Reliable hardware integration needs vendor SDKs and physical instruments to test against, neither of which a project like this can maintain honestly. Importing and exporting measurement files is the supported path instead.

## Recently shipped

See the [releases page](https://github.com/aai2k/TFStudio/releases) for what has landed.
