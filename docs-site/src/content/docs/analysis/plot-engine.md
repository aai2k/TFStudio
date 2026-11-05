---
title: Plot Engine
description: Plot any quantity the analysis windows compute against any other as the wavelength, the angle or a layer parameter changes, or map one quantity over two of them as a heatmap or a 3D surface.
ribbonIcon: plot-engine
---

The Plot Engine draws the numbers the other analysis windows compute against
whatever you change. In **2D** it overlays as many curves as you like, each with
its own settings: T at 0° in s beside T at 45° in p, the GDD of a chirped mirror
against the thickness of one layer, or Ψ against Δ as a layer grows.
**Heatmap** and **3D** map one quantity over two variables at once, the merit
function over two layer thicknesses among them. Each design keeps its own plots
while you move between windows.

Each quantity is computed by the same code as the window it comes from, so a
point on the plot is the number that window shows for the same settings.

| Quantity | Computed as in | Unit |
| --- | --- | --- |
| T, R, A | [Optical Evaluation](/analysis/optical-evaluation/) | % |
| Phase φ, GD, GDD, TOD of R or T | [Group Delay / GDD](/analysis/gd-gdd/) | °, fs, fs², fs³ |
| Ψ, Δ | [Ellipsometry Evaluation](/analysis/ellipsometry/) | ° |
| MF | [Merit Function Editor](/design/merit-function-editor/) | none |

T, R and A are averaged over the design's cone of incidence when it has one.
The phase, the delays, Ψ and Δ are computed at a single angle, as their own
windows compute them.

## The control row

**2D**, **Heatmap** and **3D** choose what the window draws. In 2D the row holds
**Curves**, the list of curves with **Add curve** at its top. In Heatmap and 3D
it holds **Settings**, the quantity and the two axes of the map.

Curves compute again by themselves when the design or a curve changes. On a
design without a cone of incidence, curves of T, R, A, Ψ and Δ come back at
once. The phase, the delays and MF take longer, as does any curve under a cone,
and are computed in the background: **Stop** shows on the row while they run,
and **Compute** starts them again after a stop. A curve keeps its old line
until the new one is ready, and renaming, recolouring or hiding a curve
computes nothing.

A map is computed when you press **Compute**. A bar under the row and a counter
on the plot show how far it has got, and **Stop** ends it. Changing a setting
clears the map until you compute it again.

## 2D curves

Each curve starts with a box that shows or hides it, its colour, its name and a
button that deletes it, followed by these settings:

**Sweep**: what changes along the curve: **Wavelength (nm)**, **AOI (°)**, or
the thickness of one front layer, listed by its number and material with L1
on the substrate.

**Range**: from, to and **Step**. A new **Sweep** starts on a range that suits
it, such as 0 to 60° for AOI or a band around the layer's own thickness.

**Fixed**: the λ and AOI the curve is read at. The one the curve changes is
greyed, and so are both when nothing on the curve reads them, as with MF, which
takes each operand's own.

**X** and **Y**: what each axis shows. Either the value the curve changes,
listed under its own name (λ, AOI, or the layer's d), or any quantity in the
table above. Pick a quantity for both and the curve traces one against the
other: Ψ on X and Δ on Y, with the outermost layer's thickness changing, is the
path an in situ ellipsometer follows while that layer is deposited. Beside the
quantity sit its polarization (**avg**, **s** or **p**) and its side (**Front**,
**Back** or **Total**). Ψ and Δ take s and p together, so their polarization is
greyed. Ψ, Δ and a reflected phase or delay belong to one surface and offer
Front and Back only. **Total** on a transmitted phase or delay is the whole
part, the back coating and one pass through the substrate included, as in
[Pulse Analysis](/analysis/pulse-analysis/).

**Dash** and **Width**: how the line is drawn.

MF is one number for the whole design, so on a curve it only changes along a
layer's thickness. Picking MF for an axis moves a curve on wavelength or AOI
onto a layer's thickness. It needs at least one enabled operand in the Merit
Function Editor.

## Heatmap and 3D

**Settings** holds one map:

**Quantity (Z)**: T, R, A, GD, GDD and TOD of R or T, Ψ, Δ, or the **Merit
Function**. The phase itself is left out: it is unwrapped along a line, and over
a grid there is no single way to unwrap it. **Polarization** and **Surface**
follow the quantity as they do on a curve.

**X axis** and **Y axis**: **Wavelength (nm)**, **AOI (°)**, or the thickness
of one front layer, listed as on a curve, each with a range and a number of
**steps**. The Merit Function needs a layer thickness on both axes, so it maps
a design of two layers or more.

**λ fixed** and **AOI fixed**: shown for whichever of the two is on neither
axis, and not for the Merit Function, which takes each operand's own.

**Colors**: the colorscale.

The number of grid points is shown at the foot of the panel. A fine grid over a
thick stack takes a while, so start coarse.

## How to read it

In 2D each kind of quantity gets its own Y axis: T, R and A share one from 0 to
100%, Ψ and Δ share one in degrees, and the phase, GD, GDD and TOD get one each.
The first is on the left and the others on the right. While every curve has the
value it changes on X, hovering reads all of them at the pointer; a curve with a
quantity on X can double back on itself, as a Ψ-Δ path does, and is read point
by point.

A GDD curve against one layer's thickness shows how far an error in that layer
moves the dispersion, and a cut of MF along one thickness shows whether the
design sits at the bottom of its valley. A map of T or R over wavelength and AOI
is the picture [Wavelength vs Angle](/analysis/wavelength-angle-map/) draws; a
map of GD over the same two shows where the delay ripple moves as the light
tilts; MF over two thicknesses is the landscape the optimizer searches, and
shows whether a refined design sits in a real basin or has a better one nearby.

The **Results** strip below the plot holds every point as numbers, and
**Export** writes them to CSV. The chart's own toolbar exports the picture as
PNG or SVG.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 2.
