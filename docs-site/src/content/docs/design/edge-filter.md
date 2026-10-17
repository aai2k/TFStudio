---
title: Edge Filter
description: Build an edge filter from two materials whose s and p edges fall at the same wavelength at an oblique angle of incidence.
ribbonIcon: edge-filter
---

**Edge Filter** builds a shortwave-pass or longwave-pass filter from two materials for use at an oblique angle of incidence, with the edge for s-polarized and for p-polarized light at the same wavelength. You give the edge wavelength, the angle and the materials; the window finds the periods that do it, previews the finished filter, and puts it into the design.

A quarter-wave stack used at 45° splits: its s edge and its p edge sit apart, and for unpolarized light the edge is no steeper than that split. No choice of the two thicknesses of a (0.5H L 0.5H) period removes it. A five-layer period can:

```
aA bB cA bB aA
```

with A and B the two materials and a, b and c quarter-wave multipliers at the edge wavelength. For some values of a there are values of b and c that put the s and p edges together at the chosen angle. The window searches a range of a and lists the periods it finds.

## What the edge is

The edge is the edge of the high-reflectance zone of an endless stack of the period. A symmetrical period acts like a single layer, and where the diagonal term of its characteristic matrix, N11, lies outside −1 to 1, light cannot pass through many periods of it; the zone ends where N11 = ±1. This is a property of the period alone. The number of periods, the substrate and any matching layers you add later do not move it.

The edge of a finished filter, where its transmittance crosses 50 %, sits close to the zone edge and closes in on it as periods are added. The p edge of a stack is a little less steep than the s edge, so with few periods and no matching layers the two 50 % points lie a fraction of a nanometre to a few nanometres apart even though the zones start at the same wavelength. The preview shows the finished filter, so you see both.

## Settings

**Shortwave pass / Longwave pass**: which side of the edge transmits. For a shortwave pass the rejection band lies above the edge wavelength.

**Edge λ**: the wavelength where both zones start. The period is written in quarter waves at this wavelength.

**Angle of incidence**: the angle in the incident medium at which s and p are brought together, between 0° and 90°. At normal incidence there is nothing to bring together.

**Periods**: how many periods the filter has. It does not change the search, only the filter that is previewed and applied.

**Incident medium** and **Substrate**: the media around the filter. The search uses the incident medium; the substrate is used by the preview and goes into the design.

**Material A** and **Material B**: the two materials. The window opens with the lowest- and highest-index materials of the design's front coating, or SiO2 and TiO2 when it has fewer than two.

**a from**, **a to**, **Step of a**: the range searched for the outer layers. The start lies between 0 and 1, the end above the start and at 2 or below, and the step between 0.0001 and 1. The default 0.1 to 1 in steps of 0.05 is usually enough; a finer step takes longer.

## The search

For each value of a the window finds the values of b for which the s and p zone edges meet at the edge wavelength, and for each of them the c that puts them there. It tries the period both ways round, with A outside and with B outside, and keeps only the periods whose s and p zones both lie on the side of the edge the filter blocks.

The search takes each material's refractive index at the edge wavelength and treats the layers as lossless. When a material absorbs there, the window says so; the search uses its n alone, and the preview uses the full n and k. Away from the edge wavelength the indices of real materials change, which the preview shows and the zone widths in the table do not.

The window searches when it opens. After changing a setting the search uses, press **Search** again. The search runs in the background, and **Stop** ends it.

## How to read it

Each period found is a row: the material outside, a, b and c, the width of the s zone and of the p zone from the edge, and the width of the pass region from the edge to the next zone of either polarization. All widths are in nanometres and use the indices at the edge wavelength; ∞ means no further zone.

The best period is listed first and picked. Unpolarized light is rejected only where both zones are, so the narrower of the s and p zones is the rejection band of the filter, and the periods are ranked by that width, widest first. A tie goes to the wider pass region. Click another row to preview and apply that period instead.

Below the table the plot shows the finished filter's transmittance for s, p and their mean at the angle of incidence, with the edge wavelength marked. The table and the plot share the space; drag the bar between them to give either more room.

## Putting it into the design

The **Formula** box holds the picked period in [Stack Formula](/design/stack-formula/) notation, with H the material of higher index at the edge wavelength and L the other. For the built-in SiO2 and TiO2 with the edge at 510 nm and 45° in air it is `(0.4H 0.593622L 0.294978H 0.593622L 0.4H)^19`. Select it to copy it, or press **Open in Stack Formula** to continue there with the formula, the materials and the edge wavelength filled in, for instance to add matching layers around it.

The buttons at the bottom work as in Stack Formula. **Replace** puts the filter in place of the chosen side's coating, **Append** adds it outside the coating already there, and **New design** makes a new design with it. Replace also sets the design's reference wavelength to the edge wavelength and its substrate to the one chosen here, and the incident medium becomes the incident medium of a front coating or the exit medium of a back one. Where two periods meet, their outer layers are one material and go into the design as one layer of the summed thickness.

The search does not look at the ripple in the pass band, which depends on how well the period's equivalent admittance matches the media. To smooth it, refine the filter with [Refinement](/synthesis/refinement/) with every layer locked but a few at either end.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §7.2.2 (symmetrical periods), §9.5.1, Eq. 9.21 (edge filters at an intermediate angle of incidence).
- A. Thelen, "Nonpolarizing edge filters," *J. Opt. Soc. Am.* **71**, 309-314 (1981).
