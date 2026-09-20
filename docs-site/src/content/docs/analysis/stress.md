---
title: Stress
description: Per-film stress, the bow a coating leaves in its substrate, and how close the stack is to cracking or letting go.
ribbonIcon: stress
---

A coating pulls on the part it is deposited on. If the substrate is thin enough
the part bends; if the film stores enough energy it cracks, or lets go of what
is under it. Stress predicts all three from the constants on your materials and
four numbers about the run.

**No stress model is as good as the optical one.** Film stress depends on the
deposition process, not only on the material, so the constants are yours to
measure and the numbers here compare one design against another rather than
predicting a part in absolute terms.

## What it needs

Every constant comes off the **Mechanical** tab of the
[Material Editor](/design/material-editor/), one set per material. The window
substitutes nothing: a constant nobody entered leaves the rows that need it
blank, and the notice badge names the material and the field.

| Quantity | Needs |
| --- | --- |
| Film stress | the film's intrinsic stress; with its modulus, Poisson's ratio, expansion coefficient and reference temperature, and the substrate's expansion coefficient, the thermal terms too |
| Strain energy | the film's stress, modulus and Poisson's ratio |
| Delamination factor | the strain energies, and the surface energy of the two materials meeting at the interface |
| Cracking parameter | every film's strain energy and surface energy |
| Edge shear | the modulus and Poisson's ratio of every film and of the substrate, and the substrate thickness |
| Radius of curvature | the substrate's modulus, Poisson's ratio and thickness |
| Centre deflection | the radius, and the substrate diameter |

## The four inputs

**T** is the temperature the part is at when you read the stress off. **T
deposition** is the temperature of the substrate while the films grow, which is
what your thermocouple or pyrometer on the planet reads. It is not the
temperature of the evaporant: the vapour arrives hot, but each atom gives up
that energy to the growing film in nanoseconds, and what fixes a film's
strain-free lateral size is the substrate lattice it bonds to.

Leave both empty and every film simply carries its intrinsic stress, which is
the honest answer for a design that describes no process. Set either one and
both apply, the other reading 20 °C.

**Substrate d** is the thickness, the same value the
[Design Editor](/design/design-editor/) carries; editing it here edits that.
The bow goes as one over its square, so it is the strongest lever in the
window. **Substrate ⌀** is the diameter, needed only for the centre deflection.

All four are saved with the design, so the same file prints the same table on
any machine.

## How a film's stress is built

The film condenses strain free at its own deposition temperature and then takes
the substrate's temperature without changing its lateral size, which is the
intrinsic strain. Its reference stress is that stress for a film deposited at
the reference temperature on its record. From there to the evaluation
temperature the film follows the substrate, and the expansion mismatch adds to
the strain. Both strains become biaxial stress through E/(1 − ν):

```
σ = σ_ref + E/(1 − ν) · [ α_f (T_ref − T_dep) + (α_s − α_f) (T − T_dep) ]
```

Tensile is positive throughout. A film that expands more than its substrate
goes tensile on cooling.

## Reading the result

The chart is a bar per film in its material's colour, tensile up and
compressive down, so the layers carrying the force are visible without reading
a number. Films are numbered 1 at the substrate, as everywhere else in
TFStudio.

**Whole part** holds what the part does. **Film force** is Σ σ·d, the quantity
Stoney's equation turns into a curvature and the same number the `STR` merit
operand targets, so a stack optimized to zero force reads zero here. **Radius
of curvature** and **centre deflection** are both positive for the convex face
a compressive coating leaves. **Cracking parameter** is the sum over films of
U/2γ: at 1 the stack has the energy to pay for the two faces of a crack.

**Per film** holds the rest. **Delamination** is the strain energy of that film
and everything outside it against the surface energy of the two materials
meeting below it; at 1 there is the energy to let go there, and the number
usually peaks at the substrate interface, which is where a coating does let go.
**Edge shear** is the peak shear at the rim of the coating, k·|F|. Under a
uniform biaxial stress the shear is zero everywhere inside the coating and
rises only at its edge, which is why coatings fail from the rim inward.

Which coatings count follows the design's evaluation mode, as in every analysis
window: the active side alone with "ignore the other side" on, both otherwise.
With coatings on both faces the two bending moments oppose, so the force is
F_front − F_back; a mirrored back coating cancels the bow exactly and the
window says so.

## Nulling the bow

A target of zero film force is the zero-deflection condition. You do not have
to reach it by hand: put an `STR` row in the
[Merit Function Editor](/design/merit-function-editor/) with a target of 0 and
the optimizer balances the stack for you. See
[Operands](/design/operands/) for how to weight it.

## References

- E. Klokholm, "Intrinsic stress in evaporated metal films," *IBM J. Res. Dev.* **31**, 585 (1987): the strain-energy criteria for cracking and delamination.
- E. Suhir, "Predicted thermally induced stresses in, and the bow of, a circular substrate/thin-film structure," *J. Appl. Phys.* **88**, 2363 (2000).
- C. A. Klein, "How accurate are Stoney's equation and recent modifications," *J. Appl. Phys.* **88**, 5487 (2000).
- C. A. Klein, "Normal and interfacial stresses in thin-film coated optics: the case of diamond-coated zinc sulfide windows," *Opt. Eng.* **40**, 1115 (2001): the interface forces, the curvature and the zero-deflection condition.
