---
title: Process Exporter
description: Play back your coating layer by layer, watch the spectrum build up, and export per-step deposition data for in-chamber monitoring software.
ribbonIcon: process-sim
---

The **Process Exporter** plays your coating back one layer at a time (the
spectrum after layer 1 is finished, after layer 2, and so on to the complete
design), so you can see exactly what the in-chamber spectrophotometer will
measure as the stack grows. It also exports per-step **`.res` deposition
files** that deposition-monitoring software can load directly, one file per
layer.

A timeline at the bottom scrubs through the deposition. The chart shows the
bare-substrate baseline (dotted), the finished spectrum of the layer the
timeline is on, and the live curve at the current scrub position (bold). Show
all layers adds a finished curve for every layer, graded from blue for the first
to red for the last. The spectrum is computed with the full system (front,
substrate, and back, with an incoherent substrate), so it matches what the
spectrometer would really see.

## Settings

The top toolbar holds the setup; the left sidebar lists the deposition
sequence and per-material rates.

**Active side**: which coating is being deposited, front or back.

**Opposite-surface state**: whether the other surface is bare or already
coated for the whole run.

**Quantity**: measure reflectance, transmittance, or absorptance.

**Angle of incidence** and **polarization**: the standard analysis controls
(s, p, or average).

**Spectral range**: the wavelength start, end, and step for the interactive
chart. A coarse step keeps scrubbing responsive.

**Export step**: the wavelength step written into the `.res` files. It does not
affect the chart. The default is 0.5 nm; set it to match your
spectrophotometer's grid, which for a fixed-array instrument is often an odd
number such as 0.4375 nm. Type the decimal with either a dot or a comma.

**Show all layers**: draw the finished curve for every layer. With it off, which
is the default, the chart draws the baseline, the layer the timeline is on, and
the live curve, and nothing else. Sixty finished curves over one plot is a grey
haze with the answer somewhere inside it. Turn it on to compare the whole run at
once; the layer the timeline is on stays at full strength and the rest go grey,
because a turning point only means something against the curves before it. The
hover readout stays on those same three curves whatever is drawn, so select a
layer when you want to read a value off it.

**Deposition rates**: an optional per-material rate (nm/s) in the sidebar.
Rates only shape the time axis of the timeline; they do not change the
spectrum. The sequence table shows each layer's thickness and time, with the
current layer marked by a bar down its left edge. Click a layer to move the
timeline to it, with that layer fully deposited; the up and down arrow keys then
walk the stack from there. Click a held layer again to release it, and pressing
Play or moving the timeline releases it too. Your setup choices and rates are
remembered between sessions.

**Save**: pick an output folder; one `.res` file is written per completed
deposition step (`01.res`, `02.res`, …). Each file carries a header and a
per-layer table of physical and optical thickness; layers are numbered in
deposition order, with layer 1 being the first deposited (the one touching the
substrate).

## How to read it

Play or scrub the timeline to watch the spectrum evolve toward the final
design. The step curves let you see at a glance how each layer moves the
spectrum, which is useful for spotting a layer whose contribution is small (and
therefore hard to monitor) or one that swings the spectrum sharply. The `.res`
files are the deliverable for your deposition controller: they describe the
target spectrum at the end of every layer so the monitor can compare the live
measurement against the intended one. The live spectrum uses the design's
nominal materials with no noise; for a realistic as-built prediction use the
[Broadband](/simulation/bbm-simulator/) or
[Mono](/simulation/mono-simulator/) monitoring simulators instead.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., §2.6.4 (incoherent
  substrate).
