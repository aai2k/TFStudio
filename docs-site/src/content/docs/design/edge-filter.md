---
title: Edge Filter
description: Build an edge filter from two materials whose s and p edges fall at the same wavelength at an oblique angle of incidence.
ribbonIcon: edge-filter
---

Edge Filter builds a shortwave-pass or longwave-pass filter of two materials for an oblique angle of incidence, with its s and p edges at the same wavelength. A quarter-wave stack at 45° splits its s and p edges, and no choice of the two thicknesses in a (0.5H L 0.5H) period brings them together. A five-layer period can:

$$
a\,\mathrm{A}\;\; b\,\mathrm{B}\;\; c\,\mathrm{A}\;\; b\,\mathrm{B}\;\; a\,\mathrm{A}
$$

with $\mathrm{A}$ and $\mathrm{B}$ the two materials and $a$, $b$ and $c$ quarter-wave multipliers at the edge wavelength. For some values of $a$ there are a $b$ and a $c$ that put the s and p edges together at the chosen angle; the window searches a range of $a$ and lists the periods it finds.

<!-- new:edge-filter | SiO2 and TiO2, shortwave pass, edge at 510 nm, 45° in air, 19 periods: the periods listed with the best one picked, and the finished filter's s, p and mean T below with the edge marked -->

## Computed quantities

| Column | Meaning |
|---|---|
| **Outside** | The material of the outer layers. |
| **a, b, c** | The period's quarter-wave multipliers at the edge wavelength. |
| **Width (nm) s, p** | Width of the s and of the p high-reflectance zone from the edge. |
| **Width (nm) pass** | From the edge to the next zone of either polarization on the pass side; $\infty$ when there is none. |

Widths use the indices at the edge wavelength. Unpolarized light is rejected only where both zones are, so the narrower of the s and p zones is the filter's rejection band: the periods are ranked by it, widest first, a tie going to the wider pass region, and the first is picked.

The plot shows the finished filter's T for s, p and their mean at the angle of incidence, with the edge marked. **Formula** holds the picked period in [Stack Formula](/design/stack-formula/) notation, H the material of higher index at the edge wavelength; for SiO2 and TiO2 with the edge at 510 nm, 45° in air and 19 periods it is `(0.4H 0.593622L 0.294978H 0.593622L 0.4H)^19`.

## Controls and settings

**Shortwave pass / Longwave pass**: the side of the edge that transmits. **Edge λ (nm)**: where both zones start. **Periods**: the number of periods in the filter previewed and applied; it does not change the search.

**Angle of incidence (°)**: from 0° to below 90°. At 0° s and p are the same wave, so the window gives the plain quarter-wave period scaled to start its zone at the edge, both ways round: (0.5L H 0.5L) first for a shortwave pass and (0.5H L 0.5H) first for a longwave pass, the better match between air and glass.

**Incident medium** and **Substrate**: the search uses the incident medium; the substrate is for the preview and the design. **Material A** and **Material B** start as the lowest- and highest-index materials of the front coating, or SiO2 and TiO2.

**a from**, **a to**, **Step of a**: the range searched, from 0 to 2 with a step of 0.0001 or more. Adding a little over 2 to $a$ puts a tilted half wave into each outer layer and gives the same $b$ and $c$ again, so the range stops at 2. The default, 0.1 to 1 in steps of 0.05, takes a fraction of a second; 0 to 2 in steps of 0.0001 takes a few minutes. The search runs off the window's thread when the window opens and on **Search**; **Stop** ends it.

The window keeps the pass type, the angle, the periods, the materials and the range of $a$ between openings; the edge wavelength and media come from the design.

**Open in Stack Formula** carries the formula, materials, media and edge wavelength there, for instance to add matching layers. **Replace**, **Append** and **New design** work as in Stack Formula; Replace also sets the reference wavelength to the edge wavelength, the substrate, and the incident or exit medium of the chosen side. Where two periods meet, the two outer layers become one layer of the summed thickness.

## Zone edge and the finished filter

- The zone edge belongs to the period alone: the number of periods, the substrate and matching layers do not move it. A finished filter's 50 % point sits near it and closes in as periods are added. The p edge is less steep than the s edge, so with few periods the two 50 % points lie a fraction of a nanometre to a few nanometres apart even when the zones start together.
- The search takes each index at the edge wavelength and the layers as lossless; for a material that absorbs there the window says so and the preview uses $n$ and $k$. Away from the edge wavelength real indices change, which the preview shows and the widths do not.
- The search ignores pass-band ripple, which depends on how the period's equivalent admittance matches the media. To smooth it, run [Refinement](/synthesis/refinement/) with every layer locked but a few at either end.

## Theory

With $\lambda_e$ the edge wavelength, a layer of multiplier $m$ and index $n$ has $d = m \lambda_e / (4n)$, phase thickness and tilted admittances (Macleod, Section 9.2, Eq. 9.2)

$$
\begin{aligned}
\delta &= \frac{2\pi n d \cos\theta}{\lambda} \\
\eta_s &= n \cos\theta, \qquad \eta_p = n / \cos\theta
\end{aligned}
$$

with $\cos\theta$ from $n_0 \sin\theta_0$. A symmetrical period of lossless layers has a characteristic matrix with real, equal diagonal terms $N_{11} = N_{22}$ (Macleod, Section 7.2.2, Eqs. 7.5–7.6). Where $|N_{11}| > 1$ the reflectance of a stack of the period tends to unity as periods are added, and the zone edges are where $N_{11} = \pm 1$ (Section 9.5.1, Eq. 9.21).

The centre layer enters linearly in $\cos\gamma$ and $\sin\gamma$, $\gamma$ its phase:

$$
N_{11} = P \cos\gamma + Q \sin\gamma
$$

with $P$ the value of $N_{11}$ with the centre layer absent and $Q$ with it a quarter wave. $\gamma$ is the same for s and p, so $N_{11} = \sigma$ ($\sigma = \pm 1$) for both polarizations at $\lambda_e$ is two linear equations in $\cos\gamma$ and $\sin\gamma$. Their solution lies on the unit circle only for particular $b$:

$$
F(b) = x^2 + y^2 - 1 = 0, \qquad x = \sigma\,\frac{Q_p - Q_s}{D}, \qquad y = \sigma\,\frac{P_s - P_p}{D}, \qquad D = P_s Q_p - Q_s P_p
$$

For each $a$ and either material outside, $F$ is sampled over one period of $b$, each root is bisected, and $c$ follows from $\gamma$. A root is kept when both zones lie on the side the filter blocks.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 7.2.2, pp. 216–219 (Eqs. 7.5–7.6): symmetrical periods. Section 9.2 (Eq. 9.2) and Section 9.5.1, p. 351 (Eq. 9.21): tilted layers and edge filters at an intermediate angle of incidence.
- A. Thelen, "Nonpolarizing edge filters," *J. Opt. Soc. Am.* **71**, 309-314 (1981).
