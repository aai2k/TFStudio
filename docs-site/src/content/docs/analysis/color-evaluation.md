---
title: Color Evaluation
description: CIE chromaticity, Lab and color readouts that show what your coating looks like to the eye.
ribbonIcon: color-eval
---

Color Evaluation turns a coating's spectrum into a perceived color. It takes the reflectance or transmittance across the visible range at one or more angles, weights it by a standard observer and illuminant, and shows where the result sits on a CIE color diagram, along with a patch of the color and a full set of color-space values. Use it to predict the visible appearance of a coating: the tint of an antireflection film, the hue of a decorative mirror, or how a filter shifts color with viewing angle.

The spectrum is sampled across 380–780 nm and fed through the standard colorimetric integral, so the color matches the curves shown in [Optical Evaluation](/analysis/optical-evaluation/).

## How a color is computed

The eye sees color with three kinds of cones. Colorimetry stands in for them with three color-matching functions, x̄, ȳ and z̄, which the CIE measured on observers: the 1931 2° observer for a small patch looked at straight on, the 1964 10° observer for a larger one. The light that reaches the eye is the illuminant's spectrum times the coating's R or T. Weighted by each matching function and summed over 380–780 nm, it gives three numbers, X, Y and Z. ȳ is the eye's sensitivity to brightness, so Y is how bright the color looks.

Two spectra with the same X, Y and Z look the same color under that illuminant, however different their curves. So three numbers say all there is to say about a color, and every value and diagram in this window is worked out from them. Under another illuminant the same coating can look another color, which is why the illuminant is a setting.

## Settings

**T / R**: the color of the light the coating transmits or reflects.

**Polarization**: average, s, or p. Average is the usual choice for unpolarized illumination.

**AOI**: the viewing angles in degrees, as a **List** or a **Range**. A list is entered the same way as in [Optical Evaluation](/analysis/optical-evaluation/): click **+** to add an angle, click an angle to change it, and click its × to remove it. A range takes the first angle, the last and the step between them, so 0 to 60 every 10 gives seven angles. Either way the window takes up to 91 angles: each angle is one more spectrum to compute, and 91 already make a design of a few dozen layers pause each time it changes. A longer range computes its first 91, and a notice says so. Each angle is one point on the diagram, and the points are joined in order, so a coating's color shift with angle reads as a path.

**Observer**: the CIE color-matching functions: the 1931 2° observer for small fields or the 1964 10° observer for larger fields.

**Illuminant**: the light source the color is computed under: daylight (D65, D50), incandescent (A), and equal-energy (E).

**Step**: the wavelength sampling interval in nm for the color integral. A finer step improves accuracy on coatings with sharp spectral features.

**Exposure** (in Settings): how the coating's color is shown on screen, in the points on the diagram, the patches on the lines under it and the Color Patch view. **Fit hue**, the default, shows the hue at full brightness. **As is** scales the color against a perfect white reflector, so a very dim reflection (such as the residual color of a strong antireflection coating) renders almost black even when its hue is highly saturated. The numbers do not change; only the on-screen color does.

**Show** (in Settings): what the diagram draws besides your coating: the wavelengths along the spectral locus, the white point of the illuminant, the Planckian locus (the colors of a blackbody from 1000 K up, marked at a few temperatures), and the triangle of the sRGB display primaries, inside which a screen can show a color as it is.

The evaluation surface (front, back, or total) is set in the [Design Editor](/design/design-editor/) and shown as a badge on the window.

**Environment**: on a design with more than one [environment](/design/environments/), the **Environment** droplist in the row under the diagram says which one the color is computed in. **Current** follows the environment the Design Editor and the ribbon show. An environment picked by its number and name holds the window on that one, even while it is switched off. **All** shows every environment that is on: each environment's points are ringed and joined in its own color from the window's Palette in Preferences > Analysis, with a legend above the diagram naming them, and the lines under the diagram, the tables, the patches and the CSV name each row's environment. The material range notice reads the materials of every environment shown. The choice belongs to this window and is not saved with the design.

## The diagrams

The tabs over the plot pick the diagram:

- **x, y**: the CIE 1931 chromaticity diagram. Every color the eye can see falls inside the horseshoe. Its curved edge, the spectral locus, holds the pure colors of single wavelengths; its straight bottom edge, the purple line, holds the mixes of deep blue and deep red that no single wavelength makes. The illuminant's white is the ×. A point near the white is a pale, near-neutral color, a point toward the edge a strong one, and its direction from the white is its hue. Brightness is left out: a dim and a bright reflection of the same tint land on the same point.
- **u′, v′**: the CIE 1976 UCS diagram, the same horseshoe stretched so that equal distances are closer to equal steps the eye sees. On x, y a step among the greens that the eye hardly notices is as long as a step among the blues that it plainly sees; here the two are nearer the same length.
- **a\*, b\***: the CIE L\*a\*b\* plane at one lightness, with the white at the center. a\* runs from green on the left to red on the right, b\* from blue at the bottom to yellow at the top. Distance from the center is how strong the tint is and the direction is its hue. Equal distances are about equal steps the eye sees, so the distance between two points is their ΔE\*ab.
- **C\*uv, huv**: the CIE L\*u\*v\* plane drawn round the white: the rings are chroma C\*uv, how strong the tint is, and the spokes are hue angle huv.
- **C\*ab, hab**: the a\*, b\* plane drawn round the white the same way: rings of chroma C\*ab and spokes of hue angle hab, 0° red, 90° yellow, 180° green and 270° blue.

On the x, y and u′, v′ diagrams the inside of the spectral locus (the horseshoe of pure colors, closed by the purple line) is filled with the color of each point, and wavelengths are marked along the locus from 420 to 680 nm. Each point is shown as an sRGB screen shows it, at full brightness, whatever the illuminant. A color a screen cannot show is moved straight toward the screen's D65 white until it can, so it keeps its dominant wavelength, measured from that white, and loses only saturation.

The three L\*a\*b\* and L\*u\*v\* tabs draw the spectral locus and its fill at your coating's lightness: the highest L\* among the angles, rounded up to a whole number. The a\*, b\* and u\*, v\* of a chromaticity grow with lightness, so drawn at the coating's own L\* the fill takes in every point, each at its own a\*, b\* or u\*, v\*. These planes are measured from the illuminant's white, so their fill shows each color as it looks under that illuminant, brought to the screen's white the way your coating's points are: the center, a\* = b\* = 0, is white under any illuminant, and under D65 the fill holds the same colors as the x, y diagram. These tabs are framed to your coating: centered on the white and reaching a little past its farthest point, so its shift with angle fills the plot, even for the faint reflection of an antireflection coating. The frame is never tighter than ±5, so a color that barely changes is not stretched until a difference too small to see fills the plot. The whole locus stays on the x, y and u′, v′ diagrams.

## Targets

**Targets** on the control row draws the merit function's color rows on the diagram, as [Optical Evaluation](/analysis/optical-evaluation/) draws its targets on the plot. Over R it draws the `RCOL` rows and over T the `TCOL` rows that are scored at the window's polarization, illuminant and observer. A row is drawn on the diagram of its own coordinates: an x row and a y row at the same angle meet in a hollow diamond labelled with the angle, beside the coating's point at that angle. u′ and v′ rows meet the same way on u′, v′; a\* and b\* rows, or C\*ab and hab rows, on both L\*a\*b\* tabs; u\* and v\*, or C\*uv and huv, on C\*uv, huv. A row with no partner at its angle, and Y, L\* and the quantities no diagram holds, are not drawn. Under **All** the rows of every environment are drawn. The button is greyed while the diagram shown has no such row.

**Edit**, beside **Targets**, builds targets on the diagram instead of typing them into the [Merit Function Editor](/design/merit-function-editor/). It opens a row under the control row with two tools and **AOI (°)**, the angle a drawn target is written at:

- **Draw**: click the diagram to add a target there. It is written as two rows of the coordinates the diagram is drawn in: an x and a y row on x, y; u′ and v′ on u′, v′; a\* and b\* on a\*, b\*; C\*ab and hab, or C\*uv and huv, on the two hue and chroma tabs. The rows take the side, polarization, illuminant and observer the window shows, weight 1, and go after the last row of the merit function. Their angle is the one **AOI (°)** picks: **Nearest**, the angle of the coating point nearest the click, so you click beside the point you want to pull, or one of the angles the window shows. On a design with environments the rows are scored in the environment of the point nearest the click at that angle: the one shown, or under **All** the one whose point is nearest.
- **Delete**: click a target to remove its two rows.

In either tool a target drags: its two rows' targets go to where it is dropped, x, y, u′ and v′ to three decimals and the others to two. While editing, the frame of the three L\*a\*b\* and L\*u\*v\* tabs holds still: a click, a drag or a delete never resizes it, so a target stays where it was dropped. A value typed in the Merit Function Editor past its edge, or the coating moving past it, still widens it. The targets are shown whatever **Targets** says. Every edit changes the merit function itself, so the Merit Function Editor shows it at once and Ctrl+Z takes it back. Targets can also be set with the wizard's [Color preset](/design/merit-function-editor/#color-targets).

## Under the diagram

A line per angle under the diagram shows a patch of the coating's color at that angle, at the window's exposure, with its x, y, Y, L\*, a\*, b\*, its dominant wavelength λd, or for a purple its complementary wavelength λc, and its purity. The values line up in columns, so the change with angle reads down each column, and past six angles the lines scroll. Every other color space is in Results; while Results is open the lines step aside, so the diagram keeps its room.

## What the values mean

Every value comes from the same three numbers, X, Y and Z: the coating's spectrum weighted by the illuminant and by the observer's three color-matching functions.

| Value | What it is |
|---|---|
| X, Y, Z | The tristimulus values: how strongly the light stirs each of the observer's three color-matching functions. Y follows the eye's sense of brightness alone. |
| Y (%) | Luminous reflectance or transmittance: the share of the light the eye sees reflected or transmitted, in %. |
| x, y | Chromaticity: where the color sits on the x, y diagram with its brightness taken out, x = X / (X + Y + Z) and y = Y / (X + Y + Z). |
| u′, v′ | The same chromaticity on the CIE 1976 UCS diagram, stretched so that equal distances are closer to equal steps the eye sees. |
| u, v | The older CIE 1960 chromaticity, on which the correlated color temperature is measured. |
| L\* | Lightness, from 0 for black to 100 for white. |
| a\*, b\* | Where the color sits around the white: a\* runs from green below 0 to red above, b\* from blue below 0 to yellow above. 0, 0 is neutral. |
| C\*ab, hab | The same a\*, b\* as a distance and an angle: the chroma C\*ab says how strong the tint is, the hue angle hab which hue it is, 0° red, 90° yellow, 180° green, 270° blue. |
| L\*, u\*, v\*, C\*uv, huv | The same in CIE L\*u\*v\*, which is built on u′, v′. |
| suv | Saturation: the chroma C\*uv for each unit of lightness L\*. |
| Hunter L, a, b | An older scale of lightness and opposed colors, still named in some specifications. |
| λd | Dominant wavelength: the spectral color that, mixed with the illuminant's white, matches the coating's color. It names the hue. |
| λc | Complementary wavelength, for a purple, which no single wavelength matches: the spectral color on the far side of the white. |
| Purity | How far the color sits from the white toward its spectral color, from 0 % at the white to 100 % on the spectral locus. |
| CCT | Correlated color temperature: the temperature, in K, of the blackbody whose color is nearest. Only colors near the Planckian locus have one. |
| Duv | How far the color sits from the Planckian locus on the u, v diagram: positive above it, negative below. |
| ΔE\*ab, ΔE00 | The difference between two colors: ΔE\*ab is the straight distance in L\*a\*b\*, ΔE00 the CIEDE2000 formula, which follows the eye more closely. About 1 is often taken as the smallest difference seen side by side. |

## How to read it

A point near the white point means a near-neutral, colorless coating; a point pulled toward the edge of the locus means a strong, saturated tint. Each point is filled with the coating's color at that angle as an approximate on-screen color.

With **Fit hue**, the default, that color is shown at full brightness, so the hue of even a very dim reflection reads. **As is** shows it against a perfect white reflector instead: a dim reflection then looks dark or black even when its point sits far out toward the locus, which is how little light it carries.

## Results

The **Results** strip under the diagram has three views, one row or patch per angle:

- **Table**: the color in one color space at a time, picked from the list at its right: x, y, Y; X, Y, Z; CIE L\*a\*b\*; L\*, C\*ab, hab; CIE L\*u\*v\*; L\*, C\*uv, huv, suv; u′, v′; CIE 1960 u, v; Hunter Lab; the dominant wavelength, or for a purple, which has none, the complementary wavelength, with the purity; and the correlated color temperature (CCT) with its offset from the Planckian locus (Duv). CCT reads as a dash for a color too far from the Planckian locus to have one. With a single angle in a single environment the Table lists every color space at once instead, one space per row, each quantity's name next to its value.
- **Differences**: how far each angle's color is from the first angle's: ΔL\*, Δa\*, Δb\*, the CIE 1976 color difference ΔE\*ab and the CIEDE2000 color difference ΔE00. Under **All** with more than one environment on, each environment's color is measured against the first environment's at the same angle instead, so each row reads the shift that environment makes, and the first environment's rows read zero.
- **Color Patch**: a patch of the coating's color at each angle, with its Y, next to the reference white of the illuminant, in a row that wraps when there are more angles than fit.

**Export** writes every color space and the differences to one CSV, whichever view is open.

## References

- CIE 15:2004, *Colorimetry*, 3rd ed.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §12.2 (Eqs. 12.1–12.11).
- G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations", *Color Res. Appl.* **30**, 21 (2005).
