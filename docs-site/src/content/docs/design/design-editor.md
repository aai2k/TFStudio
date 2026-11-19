---
title: Design Editor
description: "Build and edit the coating: layer stack, substrate, media, and the surface you are designing."
ribbonIcon: design-editor
---

The Design Editor is where a coating is built: its layers, their materials and thicknesses, the substrate and media, and the surface being designed. Every other window reads this one design, so a change here shows everywhere at once. A design carries a **Front coating** on the incident side and a **Back coating** on the exit side; in both tabs the layer touching the substrate is listed first.

<!-- shot: design-editor | the 27-layer chirped mirror: its layer table with the four thickness columns, and the stack geometry strip under it -->
![Design Editor](/screenshots/design-editor.png)

## Computed quantities

The four thickness columns show the same layer in different units; edit any one and the others follow. The physical thickness in nm is the stored value.

| Column | Meaning |
|---|---|
| **nm** | physical thickness $d$ |
| **OT** | optical thickness at $\lambda_0$ |
| **QW** | quarter waves at $\lambda_0$ |
| **FW** | full waves at $\lambda_0$ |

**Stack Geometry** under the table draws the incident medium, front coating, substrate, back coating and exit medium in the materials' colors, with the layer count and total physical thickness of each side.

## Controls and settings

### Settings

**Reference λ₀ (nm)**: the wavelength of the OT, QW and FW columns. Changing it keeps each layer's quarter-wave count and rescales its physical thickness.

**Substrate**: material and thickness in mm. **Incident medium** and **Exit medium**: usually air; any catalog material for an immersed or cemented part.

**Surface** and **Ignore other side**, in the bar at the top: which coating the optimizers move and what every window evaluates, as set out in [Surface & Evaluation Modes](/design/evaluation-modes/).

**Average over illumination cone**, off by default: every R, T and A is averaged over a cone of angles about the angle of incidence, in every window and merit row at once. The half-angle shows its NA, f-number and full aperture. The intensity across the cone is **Uniform**, **Lambertian** or **User-defined** from a table, and **Grid points** is where the angle count starts ([cone of illumination](#cone-of-illumination)).

**Environment**: on a design with more than one [environment](/design/environments/), a droplist with arrows either side picks the environment the Settings show. The media, substrate, cone, **Ignore other side** and **Temperature** are then that environment's; in environment 2 or later a change sets the field for it alone, tagged with its number and a cross that gives it back, or **= env 1** while it follows. $\lambda_0$ and **Surface** belong to the design, and the layer table is the same recipe in every environment.

### Layer table

Each row is one layer: material, the four thickness columns, a lock, and buttons to move, duplicate or delete it. A locked layer keeps its thickness in every optimizer and synthesis run. The toolbar adds and removes layers, inverts the order, locks or unlocks a whole side, and copies the stack to the other side.

**+ Layer** adds a layer below the selected row, or at the bottom, and selects it. A new layer copies the layer two rows away on the far side of its neighbour, so alternating high and low layers carry on. With no such layer, or one of the neighbour's material, it is a quarter wave at $\lambda_0$: SiO2 next to a material of higher index than SiO2, TiO2 next to anything else, SiO2 on an empty side.

| Input | Does |
|---|---|
| Arrow on a thickness cell, wheel over the outlined cell | Steps 1 nm in nm and OT, 0.1 in QW, 0.025 in FW; Shift ×10, Ctrl ×0.1. Held, it repeats. With several rows selected, all step, each in its own optical thickness. |
| Arrow keys | Move between cells, from the row number through Material to FW. |
| Typed number, Enter or F2 on a thickness | Edits the cell. |
| Double-click, chevron, typed letter or Enter on Material | Opens the material picker, searching for a typed letter. |
| Shift+arrows, Shift-click, drag | Selects a rectangle of cells; Escape drops it. Delete and stepping act on every row it spans. |
| Click, Shift-click, Ctrl-click on the row number | Selects one layer, a run, or adds a row. |
| Insert, Shift+Insert, Delete | Adds a layer above or below the focused row; deletes the selected rows except locked ones. |
| Ctrl+C, Ctrl+V on cells | Copies as tab-separated text; pastes down and to the right, a number in the column's unit and a name on Material looked up in the design's materials, then the catalogs. Over a rectangle the values repeat to fill it. |
| Ctrl+C, Ctrl+V on the row number | Copies and pastes whole layers with materials and locks; pasted on a cell they go in below its row. |

A whole run of steps or one paste is one Ctrl+Z. A paste leaves locked layers as they are, drops values past the last row, and ignores text that is neither a number nor a material name.

### Tools

**Tools…** above the table holds edits over the whole design or one side; each edit is one undo step.

- **Replace material…**: puts another material in place of any material of the media, substrate or layers. **Keep optical thickness (n·d)** rescales each changed layer to keep $n \cdot d$ at $\lambda_0$.
- **Round / quantize thicknesses…**: rounds every unlocked layer to **Decimal places**, to a **Controller step (nm)**, or to a **QWOT increment** at $\lambda_0$, showing **MF before** and **MF after**.
- **Perturb thicknesses…**: one random kick per unlocked layer within **Maximum kick (±%)**; the preview keeps one sample until **Reshuffle**.
- **Copy stack as table**: the side's materials and thicknesses as tab-separated text.
- **Collapse selection to Herpin layer…**: replaces a selected symmetric, lossless group with its one equivalent layer at $\lambda_0$, keeping the group inside it so **Expand Herpin layer** restores it exactly. The equivalence holds at $\lambda_0$ and normal incidence only.
- **Save coating to library…**: saves the front or back stack to the [Coating Library](/design/coating-library/).

## Cone of illumination

- **Grid points** is a starting count. TFStudio doubles the count of angles until two doublings in a row each change R, T or A by less than 0.01 %, uses the count before the last doubling, and stops doubling before 480. One agreement is not enough: two coarse counts can miss a sharp peak alike. A broadband AR settles at the grid points or twice them; a narrowband filter needs more, since its passband moves across the cone.
- The merit function settles the count at each wavelength a row samples, so only wavelengths near a sharp resonance get extra angles; plot windows use one count for the whole curve.
- Rays past grazing never reach the coating. When the angle of incidence plus the half-angle passes 90°, the average covers only the rays that meet the surface, and the cone settings warn when a merit row is at such an angle.
- s and p are still computed under a cone but are formal: each ray has its own plane of incidence, so only the polarization average is rigorous.

## Theory

The thickness columns, with $n(\lambda_0)$ the real part of the layer's index at $\lambda_0$ (Macleod, Section 3.1):

$$
\begin{aligned}
\mathrm{OT} &= n(\lambda_0)\, d \\
\mathrm{QW} &= \frac{4\, n(\lambda_0)\, d}{\lambda_0} \\
\mathrm{FW} &= \frac{n(\lambda_0)\, d}{\lambda_0}
\end{aligned}
$$

Under a cone, each result $Q$ is averaged over the rays that reach the surface, $\alpha$ being a ray's angle to the cone axis and $\theta$ its angle of incidence:

$$
\begin{aligned}
\bar Q &= \frac{\iint Q(\theta)\, I(\alpha)\, d\Omega}{\iint I(\alpha)\, d\Omega} \\
I(\alpha) &= 1\ \text{(Uniform)}, \quad \cos\alpha\ \text{(Lambertian)}, \quad \text{interpolated from the table (User-defined)} \\
\mathrm{NA} &= n_0 \sin\alpha_{\max}, \qquad f\text{-number} = \frac{1}{2\,\mathrm{NA}}
\end{aligned}
$$

The integral over the cone reduces to one over $\theta$ and is taken by Clenshaw–Curtis quadrature. A narrow passband moves by about $\Delta\lambda/\lambda = \sin^2\theta / (2 (n^*)^2)$ at incidence $\theta$, $n^*$ its effective index (Macleod, Eq. 8.39), which is why a narrowband filter needs many angles. Coating layers are coherent and combined by the characteristic matrix; a whole part's substrate is incoherent, as set out in [Surface & Evaluation Modes](/design/evaluation-modes/).

The tools change each unlocked layer as follows, $s$ being the controller step, $m$ the QWOT increment and $p$ the kick as a fraction:

$$
\begin{aligned}
\text{keep } n \cdot d\text{:} \quad & d' = d \cdot \frac{n_\text{old}(\lambda_0)}{n_\text{new}(\lambda_0)} \\
\text{step:} \quad & d' = s \cdot \operatorname{round}(d / s) \\
\text{QWOT:} \quad & d' = q \cdot \operatorname{round}(d / q), \qquad q = \frac{m \lambda_0}{4\, n(\lambda_0)} \\
\text{perturb:} \quad & d' = d\,(1 + p u), \qquad u \text{ uniform on } [-1, 1]
\end{aligned}
$$

A symmetrical group of lossless layers has a characteristic matrix at $\lambda_0$ of the form of a single layer (Macleod, Section 7.2.2, Eqs. 7.5–7.10):

$$
\begin{aligned}
M_{11} = M_{22} &= \cos\gamma, \quad M_{12} = \frac{i \sin\gamma}{E}, \quad M_{21} = i E \sin\gamma \\
E &= \sqrt{M_{21} / M_{12}}, \qquad d_\text{eq} = \frac{\gamma \lambda_0}{2\pi E}
\end{aligned}
$$

with $E$ the Herpin index and $\gamma$ the equivalent phase, taken on the branch nearest the group's total phase. A group in a stopband at $\lambda_0$, where $\lvert M_{11}\rvert > 1$, has no real $E$ and is refused.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 3.1, pp. 65–66: quarter- and half-wave optical thicknesses. Section 7.2.2, pp. 216–219 (Eqs. 7.5–7.10): symmetrical multilayers and the Herpin index.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Section 8.2.5.4, p. 314 (Eqs. 8.39–8.46): a filter in a cone of illumination; Chapter 16, pp. 607–614: cones of illumination and cone response at oblique incidence.
- C. W. Clenshaw and A. R. Curtis, "A method for numerical integration on an automatic computer," *Numer. Math.* **2**, 197-205 (1960).
