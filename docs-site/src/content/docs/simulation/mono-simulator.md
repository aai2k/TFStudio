---
title: Monochromatic Monitoring Simulator
description: Simulate making your coating under a single-wavelength monitor, with turning-point, level, or timed cut strategies per layer.
ribbonIcon: mono-simulator
---

The Monochromatic Monitoring Simulator is a seven-page wizard that deposits the design under an in-chamber single-wavelength optical monitor. It shares the setup and playback of the [Broadband Monitoring Simulator](/simulation/bbm-simulator/); the difference is that each layer is cut at one monitoring wavelength by one of three termination strategies. Pages 1 to 5 set the conditions and the per-layer plan, page 6 runs one experiment, page 7 gives the result.

<!-- shot: mono-simulator | one simulated deposition of the quarter-wave mirror cut on turning points at the design wavelength, on Resulting Performance: the as-built reflectance against the design -->
![Monochromatic Monitoring Simulator](/screenshots/mono-simulator.png)

## Computed quantities

- **Deposition Simulation** (page 6): the timeline, the **estimated / actual / target** thickness of the current layer, and the spectrum against the guide curves, as in the broadband wizard.
- **Resulting Performance** (page 7): manufactured against theoretical spectrum, per-layer **relative** and **absolute** thickness error, and tables of as-built thicknesses and refractive indices.

Layers with large errors are those whose wavelength or strategy does not serve them: try **Auto λ (all)** or another strategy and run again, several times, to see the spread.

## Controls and settings

| Page | Sets |
|---|---|
| 1 **Deposition Rates** | **Mean rate, Å/s**, **RMS, Å/s** and **Corr. time, s** per material; **Rndm & Update** draws another preview trace. |
| 2 **Parameters Deviation** | Systematic and random index shifts and **Syst. Inh. (%)** per material, the inhomogeneity listed with the results but not applied to the layer; layers **excluded** from monitoring with an extra relative thickness error; mean and RMS shutter delay. |
| 3 **Monitoring System** | Quantity and polarization, **Incidence, °**, **Scan interval, s**, **Confirm scans** a cut needs, and **Chip glass**. The preview plots the ideal signal against deposited thickness for the selected layer, with the cut marked. |
| 4 **Monitoring Wavelengths** | Per layer **λ mon, nm**, **Strategy** and **Order** ([below](#termination-strategies)); **Auto λ (all)**, **Set all** and **Strategy for all…**. Clicking a row previews that layer's signal. |
| 5 **Signal Errors** | **Random errors, %** of the reading, **Absolute noise, %** of full scale, which does not shrink with the signal, and **Drift, % per 1000 s**. |
| 6 **Deposition Simulation** | **Start** runs the experiment and plays it back. |

The deposited side and how the result is scored follow the surface mode in the [Design Editor](/design/design-editor/). The signal is read through the whole witness chip, coating and bare back face added incoherently, with air above the coating: a bare chip of n = 1.52 reads 91.8 %, not the 95.7 % of its coated surface alone.

## Termination strategies

- **Turning point**: cut at an extremum of the signal; **Order** picks which. While the signal is clean enough to show its curvature, the monitor forecasts the extremum from the last readings and closes the shutter on it, between scans if need be; on a noisy signal it waits for the signal to turn back, and the cut runs past.
- **Level**: cut where the signal crosses a target level in the expected direction, armed only on the branch that holds the target, after the last extremum before it, so a layer thicker than a quarter wave is not cut where the signal first passes that level. An **Order** of N ≥ 2 arms it after extremum N − 1; 1 leaves the branch to the model. The monitor waits for the smoothed signal to reach the value the model gives it the confirm scans ahead, works out the crossing between scans and closes on a timer, so confirming costs no thickness and a noiseless run ends on target. On a branch too short for the confirm scans the cut runs late by what did not fit.
- **By time**: cut after the target thickness over the page 1 mean rate, with no signal feedback, so the layer ends off by the rate error.

The plan opens at the reference wavelength. A layer within 6 % of a whole number of quarter waves gets a turning cut when its signal on the chip, over the design's layers, turns within 6 % of a quarter wave of its end; other layers get a level cut, and a layer that barely moves the signal is cut by time. **Auto λ (all)** picks for each layer the wavelength and strategy with the most precise cut: quarter-wave layers keep the reference wavelength's turning point and its self-compensation while the reversal is still detectable; once a stopband saturates the signal its layers are monitored outside the band, and a layer no wavelength serves is cut by time.

A turning point suits a layer near a quarter-wave multiple at the monitoring wavelength, being precise and blind to direction; for other thicknesses a level cut where the signal is steep through the cut point is the most precise.

## Theory

The rate model and the witness chip are those of the [broadband simulator](/simulation/bbm-simulator/#theory). At one wavelength λ_m the signal S(d) of a growing layer of index n has its extrema where the layer is a whole number of quarter waves:

```
n d = m λ_m / 4,     m = 1, 2, …       turning points
t_cut = d_target / r̄                   by time
```

Near a turning point dS/dd = 0, so a timing error barely moves S but a thickness error barely shows in it either; quarter-wave stacks monitored at their own wavelength gain from the errors of one layer being taken up by the cut of the next.

## References

- H. A. Macleod, *Thin-Film Optical Filters*, 5th ed., Chapter 13, p. 471: production methods and optical monitoring.
- A. V. Tikhonravov and M. K. Trubetskov, "Computational manufacturing as a bridge between design and production," *Appl. Opt.* **44**, 6877 (2005).
