---
title: Inhomogeneities & Interlayers
description: Model graded transition layers between materials and see how a non-step interface changes your spectrum.
ribbonIcon: inhomogeneities
---

Deposition never makes a perfectly abrupt boundary between two materials. Inhomogeneities inserts a graded transition at any interface you pick and overlays the spectrum with the transitions against the spectrum of the design as it is. The design itself is not changed.

<!-- shot: inhomogeneities | 550 nm bandpass with every interface graded over 5 nm, Interfaces strip open, graded curves over the abrupt ones -->

## Computed quantities

- **T, R, A** in percent, each drawn twice: the design as it is as a faint dotted line (**base**), and the design with its interlayers as a solid line (**graded**). Both follow the evaluation mode set in the [Design Editor](/design/design-editor/) and its cone of incidence.
- **Spec** verdict: on a design with a [specification](/design/specification/), whether the graded design still passes, judged in every environment that is on.
- The **Interfaces** strip header counts the active interlayers and adds up their thickness.

## Controls and settings

**T / R / A**: which curves are drawn, with **avg**, **s** and **p** inside each. All polarizations are computed together, so adding one costs nothing.

**Settings**: the **λ** range, its **step** and the **AOI (°)**.

**Interfaces**: one row per interface, named by what it joins (L3 → L4, L1 → Sub), for each side the evaluation mode includes. Tick a row, or edit any of its fields, to grade that interface:

- **Thickness**, in nm: the depth of the transition. It is added at the interface; the layers on either side keep their thickness.
- **Profile**: how the index runs from one material to the other.
- **Slices**: how many homogeneous sub-layers stand in for the grade, 10 by default.

**Clear all** removes every interlayer. The interlayers stay with the design for the session but are not saved with it.

**Environment**: on a design with more than one [environment](/design/environments/), **Current** follows the environment the Design Editor shows and a numbered one holds the window on it even while it is switched off. The interlayers are one list for every environment; in the one shown each grades between the materials that meet there. The choice is not saved with the design.

## What a graded interface does

A transition a few nanometres thick has an optical thickness far below half a wavelength, so the interface still reflects almost as a step would. What it mostly adds is optical thickness of an intermediate index, which shifts the spectrum and softens stopband edges and passband ripple. Only a grade whose optical thickness is comparable to the wavelength cuts the reflection of the interface itself, which is how a graded-index antireflection coating works: Macleod shows that a smooth grade of optical thickness T reflects nothing for wavelengths below 2T and stops working near 4T.

## Theory

An interlayer of thickness t between materials A and B, sliced into N sub-layers, gives slice i the thickness t/N and the index taken at the slice's middle:

```
s_i = (i + ½) / N                      i = 0 … N−1
N_i = (1 − f(s_i)) · N_A + f(s_i) · N_B
```

n and k are mixed alike, k kept at 0 or above. Sampling the middle of each slice makes the error of the staircase fall as 1/N². The profile f runs from 0 at A to 1 at B:

```
Linear              f = s
Parabolic           f = s²
Inverse parabolic   f = 1 − (1 − s)²
Exponential         f = (e^{3s} − 1) / (e³ − 1)
Sigmoid             f = (σ(s) − σ(0)) / (σ(1) − σ(0)),   σ(s) = 1 / (1 + e^{−12(s − ½)})
```

The slices are ordinary homogeneous layers in the stack, so the spectrum is computed exactly as [Optical Evaluation](/analysis/optical-evaluation/) computes it.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 4.7, pp. 154–157: inhomogeneous layers as the limit of many thin homogeneous ones, and the graded-index antireflection coating.
