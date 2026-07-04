---
title: Design Editor
description: Build and edit the coating — layer stack, substrate, media, and the surface you are designing.
ribbonIcon: design-editor
---

The **Design Editor** is the window where you build a coating. You add and
order layers, choose each layer's material and thickness, set the substrate
and the surrounding media, and pick which surface you are designing. Every
other window — Optical Evaluation, Admittance, Refinement, the tolerance
tools — reads from this same shared design, so anything you change here is
reflected everywhere at once.

A design carries two coatings: a **front** coating on the incident side and a
**back** coating on the exit side. The **Front** and **Back** tabs at the top
switch which one you are editing. In both tabs the layer touching the
substrate is listed first, so the two coatings read consistently.

## Settings

**Reference wavelength λ₀** — the wavelength that drives the QW and FW
thickness columns. A typical value for visible coatings is 550 nm. When you
change λ₀, layers keep their quarter-wave counts: a quarter-wave layer stays
a quarter-wave, and only its physical thickness rescales.

**Substrate** — the substrate material and its physical thickness in
millimetres. When you evaluate the whole part (both sides), the substrate is
treated as optically thick, so reflections inside it combine as intensities
rather than amplitudes.

**Incident / Exit media** — the media on either side of the part, usually air
on both. Pick any catalog material for immersed or cemented designs.

**Surface** and **Ignore other side** — the controls that decide which
coating the optimizer moves and what every window evaluates. See
[Surface & Evaluation Modes](/design/evaluation-modes/) for the full behavior.

**Average over illumination cone** — optional convergent- or divergent-beam
averaging, off by default. When on, every reflectance, transmittance and
absorptance result is averaged over a cone of incidence angles instead of a
single collimated ray, and a live readout shows the numerical aperture,
f-number and full aperture for the half-angle you enter. You choose the
intensity distribution across the cone (uniform, Lambertian, or a table you
enter) and the number of angular sample points. Because the averaging happens
in one place, every operand and every window that evaluates the design is
cone-averaged automatically while it is on. With a cone active, s and p
polarization are still computed but are formal — a cone is physically rigorous
only for averaged polarization, since each ray has its own plane of incidence.

## The layer table

Each row is one layer: its material, four thickness columns, a lock toggle,
and buttons to move, duplicate or delete it. The four thickness columns show
the **same** physical layer in different units, and all four are editable —
edit any one and the other three update from it. **Physical nm is the stored
value.**

| Column | Unit                  | Definition          |
| ------ | --------------------- | ------------------- |
| nm     | physical thickness    | d                   |
| OT     | optical thickness     | n(λ₀) · d           |
| QW     | quarter-waves at λ₀   | 4 · n(λ₀) · d / λ₀  |
| FW     | full-waves at λ₀      | n(λ₀) · d / λ₀      |

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
stack you meant — the right number of layers in the right order, the substrate
in the middle, the media at the edges. The per-side totals tell you how much
material the coating will take to deposit. The **Optimize** and **Eval**
badges at the top show which side the optimizer is moving and which surface is
being scored, so you always know what the numbers in the analysis windows
refer to.

Coating layers are coherent — the transfer-matrix method combines their
amplitudes. When you evaluate the whole part, the substrate is treated as
incoherent: it is optically thick, so interference inside it averages out and
the front, substrate and back contributions combine as intensities. In a
single-surface evaluation the substrate is simply a semi-infinite exit medium.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 2 (transfer matrix), §2.6.4 (two-sided combination).
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §3.1 (optical thickness units), §16 (cone response at oblique incidence).
