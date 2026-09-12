---
title: Electric Field Evaluation
description: The standing-wave field profile through the stack.
ribbonIcon: efield
---

The Electric Field window plots the field inside the coating against depth at a chosen wavelength. It shows **where the field concentrates inside the stack**, the key piece of information for laser-damage work, since the layer carrying the highest field is usually the one that fails first under a high-power beam. It also makes it clear why a particular layer's thickness matters so much to performance.

At every depth the window combines the forward- and backward-travelling waves, matched across each layer boundary. In a high-reflectance mirror the field just outside the first surface reaches twice the incident amplitude, because the incident and reflected waves add nearly in phase.

## Settings

**Wavelength**: the single wavelength at which the standing-wave profile is computed, in nm. It defaults to the design's reference wavelength.

**AOI**: the angle of incidence in degrees.

**Polarization**: s, p, or their average. At oblique incidence s and p give different profiles, so compare them when working at an angle.

**Quantity**: what the vertical axis reads.

- *Amplitude for 1 W/m² incident*, in V/m. An absolute field strength, for an incident beam carrying one watt per square metre. Scaling it to a real beam is one multiplication, which is what you want when the question is whether a layer will survive a pulse. This is the default.
- *Squared field, fraction of incident*, as a percentage of the incident `|E|²`. A pure ratio, useful for comparing designs rather than beams.
- *Squared field, absolute*, in (V/m)², again for 1 W/m² incident. The form that goes into an absorption estimate, since absorbed power follows the square of the field.

The absolute forms depend on the incident medium, because a beam of a given irradiance carries a weaker field in a denser medium: for irradiance `I` in a medium of index `n`, `|E| = sqrt(2I / (ε₀cn))`. A 1 W/m² beam has an amplitude of 27.4492 V/m in air and that divided by the square root of the index in anything else.

**Component**: which part of the field is drawn.

- *Total field*, the resultant. This is the curve to read unless you specifically want a component.
- *Along the layers*, the component parallel to the layer boundaries.
- *Normal to the layers*, the component perpendicular to them.

At normal incidence, and for s-polarization at any angle, the field lies entirely along the layers, so the normal component is zero and the total equals it. Only p-polarization at an angle splits into two, and there the two components together are what the material sees.

**Depth axis**: what the horizontal axis measures.

- *Physical depth*, in nm, measured from the outer surface. This is the default.
- *Optical distance (nm)*, the running sum of `n·d` through the stack.
- *Optical distance (QWOT)* and *(FWOT)*, that same optical distance divided by the reference wavelength, in quarter waves or full waves.

**λ₀**: the wavelength the optical units are measured at. It does not enter the field calculation, only where the curve's depths land, so it is inert while the axis reads physical depth. **From design** takes the design's own reference wavelength, which is what the Design Editor's thickness column uses, so the axis and the layer table carry the same numbers: a layer that reads 0.25 FWOT in the table spans 0.25 on the axis, and a peak can be traced back to a row. Clear the box to type another λ₀, for reading a stack against a wavelength it was not written in. Either way the axis title says which wavelength is in force, and the axis describes the stack: changing the wavelength the field is computed at moves the curves, not the boundaries.

**Side**: profile the **front** coating or the **back** coating. Each side shows that coating's standing wave on the substrate, evaluated from its own incident medium; the substrate is the exit medium.

## How to read it

The horizontal axis runs from the incident medium into the substrate; vertical dotted lines and the coloured bands mark the layer boundaries and materials. A horizontal dotted line marks the incident beam's own level, so a field above it is being concentrated by the coating rather than merely passed through. Peaks are field anti-nodes and troughs are nodes.

On an optical axis the nodes of a quarter-wave stack fall half a full wave apart at the wavelength the stack is tuned to, which is easier to check by eye than the uneven spacing a physical axis gives when the layers have different indices.

For laser-damage work the layer containing the highest field is the bottleneck, and lowering the field there raises the damage threshold. In a well-designed mirror the anti-nodes sit preferentially in the more robust material, which is part of why mirrors tolerate high power. Read the total field for this, not one component: at oblique incidence the p-polarized field can have a node in its tangential component at a depth where the resultant field is not small at all, because the normal component carries the field there instead.

The data table lists the field against the same depth coordinate as the plot, with the unit in each column heading, and exports to CSV. Reading the field against the [Refractive Index Profile](/analysis/refractive-index-profile/) shows which layer the standing-wave peak lands in.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 3 (Eqs. 3.5–3.6), fields in thin films.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Admittance Loci, for the absolute field from the incident irradiance, and Laser Damage, for why the square of the field is what counts.
