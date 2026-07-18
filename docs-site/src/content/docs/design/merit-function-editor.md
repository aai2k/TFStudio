---
title: Merit Function Editor
description: Targets, operands, weights and thickness constraints — what the optimizer drives toward.
ribbonIcon: merit-function
---

The **Merit Function Editor** is where you tell the optimizer what "good" looks
like. Every target the design should hit and every constraint on the layer
stack lives here, expressed as a list of **operands**. Each operand is a single
number the optimizer tries to drive toward a target value, and the merit
function (MF) is the weighted root-mean-square of how far each operand misses:

```
MF = √( Σ_i  w_i · residual_i²  /  Σ_i w_i )
```

The weight `w_i` enters linearly. The residual is `value − target` for an
equality target, or a one-sided `max(0, …)` term for an inequality or
constraint (so a satisfied constraint drops out of the sum entirely).
Wavelength-valued residuals are rescaled to optical scale first so they don't
dominate. A smaller MF is better; the optimizers — Refinement, Needle and
Gradual Evolution — move layer thicknesses to reduce it.

## Operand types

The table below is a quick orientation. The full catalog — every type, its
arguments, its output value and unit, and how it forms a residual — is on the
[Operand Reference](/design/operands/) page.

| Group                | Types                          | Output                       |
| -------------------- | ------------------------------ | ---------------------------- |
| Single-λ optical     | `T` `R` `A`                    | T/R/A at one λ               |
| Band average         | `TAV` `RAV` `AAV`              | mean T/R/A over a band       |
| Spectral target      | `TGT` `RGT` `AGT`              | deviation from a flat/ramp line |
| Weighted integral    | `TIW` `RIW` `AIW`              | source × detector weighted mean |
| Worst-case           | `TMN` `RMN` `AMN` `TMX` `RMX` `AMX` | band extremum of T/R/A   |
| Phase / field        | `PSI` `DEL` `TANPSI` `COSDEL` `GD` `GDD` `GDFLAT` `GDDFLAT` `EFMX` | ellipsometry, group delay, peak \|E\|² |
| Argmax/min λ         | `MXWT` `MXWR` `MXWA` `MNWT` `MNWR` `MNWA` | wavelength of the extremum |
| Math (reference rows)| `OPGT` `OPLT` `OPVA` `ABSO` `ABGT` `ABLT` `DIFF` `SUMM` `PROD` | derived from other rows |
| Thickness            | `TT` `MNT` `MXT`               | total / per-layer thickness  |
| Comment              | `BLNK` `DMFS`                  | inert                        |

Reflection and transmission targets are typically generated in **paired** rows
by the filter-type wizard so the optimizer can't trade absorption for an easy
win.

## Settings

**Filter-type wizard** — at the top, a set of coating categories (AR, HR,
bandpass, notch, edge filters, ramps). Pick the goal and the wizard fills in
sensible weights and operands you can then refine. The **Custom target**
category generates a single user-specified target — pick a channel (T/R/A), a
comparison (`=`, `≤`, `≥`), a value, and a wavelength range, at the chosen
polarization and angle of incidence — as a continuous line, discrete points, or
a worst-case bound.

**Operand table** — one row per operand; edit any cell inline. The **Type**
cell opens a searchable picker with the operands grouped by category (the same
control as the Design Editor's material picker). The advanced columns set each
operand's weight, angle of incidence, polarization and an optional surface-mode
override.

**Constraints** — set minimum and maximum layer-thickness bounds (`MNT`/`MXT`)
per layer or per material. A bound can be written to cover layers that
synthesis will add later.

## MF vs OMF

The header shows **two** numbers:

- **MF** — the full merit function, including the manufacturing and thickness
  constraints (`MNT`, `MXT`, `TT`).
- **OMF** — the **optical merit function**: the same RMS but counting *only the
  optical operands* (T/R/A targets, bands, and so on), with the thickness
  constraints dropped.

They separate two questions the plain MF blurs together: *how good is the
spectrum?* (OMF) versus *how good is the spectrum while honoring my thickness
limits?* (MF). When MF is high but OMF is low, the optical performance is fine
and it is a constraint — a too-thin or too-thick layer — costing you, not the
optics.

## How to read it

Each operand row shows its current value and its residual, so you can see at a
glance which targets are met and which are dragging the merit up. Bigger
weights make an operand count for more; bumping the stopband weight on an HR
design is the most common tweak.

The operand list is saved with the design and is read by every optimizer:
[Refinement](/synthesis/refinement/), [Needle](/synthesis/needle/),
[Gradual Evolution](/synthesis/gradual-evolution/) and the
[Structural Optimizer](/synthesis/structural-optimizer/). The synthesis tools
optimize against the optical operands only while they build the stack, then the
thickness constraints are enforced during Refinement — a good final sequence is
Refinement, then Cleaner, then Refinement again.

## References

- A. V. Tikhonravov, M. K. Trubetskov, G. W. DeBell, "Application of the needle optimization technique to the design of optical coatings," *Appl. Opt.* **35**, 5493 (1996).
- J. A. Dobrowolski, R. A. Kemp, "Refinement of optical multilayer systems with different optimization procedures," *Appl. Opt.* **29**, 2876 (1990).
