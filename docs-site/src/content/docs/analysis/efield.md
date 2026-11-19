---
title: Electric Field Evaluation
description: The standing-wave field through the stack at one wavelength, showing where the field concentrates and which layer is most at risk of laser damage.
ribbonIcon: efield
---

The Electric Field window plots the field inside the coating against depth at one wavelength and angle. It shows **where the field concentrates in the stack**, which is what laser-damage work needs: the layer carrying the highest field is usually the one that fails first under a high-power beam.

<!-- shot: efield | quarter-wave mirror at its reference wavelength, depth axis in QWOT, avg polarization -->
![Electric Field Evaluation](/screenshots/efield.png)

## Computed quantities

- **Amplitude for 1 W/m²**, in V/m: the field for an incident beam of 1 W/m². Scaling it to a real beam is one multiplication, which is what a damage threshold is compared against. This is the default.
- **Squared, % of incident**: `|E|²` as a percentage of the incident `|E|²`, a pure ratio for comparing designs.
- **Squared, absolute**, in (V/m)² for 1 W/m²: the form an absorption estimate needs, since absorbed power follows the square of the field.

The absolute forms depend on the incident medium: a beam of given irradiance carries a weaker field in a denser medium. The dotted horizontal line is the incident beam's own level, so a field above it is being concentrated by the coating.

## Controls and settings

**Pol**: **avg**, **s** or **p**. **avg** draws the mean of s and p, with the two behind it.

**Side**: the **Front** or the **Back** coating, each seen from its own outer medium. On switching designs it moves to the side that carries a coating.

**Settings**: **Wavelength (nm)** follows the design's reference wavelength and resets to it when you switch designs, 550 nm on a design without one. **AOI (°)** runs from 0 to 89. **Quantity** is one of the three above. **Component** is the **Total field**, the part **Along the layers** or the part **Normal to the layers**; the last is zero for s and at normal incidence. **Depth axis** is physical depth from the outer surface, or optical distance `Σ n·d` in nm, in quarter waves (QWOT) or in full waves (FWOT). **λ₀** is the wavelength optical distance is measured at; **From design** takes the design's reference wavelength, so the axis matches the Design Editor's thickness column. λ₀ moves only the depth axis, never the field.

**Range warning**: a ⚠ badge appears when the wavelength lies outside a material's data range, with a button that moves λ to the nearest wavelength every material covers.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows, a numbered one holds the window on it even while it is switched off, and **All** draws every environment that is on in its own color, with the table rows led by their environment. The layer bands are the first environment's. The choice is not saved with the design.

**Results**: the field against the depth coordinate of the plot, the unit in each column heading.

## Standing waves

Peaks are antinodes of the standing wave and troughs are nodes. Right at the outer surface the field at normal incidence is the incident field times `|1 + r|`, r the amplitude reflection coefficient: 0 for a mirror whose outer layer is high index (r close to −1), up to twice the incident field when r is close to +1.

In a quarter-wave mirror at its own wavelength the peaks and nodes fall on the layer boundaries, and they shrink layer by layer into the stack, so the outer few layers carry nearly all the field. On an optical axis the nodes sit half a full wave apart, which is easier to check by eye than on a physical axis.

The square of the field is what sets the intrinsic damage level, and high-index materials are usually the weaker ones. Thinning the outer high-index layers and thickening the low-index ones, keeping each pair a half wave, moves the peaks into the low-index material.

At oblique incidence read the total field, not one component: a p-polarized node in the tangential component can sit where the normal component carries a large field.

## Theory

The field is carried back from the substrate. With `[E, H] = [1, η_s]` at the substrate, multiplying by each layer's characteristic matrix, for the whole layer or for the part of it left below a given depth, gives the tangential `[E, H]` at that depth, the admittances and phase thicknesses being those of the [Admittance Diagram](/analysis/admittance/). The incident tangential field on the same scale is `(η₀B + C)/(2η₀)`, with `[B, C]` the product through the whole stack, so

```
|E(z)|² / |E_inc|² = |E(z)|² · |2η₀ / (η₀B + C)|² · c_p
c_p = |cos θ₀|²   for p,   1 for s
```

c_p turns the tangential incident field of p-polarized light into its whole field, so every curve is a fraction of the whole incident `|E|²`.

For p-polarization the field has a normal component too, from the tangential magnetic field H in free-space units:

```
Eₙ = (n₀ sin θ₀ / N²) · H
|E_total|² = ½ ( |Eₜ|² + |Eₙ|² + |Eₜ² + Eₙ²| )
```

Eₜ and Eₙ oscillate with a phase difference, so the field vector traces an ellipse over each cycle. The total field is the square of its semi-major axis, the largest field the material sees; for s and at normal incidence it equals `|Eₜ|²`. **avg** is `(|E_s|² + |E_p|²) / 2`, since unpolarized light carries half its irradiance in each, and its amplitude is the square root of that.

The absolute scale comes from the incident irradiance I in a medium of index n₀:

```
|E_inc| = √( 2I / (ε₀ c n₀) ) = 27.4492 / √n₀  V/m   for I = 1 W/m²
```

In a stack without absorption the net irradiance T·I is the same at every depth, so the field follows from the admittance Y there, `|E|² = 2T·I / Re(Y)` with Y in siemens (Macleod, Eq. 3.6): a low admittance means a high field. That is why the peaks of a quarter-wave mirror sit on the boundaries where the admittance is lowest.

Optical distance uses the real index at λ₀: `OT = Σ n(λ₀)·d`, `QWOT = 4·OT/λ₀`, `FWOT = OT/λ₀`.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.2.1, pp. 70–75 (Eqs. 3.6–3.7): the electric field through a multilayer and its absolute value from the incident irradiance.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 16, Laser Damage, pp. 630–632: the square of the field as the measure of damage, and moving the field peaks into the low-index layers.
