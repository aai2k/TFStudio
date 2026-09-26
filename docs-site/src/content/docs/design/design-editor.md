---
title: Design Editor
description: "Build and edit the coating: layer stack, substrate, media, and the surface you are designing."
ribbonIcon: design-editor
---

The **Design Editor** is the window where you build a coating. You add and
order layers, choose each layer's material and thickness, set the substrate
and the surrounding media, and pick which surface you are designing. Every
other window (Optical Evaluation, Admittance, Refinement, the tolerance
tools) reads from this same shared design, so anything you change here is
reflected everywhere at once.

A design carries two coatings: a **front** coating on the incident side and a
**back** coating on the exit side. The **Front** and **Back** tabs at the top
switch which one you are editing. In both tabs the layer touching the
substrate is listed first, so the two coatings read consistently.

## Settings

**Reference wavelength λ₀**: the wavelength that drives the QW and FW
thickness columns. A typical value for visible coatings is 550 nm. When you
change λ₀, layers keep their quarter-wave counts: a quarter-wave layer stays
a quarter-wave, and only its physical thickness rescales.

**Substrate**: the substrate material and its physical thickness in
millimetres. When you evaluate the whole part (both sides), the substrate is
treated as optically thick, so reflections inside it combine as intensities
rather than amplitudes.

**Incident / Exit media**: the media on either side of the part, usually air
on both. Pick any catalog material for immersed or cemented designs.

**Surface** and **Ignore other side**: the controls that decide which
coating the optimizer moves and what every window evaluates. See
[Surface & Evaluation Modes](/design/evaluation-modes/) for the full behavior.

**Average over illumination cone**: optional convergent- or divergent-beam
averaging, off by default. When on, every reflectance, transmittance and
absorptance result is averaged over a cone of incidence angles instead of a
single collimated ray, and a live readout shows the numerical aperture,
f-number and full aperture for the half-angle you enter. You choose the
intensity distribution across the cone (uniform, Lambertian, or a table you
enter) and the number of grid points. Because the averaging happens in one
place, every operand and every window that evaluates the design is
cone-averaged automatically while it is on. With a cone active, s and p
polarization are still computed but are formal: a cone is physically rigorous
only for averaged polarization, since each ray has its own plane of incidence.

**Grid points** is where the averaging starts, not a fixed count. TFStudio
averages with that many angles and with twice as many, and keeps doubling
until the two results differ by less than 0.01 % in R, T or A, then uses the
finer of the two. The doubling stops before it would pass 200. A smooth
coating such as a broadband AR settles at twice your grid points. A narrowband
filter needs more near its passband, because the passband moves across the
cone and a sharp peak has to be caught by enough angles. In the merit function
the count is settled at each wavelength a row samples, so only the wavelengths
near a sharp resonance get the extra angles; the plot windows use one count for
the whole curve. A higher value starts finer and takes longer.

Rays past 90° never reach the coating. When a row's angle of incidence plus
the half-angle is more than 90°, the part of the cone beyond grazing is left
out and the average covers only the rays that meet the surface. The cone
settings show a warning when a merit function row is at such an angle.

## The layer table

Each row is one layer: its material, four thickness columns, a lock toggle,
and buttons to move, duplicate or delete it. The four thickness columns show
the **same** physical layer in different units, and all four are editable:
edit any one and the other three update from it. **Physical nm is the stored
value.**

| Column | Unit                  | Definition          |
| ------ | --------------------- | ------------------- |
| nm     | physical thickness    | d                   |
| OT     | optical thickness     | n(λ₀) · d           |
| QW     | quarter-waves at λ₀   | 4 · n(λ₀) · d / λ₀  |
| FW     | full-waves at λ₀      | n(λ₀) · d / λ₀      |

To nudge a layer and watch the other windows follow, hover a thickness cell: up and down arrows appear at its right edge. Each click, or each turn of the mouse wheel over the cell, steps the value by 1 nm in the nm and OT columns, 0.1 in QW and 0.025 in FW, so the QW and FW arrows move a layer by the same optical thickness. Hold Shift for ten times the step and Ctrl for a tenth. Holding an arrow down keeps stepping until you let go. With several rows selected, stepping one of them steps them all, and in OT, QW and FW each moves by the step in its own optical thickness. One Ctrl+Z takes back a whole run of steps.

The lock toggle freezes a layer's thickness: locked layers are excluded from
optimization and synthesis, which is useful for protecting an adhesion or
substrate-adjacent layer. The toolbar above the table adds and removes layers,
inverts the layer order, locks or unlocks the whole side at once, and copies
the current side's stack onto the other surface. You can also insert, delete
and duplicate rows from the keyboard.

## Stack geometry

Below the table, a cross-section diagram shows the incident medium, the front
coating, the substrate, the back coating and the exit medium, colored by
material. Beneath it, a summary reports the layer count and total physical
thickness for each side. The substrate, media and reference-wavelength
settings collapse into this panel so the layer list keeps its vertical space.

## How to read it

The cross-section is the quickest sanity check that the stack you built is the
stack you meant: the right number of layers in the right order, the substrate
in the middle, the media at the edges. The per-side totals tell you how much
material the coating will take to deposit. The **Optimize** and **Eval**
badges at the top show which side the optimizer is moving and which surface is
being scored, so you always know what the numbers in the analysis windows
refer to.

Coating layers are coherent, so the transfer-matrix method combines their
amplitudes. When you evaluate the whole part, the substrate is treated as
incoherent: it is optically thick, so interference inside it averages out and
the front, substrate and back contributions combine as intensities. In a
single-surface evaluation the substrate is simply a semi-infinite exit medium.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 2 (transfer matrix), §2.6.4 (two-sided combination).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §3.1 (optical thickness units), §8.2.5.4 (a filter in an incident cone of light), §16 (cone response at oblique incidence).
