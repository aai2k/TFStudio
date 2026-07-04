---
title: Systematic Deviations
description: Apply a correlated thickness or index shift across the whole stack and see — or sweep — its effect on the spectrum.
ribbonIcon: systematic-dev
---

Systematic Deviations answers "what-if" questions where every layer drifts the
same way at once: what if all layers ran 2 % thick, what if the coater is +5 nm
long on every layer, or what if a material's index shifted by Δn = +0.05? Unlike
[Monte-Carlo](/analysis/error-analysis/), the error here is correlated — one
deliberate offset applied across the design rather than an independent random draw
per layer. Your design is never modified; the deviation is applied to a working
copy and the result is overlaid against the unperturbed spectrum.

The analysis runs for the surface mode set in the
[Design Editor](/design/design-editor/), shown as a badge on the window.

Each layer's thickness becomes `d′ = max(0, d · scale + offset)`. The scale is
multiplicative (global scale × per-material scale) and the offset is additive
(global offset + per-material offset). The offset can be entered in four units,
converted to physical nanometres per layer at the design reference wavelength λ₀:

- **nm** — physical nanometres, used directly.
- **OT** — optical thickness in nm; divided by n(λ₀).
- **QW** — quarter-waves at λ₀.
- **FW** — full-waves at λ₀.

## Settings

**Single / Sweep** — the two working modes (described below).

**λ range / step** — the wavelength grid, in nanometres.

**AOI / pol** — angle of incidence and polarization (s, p, or averaged).

In **Single** mode you build one fixed deviation and overlay it on the baseline:

**d × scale** — the thickness multiplier.

**d + offset** — a flat thickness offset, with the nm / OT / QW / FW unit
selector beside it.

**Δn / Δk** — additive shifts to the real and imaginary index (k stays ≥ 0).

These appear once as a **Global** deviation applied to the whole stack, and again
per material under **Per-material**. Per-material values combine with the global
ones — additively for Δn and Δk, multiplicatively for the scale — so you can say
"everything +2 %, but TiO₂ also overshot by +3 nm". Each per-material row lists
every place that material appears, including the incident and exit media; a
material in more than one role is shown once with all of them (for example,
`Air (incident, exit)`), and editing it governs that material everywhere.

**T+R+A / T / R / A** — which channel(s) to plot.

**baseline** — overlay the unperturbed spectrum behind the deviated one.

**Reset deviations** — return every control to its no-op value.

In **Sweep** mode you vary one parameter across a range and map the result:

**Sweep parameter** — any one of the global or per-material controls above.

**from / to / steps** — the range and resolution. The range re-seeds itself to
sensible defaults when you switch parameter kinds, and stays fully editable.
Offset parameters carry their own nm / OT / QW / FW unit selector.

**Run sweep** computes the map. The sweep is self-contained: it varies only the
chosen parameter, starting from the unperturbed design, so the Global and
Per-material panels are hidden in this mode. To combine a fixed deviation with a
sweep, set the fixed part up in Single mode first.

## How to read it

In Single mode the chart is in **percent**, with the baseline drawn dotted and
the deviated spectrum solid on top — the gap between them is the cost of the
deviation. If the design has a Specification, a live verdict tells you whether
the deviated design still passes.

In Sweep mode the result is a heatmap of parameter value (vertical) against
wavelength (horizontal), with the channel value as color (also in percent);
choosing T+R+A stacks three maps. The vertical axis is labelled with the swept
parameter and its unit. A broad, slowly-changing band means the design tolerates
that error well; a narrow, fast-changing one means it is on a knife edge.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §13.7.
