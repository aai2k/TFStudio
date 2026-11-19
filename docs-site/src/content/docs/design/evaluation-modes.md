---
title: Surface & Evaluation Modes
description: The two Design Editor controls that decide which coating the optimizers move and whether results are for one surface or the whole part.
---

A part can carry a coating on each face, and its performance can mean one coating alone or the whole part. Two controls in the [Design Editor](/design/design-editor/) settle which coating you design and what every result means. They are saved with the design, and every window whose result depends on them follows them, so two windows never score the same design differently.

## Controls

**Surface**: **Front**, **Back** or **Both**, the coating the optimizers move. Under **Both**, **Symmetric (back = front)** makes the back coating the mirror of the front, so both faces carry the same coating and move together.

**Ignore other side**: checked, the active coating is evaluated alone on a semi-infinite substrate, with no light back from the rear face. Unchecked, the whole part is evaluated: front coating, finite substrate and back coating. Under **Both** it is unchecked and greyed, since two coatings always make a whole part. A new design starts at **Front** with **Ignore other side** checked.

On a design with [environments](/design/environments/), each environment from the second on has its own **Ignore other side**.

## Combinations

The tab of an ignored coating is greyed in the layer table; its layers stay in the design and come back when the box is cleared.

| Surface | Ignore other side | Front tab | Back tab | Optimizers move | Evaluated |
|---|---|---|---|---|---|
| Front | checked (default) | active | greyed | front | **FRONT** |
| Front | cleared | active | active | front | **TOTAL** |
| Back | checked | greyed | active | back | **BACK** |
| Back | cleared | active | active | back | **TOTAL** |
| Both | greyed | active | active | both | **TOTAL** |
| Both, Symmetric | greyed | active | greyed, mirrors front | both, as one | **TOTAL** |

Front with the box cleared and Both evaluate the same thing; they differ only in what the optimizers may move. With Front, a back coating is counted but held fixed.

## Badges

Every window whose result depends on these controls shows a read-only **Eval: FRONT / BACK / TOTAL** badge, the same in all of them. Optimizer windows add **Optimize: FRONT / BACK / BOTH / BOTH (sym)**. Windows that show one coating at a time, such as the admittance diagram, electric field, group delay and ellipsometry, choose their side themselves and show no Eval badge.

## Substrate models

| Evaluated | Substrate | Rear face |
|---|---|---|
| FRONT or BACK | Semi-infinite: light that enters it never returns | None |
| TOTAL | Finite and incoherent: light reflected inside adds as intensity, with the bulk absorption over its thickness | The bare face, or the back coating |

## Theory

A substrate many wavelengths thick, under light of finite bandwidth, sums its internal reflections in intensity rather than amplitude (Macleod, Section 2.14). With R_f, T_f the front coating seen from the incident medium, R_f′, T_f′ the same coating seen from inside the substrate, R_b, T_b the back coating between substrate and exit medium, and P the transmittance of one pass through the bulk:

```
P = exp(−4π k_s d_s / (λ cos θ_s))
T = T_f P T_b / (1 − R_f′ R_b P²)
R = R_f + T_f T_f′ R_b P² / (1 − R_f′ R_b P²)
A = 1 − R − T
```

with k_s the substrate's extinction coefficient, d_s its thickness and θ_s the refracted angle inside it. Each polarization is summed on its own and the two then averaged. Each coherent pass is the usual characteristic-matrix result for that coating. With P = 1 and no absorption, T reduces to Macleod's Eq. 2.165, T = T_a T_b / (1 − R_a R_b). A is what the two coatings and the bulk absorb together.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 2.14, pp. 60–63 (Eq. 2.165): incoherent reflection at two or more surfaces.
