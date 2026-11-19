---
title: Stress
description: Per-film stress, the bow a coating leaves in its substrate, and how close the stack is to cracking or letting go.
ribbonIcon: stress
---

A coating pulls on the part it is deposited on. If the substrate is thin enough the part bends; if the film stores enough energy it cracks, or lets go of what is under it. Stress predicts all three from the constants on your materials and four numbers about the run.

**No stress model is as good as the optical one.** Film stress depends on the deposition process, not only on the material, so the constants are yours to measure, and the numbers compare one design against another rather than predict a part in absolute terms.

<!-- shot: stress | quarter-wave TiO2/SiO2 mirror on a 1 mm, 25 mm BK7 disc, deposited at 200 °C and read at 20 °C -->
![Stress](/screenshots/stress.png)

## Computed quantities

Every constant comes off the **Mechanical** tab of the [Material Editor](/design/material-editor/). A constant nobody entered leaves the rows that need it blank, and the notice badge names the material and the field.

| Quantity | What it is | Needs |
| --- | --- | --- |
| Film stress | biaxial stress in each film, tensile positive | intrinsic stress; with temperatures set, also modulus, Poisson's ratio, expansion coefficients and reference temperature, each thermal term left out where its constant is missing |
| Strain energy | elastic energy one film stores per unit area | stress, modulus, Poisson's ratio |
| Delamination | energy of a film and everything outside it against the surface energy of the interface below; at 1 there is the energy to let go | strain energies, surface energy of both materials |
| Total strain energy | sum over the films | every strain energy |
| Cracking parameter | $\sum U / 2\gamma$; at 1 the stack can pay for the two faces of a crack | every strain energy and surface energy |
| Film force | $\sum \sigma \cdot d$, what Stoney's equation turns into a bow, and what the `STR` merit row targets | every film's stress (none stated counts as none) |
| Edge shear | peak shear at the rim of the coating | stresses, moduli and Poisson's ratios of the coating and substrate, substrate thickness |
| Radius of curvature | positive for the convex face a compressive coating leaves | film force, substrate modulus, Poisson's ratio, thickness |
| Centre deflection | bow of the centre against the rim, positive convex | the radius and the substrate diameter |

The chart is a bar per film in its material's color, tensile up and compressive down; films are numbered 1 at the substrate. Delamination usually peaks at the substrate interface, which is where a coating does let go. Under a uniform stress the shear is zero inside the coating and rises only at its edge, which is why coatings fail from the rim inward.

## Controls and settings

**T**: the temperature the part is at when you read the stress. **T deposition**: the temperature of the substrate while the films grow, what the thermocouple or pyrometer on the planet reads, not the temperature of the evaporant. Leave both empty and every film carries its intrinsic stress; set either and both apply, the other reading 20 °C.

**Substrate d**: the thickness, the same value the [Design Editor](/design/design-editor/) carries. The bow goes as one over its square, so it is the strongest lever in the window. **Substrate ⌀**: the diameter, for the centre deflection only. All four are saved with the design.

Which coatings count follows the design's evaluation mode. With coatings on both faces the two bending moments oppose, so the force is $F_\text{front} - F_\text{back}$, and a mirrored back coating cancels the bow exactly. A coating on one face reads the same on the back as on the front.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. The films and substrate are the ones that environment computes with, and with temperatures set **T** moves by the environment's temperature less environment 1's. A field the environment changes shows the value it computes with and is not edited here. The choice is not saved with the design.

## Nulling the bow

A film force of zero is the zero-deflection condition. Put an `STR` row with a target of 0 in the [Merit Function Editor](/design/merit-function-editor/) and the optimizer balances the stack; see [Operands](/design/operands/) for how to weight it.

## Theory

A film condenses strain free at its own deposition temperature, then takes the substrate's temperature without changing its lateral size, the intrinsic strain; $\sigma_\text{ref}$ is that stress for a film deposited at the material's reference temperature $T_\text{ref}$. From there to $T$ the film follows the substrate and the expansion mismatch adds:

$$
\sigma = \sigma_\text{ref} + \frac{E}{1 - \nu} \cdot \left[ \alpha_f \left(T_\text{ref} - T_\text{dep}\right) + (\alpha_s - \alpha_f) \left(T - T_\text{dep}\right) \right]
$$

The force, the curvature (Stoney, Klein 2001 Eq. 26) and the centre deflection of a disc of radius $r_0$:

$$
\begin{aligned}
F &= \sum \sigma_l d_l \\
K &= \frac{6F}{E'_s t_s^2}, \qquad E'_s = \frac{E_s}{1 - \nu_s}, \qquad R = -\frac{1}{K} \\
\omega_0 &= -\frac{1 - \cos K r_0}{K} \approx -\frac{r_0^2 K}{2}
\end{aligned}
$$

The energies (Klokholm 1987, Eqs. 1, 2 and 6), with $\gamma$ the surface energy and film $j$'s interface below it shared with film $j - 1$ or the substrate:

$$
\begin{aligned}
U_l &= \frac{\sigma_l^2\, d_l (1 - \nu_l)}{E_l} \\
\text{cracking} &= \sum_l \frac{U_l}{2\gamma_l} \\
\text{delam}_j &= \frac{\sum_{l \ge j} U_l}{\gamma_j + \gamma_{j-1}}
\end{aligned}
$$

The edge shear at the interface below film $j$ (Klein 2001 Eqs. 8 and 25), $F_j$ the force of film $j$ and everything outside it:

$$
\begin{aligned}
k &= \sqrt{\frac{\tfrac{3}{2} E_s / \left((1 + \nu_s) t_s\right)}{\sum_l E_l d_l / (1 - \nu_l^2)}} \\
\tau_\text{max} &= k \cdot |F_j|
\end{aligned}
$$

$1/k$ is the width of the strip at the rim that carries the shear.

## References

- E. Klokholm, "Intrinsic stress in evaporated metal films," *IBM J. Res. Dev.* **31**, 585 (1987): the strain-energy criteria for cracking and delamination.
- E. Suhir, "Predicted thermally induced stresses in, and the bow of, a circular substrate/thin-film structure," *J. Appl. Phys.* **88**, 2363 (2000).
- C. A. Klein, "How accurate are Stoney's equation and recent modifications," *J. Appl. Phys.* **88**, 5487 (2000).
- C. A. Klein, "Normal and interfacial stresses in thin-film coated optics: the case of diamond-coated zinc sulfide windows," *Opt. Eng.* **40**, 1115 (2001): the interface forces, the curvature and the zero-deflection condition.
