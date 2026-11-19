---
title: Monitor Worksheet
description: Check, layer by layer, whether the design can be terminated on an optical monitor and on which witness chip.
ribbonIcon: monitor-worksheet
---

The Monitor Worksheet answers the question before a deposition run: **can this design be monitored at all**. For every layer it shows how much signal the monitor has to stop on, where the stop sits between the turning points around it, and how far the thickness moves if the reading is wrong. A design that cannot be terminated reliably cannot be made repeatably, whatever its spectrum. The [Monochromatic Monitoring Simulator](/simulation/mono-simulator/) runs an experiment; this window reports the controllability of the plan itself.

<!-- shot: monitor-worksheet | the 550 nm bandpass on witness chips of three layers, one monitoring wavelength per chip picked by Auto λ, with the signal the monitor would see and the cut of every layer -->
![Monitor Worksheet](/screenshots/monitor-worksheet.png)

## Computed quantities

One row per deposited layer, in run order.

| Column | Meaning |
|---|---|
| **Chip** | Witness chip and the layer's place on it: `2-1` is the first layer on chip 2. |
| **λ** | Monitoring wavelength; red where the layer cannot be terminated closely enough on it. |
| **Signal** | The level the operator stops at. **Initial level**, on a chip's first layer only, is where the chip starts and the gain is set. |
| **Turning points** | How many the layer passes. Zero means it is read against a turning point in an earlier layer on the chip, or the monitor cannot see it move at all (no amplitude, $\infty$ for $\Delta d$), as deep in a saturated stopband. |
| **Amplitude** | The full swing between the turning points before and after the cut, usually more than the layer traverses. |
| **Swing in**, **Swing out** | From the layer's starting level to that turning point, and from the turning point to the cut. |
| **Cutoff ratio** | Swing out over amplitude: near 0 the stop is on the flat turn and the level says little; near 0.5 on the steepest flank, the most informative; near 1 it nears the next turn. |
| **Δd** | Thickness error left when the reading is off by the signal error, by the rule the layer is cut with ([Theory](#theory)); none for a layer cut on time. |
| **Crystal** | Thickness for the quartz monitor in kÅ. Flagged layers, the ones the crystal must carry, are drawn in full; the rest are dimmed. |

The chart under the table is the run as the monitor sees it: signal against cumulative optical thickness, each cut marked and numbered, each curve continued dashed past its cut to show the turning point that sets its amplitude. Chips are shaded in alternate bands and an out-of-budget layer is drawn in the flag color. The strip under it shows the whole run with the visible part boxed: drag the box or its ends, or roll the wheel over the plot; the toolbar's reset returns to the opening view.

## Controls and settings

**Layers per chip** assigns the run to chips in deposition order, the first control to reach for when the numbers come out badly. **Auto λ** picks one wavelength per chip, the one at which its worst layer terminates most precisely; a layer with no signal at any wavelength, one of the chip's own index, is left out of the choice and goes to the crystal. **Set all** puts one wavelength on every layer. **Reset plan** discards hand-entered chips and wavelengths. The **Chip** and **λ** cells are editable; a wavelength belongs to the chip, so typing it in one row moves the whole chip, and layers with the same chip number are on the same piece even when not deposited one after another.

| Setting | Meaning |
|---|---|
| **Measured**, **Polarization**, **Angle** | What the monitor reads, usually T at normal incidence. |
| **Chip glass** | The witness glass, the design substrate to start with; a design on an absorbing substrate needs a transparent chip here. |
| **Witness ratio** | Thickness the chip receives over what the part receives; 1 for a chip in the work's position. |
| **Signal error** | How far the reading can be off, in % of the reading, as the simulator's random signal error. |
| **Absolute noise** | Photometric floor in % of full scale. It does not shrink with the reading, so a dead signal deep in a stopband scores unusable rather than noiseless, which steers Auto λ off a mirror's own band. A layer whose whole swing is below this plus the signal error has no usable signal. |
| **Max Δd** | Termination error allowed, in % of the layer; a layer past it is flagged. |
| **Chart window** | How many layers the chart opens on. |

**Export** copies the table, or saves it, the chart's signal curves (per layer from start to cut: thickness in the layer, chart position, signal) or the chart as a picture, in light colors whatever the theme. The bottom of the settings panel sets one file for the run or one per chip, the header (conditions on # lines, column names, or numbers only), delimiter, decimals and decimal mark, the same for every design.

## Witness chips

- A run is monitored on witness chips, each carrying only its own layers from bare glass. Too many layers on one chip leaves the last of them almost no swing; too few needs more chips than the fixture holds. Two to four layers a chip is usual.
- Every layer on a chip is monitored at the same wavelength, since a layer too thin for its own turning point is read against the one before it, which exists only on the same curve.
- The signal is read through the whole chip, coating and bare back face added incoherently, as in the simulator: a bare chip of $n = 1.52$ reads 91.8 %, the level the gain is set against. The chip hangs in the chamber with air above the coating, so a filter designed between two glasses still starts at the bare-chip level, not 100 %.
- Layers whose curves flatten toward the end of the run are the ones to fix: a chip of their own, another wavelength, or the crystal.

## Theory

The signal error at the cut is the relative error of the reading plus the floor, both as fractions of full scale:

$$
\begin{aligned}
\delta S &= e_\text{rel}\,|S| + e_\text{abs} \\
\Delta d &= \frac{\delta S}{|\mathrm{d}S/\mathrm{d}d|} && \text{level cut} \\
\Delta d &= \sqrt{\frac{2\,\delta S}{|S''|}} && \text{turning cut} \\
\text{cutoff ratio} &= \frac{\text{swing out}}{\text{amplitude}}
\end{aligned}
$$

A level cut follows the signal to a computed value, so its error is the signal error over the slope there. A turning cut detects the reversal itself: near an extremum $S \approx S_\text{ext} + \tfrac{1}{2} S'' (d - d_\text{ext})^2$, so the signal must move $\delta S$ away before the turn is seen. Both put the two rules on one scale.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 13, p. 471: production methods and optical monitoring.
- A. V. Tikhonravov, M. K. Trubetskov and T. V. Amotchkina, "Statistical approach to choosing a strategy of monochromatic monitoring of optical coating production," *Appl. Opt.* **45**, 7863 (2006).
