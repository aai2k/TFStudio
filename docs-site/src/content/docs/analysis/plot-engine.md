---
title: Plot Engine
description: Build custom multi-curve XY plots, or map a quantity over two swept variables as a surface or heatmap.
ribbonIcon: plot-engine
---

The Plot Engine is a flexible plotting workbench. In **2D** mode you overlay as
many curves as you like, each with its own settings — for example T at 0° s-pol
beside T at 45° p-pol beside R for the total system — on one chart. In **3D**
mode you map a single quantity over two swept variables as a rotatable surface or
a heatmap, including the merit-function landscape your design sits in. The sidebar
toggle switches modes, and each design's plots are remembered as you move between
windows.

## Settings

### 2D curves

Add a curve and configure it:

**X axis** — wavelength (nm) or AOI (°), with a from/to range and step.

**Y** — the channel to plot: T, R or A.

**Polarization** — s, p or averaged.

**Surface** — front, back or total.

**AOI fixed / λ fixed** — the value held constant for whichever of AOI or
wavelength is not the x-axis.

**Dash / width / color** — line appearance, and a visibility checkbox per curve.

### 3D surface

**Quantity (Z)** — what to map: **T**, **R**, **A**, or the **Merit Function**.
For an optical quantity you also pick a polarization and surface mode. The merit
function is exactly the quantity the optimizer minimizes, so the surface shows the
basin your design occupies.

**X axis / Y axis** — each axis is built in two steps: choose the target
(wavelength, AOI, or a specific layer, listed one per layer), then, for a layer,
the property to vary (thickness, n or k). Set a from/to range and a step count.
Sweeping a layer's n or k temporarily substitutes a constant-index material for
that layer. Merit-function axes must be layer parameters — wavelength and AOI are
integrated out of the merit function and are rejected.

**Fixed λ / AOI** — shown only for whichever of wavelength or AOI is not on an
axis.

**Render** — a 3D surface or a flat heatmap.

**Colors** — the colorscale (Viridis, Cividis, Jet, and others).

**Compute surface** — runs the grid. The point count is shown beneath the button,
and a counter reports progress; large grids stay responsive while they compute.
Per-axis steps and the total grid size are capped to keep runs manageable.

## How to read it

In 2D, every visible curve is drawn on a shared T / R / A axis (fraction), so
overlaying curves with different angles, polarizations or surface modes lets you
compare them directly. Use it for angle-of-incidence sweeps (one curve per angle)
or polarization comparisons.

In 3D, a T/R over wavelength × AOI surface is an angle-robustness map, while a
merit function over two layer thicknesses is the optimization landscape — handy
for confirming a refined design sits in a genuine basin or for spotting a better
one nearby. You can export any plot as PNG or SVG from the chart's built-in
toolbar.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 2.
