---
title: Optical Evaluation
description: Spectral reflectance, transmittance and absorptance of the active design.
ribbonIcon: optical-eval
---

Optical Evaluation plots **how your coating transmits, reflects and absorbs
light across a wavelength range**. For every wavelength on the grid you set, it
runs a full thin-film calculation on the active design and draws transmittance
`T(λ)`, reflectance `R(λ)` and absorptance `A(λ) = 1 − T − R`. This is the tool
you reach for after every design change to confirm the spectrum still looks the
way you expect. All three curves are shown in **percent**.

Each quantity is available for **s** (TE) and **p** (TM) polarization and for
their average. Absorptance is only meaningful when a layer or the substrate has
a non-zero extinction coefficient `k`; for transparent dielectrics it stays at
zero and `T + R = 100 %`.

## Settings

**Wavelength range and step** — the span and sampling resolution of the plot,
in nanometres. The default is 400–700 nm. Use a step of 0.5 nm or finer near
narrow features such as bandpass notches, where a coarse grid can skip over a
deep dip.

**Axis units** — relabels the horizontal axis in nm, µm, cm⁻¹ (wavenumber),
THz or eV. This is a display choice only: the underlying sampling always stays
in nanometres, so switching units never changes the computed curves. Wavenumber
and energy axes increase in the opposite direction to wavelength.

**AOI** — the angle of incidence in degrees from the normal. You can list
several angles at once; each is drawn as its own set of curves, with later
angles slightly more transparent so they read as a family. Click an existing
angle to edit it in place, or type a new value to add one.

**Curves** — toggle which quantities and polarizations are drawn: T, R and A
for the average, and the individual s and p curves.

**Y-axis** — leave on the default fixed 0–100 % range, switch to auto-fit, or
enter an explicit minimum and maximum to zoom into a shallow band.

**Auto / Calculate** — with Auto on, the plot recomputes whenever the design or
settings change. Turn it off and use the Calculate button when you want to hold
a result while editing.

The evaluation surface (front only, back only, or both sides together) is set
in the [Design Editor](/design/design-editor/) and shown as a badge on the
window. **Front** evaluates the front coating on the substrate, **Back** the
back coating, and **Total** combines both sides through the substrate — the
last is what a spectrophotometer measures for a part coated on both faces. When
cone-angle averaging is active, a second badge appears and the curves are
averaged over the cone.

## Targets on the plot

If the active design has merit-function targets, they are drawn over the
spectrum so you can see what the design is being optimized toward. Point targets
appear as bold X markers; band and ramp targets appear as a dotted target line
with a tinted zone. Targets are color-coded by quantity (R red, T blue, A
green) and by polarization through the line style. Turn the **Targets** button
off to compare designs without the markers crowding the chart.

The **Edit** button lets you build and adjust targets directly on the plot
instead of typing them into the
[Merit Function Editor](/design/merit-function-editor/):

- **Draw** — drag a line to add a target. Choose the quantity (R/T/A) and
  polarization, and whether the line is a band average or a continuous per-
  wavelength ramp. A flat line becomes a band average; a sloped line becomes a
  ramp.
- **Delete** — switch to the delete tool and click a target's line or marker to
  remove it.
- **Snapping** — endpoints snap to a grid (in nm and %) and to existing target
  ends, so near-flat lines settle onto clean levels such as a 50 % band.

Every edit writes straight to the design's targets, so the Merit Function Editor
stays in sync and each change is a single undo step.

## How to read it

The curves answer the basic questions about a coating at a glance: an
antireflection design drives R toward zero across its band, a mirror drives R
toward 100 %, and a filter shows sharp transitions between pass and block
regions. A gap between `T + R` and 100 % is absorption — check that no layer is
accidentally using a metal when you expect a transparent coating.

The collapsible data table lists `λ, T, R, A` for the curves on screen, and
**Copy CSV** / **Save CSV** export exactly those curves at the chosen angle and
wavelength grid. Curves imported through
[Measured Spectra](/data-exchange/measured-spectra/) appear as dotted lines with
open-circle markers, so you can lay a measurement over the prediction.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.4 (Eqs. 2.111, 2.113), §2.6.4 (incoherent substrate).
