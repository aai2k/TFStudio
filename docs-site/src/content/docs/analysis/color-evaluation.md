---
title: Color Evaluation
description: CIE chromaticity, Lab and color readouts that show what your coating looks like to the eye.
ribbonIcon: color-eval
---

Color Evaluation turns a coating's spectrum into a perceived color. It takes the reflectance or transmittance across the visible range at one or more angles, weights it by a standard observer and illuminant, and shows where the result sits on a CIE color diagram, along with a patch of the color and a full set of color-space values. Use it to predict the visible appearance of a coating: the tint of an antireflection film, the hue of a decorative mirror, or how a filter shifts color with viewing angle.

The spectrum is sampled across 380–780 nm and fed through the standard colorimetric integral, so the color matches the curves shown in [Optical Evaluation](/analysis/optical-evaluation/).

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

## The diagrams

The tabs over the plot pick the diagram:

- **x, y**: the CIE 1931 chromaticity diagram.
- **u′, v′**: the CIE 1976 UCS diagram, where equal distances are closer to equal steps of perceived color than on x, y.
- **a\*, b\***: the CIE L\*a\*b\* plane.
- **C\*uv, huv**: the CIE L\*u\*v\* plane on a grid of chroma rings and hue spokes.
- **C\*ab, hab**: the CIE L\*a\*b\* plane on a grid of chroma rings and hue spokes.

On the x, y and u′, v′ diagrams the inside of the spectral locus (the horseshoe of pure colors, closed by the purple line) is filled with the color of each point, and wavelengths are marked along the locus from 420 to 680 nm. Each point is shown as an sRGB screen shows it, at full brightness, whatever the illuminant. A color a screen cannot show is moved straight toward the screen's D65 white until it can, so it keeps its dominant wavelength, measured from that white, and loses only saturation.

The three L\*a\*b\* and L\*u\*v\* tabs draw the spectral locus and its fill at your coating's lightness: the highest L\* among the angles, rounded up to a whole number. The a\*, b\* and u\*, v\* of a chromaticity grow with lightness, so drawn at the coating's own L\* the fill takes in every point, each at its own a\*, b\* or u\*, v\*. These planes are measured from the illuminant's white, so their fill shows each color as it looks under that illuminant, brought to the screen's white the way your coating's points are: the center, a\* = b\* = 0, is white under any illuminant, and under D65 the fill holds the same colors as the x, y diagram. These tabs are framed to your coating: centered on the white and reaching a little past its farthest point, so its shift with angle fills the plot, even for the faint reflection of an antireflection coating. The frame is never tighter than ±5, so a color that barely changes is not stretched until a difference too small to see fills the plot. The whole locus stays on the x, y and u′, v′ diagrams.

## Under the diagram

A line per angle under the diagram shows a patch of the coating's color at that angle, at the window's exposure, with its x, y, Y, L\*, a\*, b\*, its dominant wavelength λd, or for a purple its complementary wavelength λc, and its purity. The values line up in columns, so the change with angle reads down each column, and past six angles the lines scroll. Every other color space is in Results; while Results is open the lines step aside, so the diagram keeps its room.

## How to read it

A point near the white point means a near-neutral, colorless coating; a point pulled toward the edge of the locus means a strong, saturated tint. Each point is filled with the coating's color at that angle as an approximate on-screen color.

With **Fit hue**, the default, that color is shown at full brightness, so the hue of even a very dim reflection reads. **As is** shows it against a perfect white reflector instead: a dim reflection then looks dark or black even when its point sits far out toward the locus, which is how little light it carries.

## Results

The **Results** strip under the diagram has three views, one row or patch per angle:

- **Table**: the color in one color space at a time, picked from the list at its right: x, y, Y; X, Y, Z; CIE L\*a\*b\*; L\*, C\*ab, hab; CIE L\*u\*v\*; L\*, C\*uv, huv, suv; u′, v′; CIE 1960 u, v; Hunter Lab; the dominant wavelength, or for a purple, which has none, the complementary wavelength, with the purity; and the correlated color temperature (CCT) with its offset from the Planckian locus (Duv). CCT reads as a dash for a color too far from the Planckian locus to have one. With a single angle the Table lists every color space at once instead, one space per row, each quantity's name next to its value.
- **Differences**: how far each angle's color is from the first angle's: ΔL\*, Δa\*, Δb\*, the CIE 1976 color difference ΔE\*ab and the CIEDE2000 color difference ΔE00.
- **Color Patch**: a patch of the coating's color at each angle, with its Y, next to the reference white of the illuminant, in a row that wraps when there are more angles than fit.

**Export** writes every color space and the differences to one CSV, whichever view is open.

## References

- CIE 15:2004, *Colorimetry*, 3rd ed.
- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §12.2 (Eqs. 12.1–12.11).
- G. Sharma, W. Wu and E. N. Dalal, "The CIEDE2000 color-difference formula: implementation notes, supplementary test data, and mathematical observations", *Color Res. Appl.* **30**, 21 (2005).
