---
title: Monitor Worksheet
description: Check, layer by layer, whether the design can be terminated on an optical monitor and on which witness chip.
ribbonIcon: monitor-worksheet
---

The **Monitor Worksheet** answers the question that comes before a deposition
run: **can this design be monitored at all**. For every layer it shows how much
signal the monitor has to stop on, where the stop sits between the two turning
points that surround it, and how far the thickness moves if the monitor reading
is wrong. A design that cannot be terminated reliably is a design that cannot be
made repeatably, whatever the spectrum says.

The [Mono Simulator](/simulation/mono-simulator/) runs one manufacturing
experiment and shows what came out. This window runs no experiment: it reports
the controllability of the plan itself.

## Witness chips

A run is monitored on witness chips, not on the part. Each chip carries only the
layers assigned to it, so a chip is its own short coating starting from bare
glass. That is the setting the whole worksheet turns on: put too many layers on
one chip and the last of them sit on a signal with almost no swing left, and put
too few and the run needs more chips than the fixture holds. Two to four layers
per chip is the usual range.

Every layer on a chip is monitored at the same wavelength. A layer too thin to
produce a turning point of its own has to be read against the one before it, and
that only exists on the same curve.

## Settings

**Layers per chip** assigns the run to chips in deposition order. It is the
first control to reach for when the numbers come out badly.

**Auto λ** picks one monitoring wavelength per chip: the wavelength at which the
worst layer on that chip terminates most precisely. A layer that has no signal at any wavelength, one of the chip's own index, is left out of the choice: it goes to the crystal whichever wavelength is picked.

**Set all** puts the wavelength in the box beside it on every layer of the run,
for a machine that monitors everything at one wavelength.

**Reset plan** discards chip numbers and wavelengths entered by hand and goes
back to the plain division by chip size.

The **Chip** and **λ** cells are editable. A wavelength belongs to the chip
rather than to the layer, so typing one into any row moves every layer on that
chip. Layers carrying the same chip number are on the same physical piece even
when they are not deposited one after another, which is how a chip is returned
to later in the run.

In the settings panel:

**Measured**, **Polarization** and **Angle** are what the monitor sees. Most
in-chamber monitors read transmittance at normal incidence.

**Chip glass** is the witness chip the monitor watches. It follows the design
substrate; pick another material when the witness is a different glass than the
part. A design on an absorbing substrate has to be monitored on a transparent
chip, and this is where that is said.

**Witness ratio** is the thickness the witness chip receives as a multiple of
the thickness the part receives. Leave it at 1 when the chip sits in the same
position as the work.

**Signal error** is how far the monitor reading can be from the truth, as a
percentage of the reading. This is the same quantity as the random signal error
in the Mono Simulator.

**Absolute noise** is the monitor's photometric noise floor, in percent of full
scale. Unlike the signal error it does not shrink with the reading, so a
wavelength where the signal has died, deep inside a stopband, scores as
unusable instead of as noiseless. It is what steers **Auto λ** away from a
mirror's own band. A layer whose whole swing is smaller than this floor plus the signal error has no usable signal, and the row says so.

**Max Δd** is the thickness error a layer is allowed to be terminated with,
as a percentage of the layer. A layer that costs more than this is flagged.

**Chart window** is how many layers the chart opens on.

## How to read it

One row per deposited layer, in run order.

**Chip** is the witness chip and the layer's position on it, so `2-1` is the
first layer on chip 2.

**λ** is the monitoring wavelength. A red cell here is a wavelength this layer
cannot be terminated on closely enough.

**Signal** is the level the operator stops at. **Initial level** is the level
the chip starts from and appears on the first layer of each chip only, which is
where the gain is set.

**Turning points** is how many the layer passes through. Zero means the layer is
read against a turning point in an earlier layer on the same chip, or that the monitor could not see the layer move at all: a layer whose whole swing is smaller than the monitor's own error, deep in a saturated stopband, shows zero with no amplitude and ∞ for Δd.

**Amplitude** is the full swing available to the layer, measured between the
turning point before the cut and the one after it. It is not the swing the layer
actually traverses, which is usually smaller.

**Swing in** is the distance from the level the layer started at to that turning
point, and **Swing out** the distance from the turning point to the cut.

**Cutoff ratio** is swing out over amplitude: where the stop sits between the
two turning points. Near 0 the stop is on the turn, where the signal is flat and
the level says little about the thickness. Near 0.5 it is on the steepest part
of the flank, where the level is most informative. Near 1 it is approaching the
next turn.

**Δd** is the number the rest of the row adds up to: the thickness error left
behind when the monitor reads wrong by the signal error set above. It follows
the rule the layer is cut with, either following the signal to a level or
detecting the reversal at a turning point, so both are on the same scale. Layers
cut on time have no optical feedback and show none.

**Crystal** is the thickness to run the quartz monitor to, in kilo-angstroms, on every layer. The flagged layers are the ones the crystal has to carry and are drawn in full; the rest are dimmed.

**Export** writes the table to CSV.

## The chart

The chart under the table is the run as the monitor sees it: signal against
cumulative optical thickness, each cut marked and numbered, and each layer's
curve continued past its cut as a dashed line so the turning point that sets its
amplitude is visible. Chips are shaded in alternating bands, and a layer drawn in
the flag colour is one that is out of budget.

Drag the divider between the table and the chart to give either one more of the
window.

A whole run drawn end to end is unreadable, so the chart opens on the first few
layers. The strip under it shows the entire run with the visible part boxed:
drag the box along to move through the run, drag its ends to widen or narrow the
view, or roll the wheel over the plot to zoom. The toolbar's reset returns to the
opening window.

Layers whose curves flatten out toward the end of the run are the ones to fix.
Give them a chip of their own, try another wavelength, or accept that they will
be run on the crystal.

## Notes

The signal is read through the whole witness chip: the growing coating on the
front face and the bare back face, added incoherently, the same convention the
monochromatic simulator uses. A bare chip of n = 1.52 glass reads 91.8 %, and
that is the level the monitor's gain is set against. The chip hangs in the chamber, so the signal is read with air above the growing coating whatever medium the design is embedded in: a filter designed between two glasses still monitors like a chip in air, and its first layer reads the bare-chip level, not 100 %.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Ch. 12.
- A. V. Tikhonravov, M. K. Trubetskov and T. V. Amotchkina, "Statistical
  approach to choosing a strategy of monochromatic monitoring of optical coating
  production", *Appl. Opt.* **45**, 7863 (2006).
