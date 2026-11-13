---
title: Environments
description: "Score one design in several conditions at once: another substrate, another medium, a chamber position where the layers grow thinner."
ribbonIcon: environments
---

The same coating rarely works in one place. An AR goes on BK7 lenses and on sapphire windows, a filter is used in air and cemented in glue, and the parts at the edge of the dome come out a few percent thinner than those at the centre. The **Environments** window lists the conditions one design is scored in, one column each, and the merit function scores the design in every one of them at once. Open it from **Environments** on the Setup tab of the ribbon.

Environment 1 is the design itself: its media, its substrate and its layer list. Every other environment sets only what differs from it and follows environment 1 in the rest, so a change to environment 1 reaches every environment that has not set that field.

## Settings

**Add**: adds an environment at the end of the list and makes it the current one. It follows environment 1 in everything until you set what differs.

**Duplicate**: adds a copy of the current environment, with every field it sets.

**Delete**: deletes the current environment, together with the merit rows scored in it alone. One Ctrl+Z brings both back. Environment 1 cannot be deleted. Once the last other environment is gone the design has one environment again and is saved as a design without environments.

**Current**: the radio button at the head of a column. The current environment is the one the Design Editor's Settings show and edit, and the one the merit tables show each row's value in. Changing it changes nothing in the design: it is not an undo step and it is not saved. The droplist in the [Design Editor](/design/design-editor/)'s Settings and **Previous** and **Next** on the Setup tab of the ribbon change the same one.

**On**: whether the environment is scored in the merit function and in runs. An environment that is off keeps its fields and its rows.

**Name**: a name to tell the environments apart, shown after the number wherever they are listed.

**Incident medium**, **Substrate**, **Substrate thickness**, **Exit medium**: the media and the substrate of each environment. In environment 1's column they are the design's own, the same fields as in the Design Editor. In another column a dimmed value is environment 1's: click it to give the environment a value of its own, then change it. The cross beside a value gives the field back to environment 1.

**Cone of incidence**: the cone of angles the environment is scored in, its switch and its half-angle, or **collimated** when it is off. Environment 1's is the design's **Average over illumination cone** in the [Design Editor](/design/design-editor/). Another environment that sets a cone takes every part it does not set from environment 1's; with the environment current, the Design Editor's Settings set the rest of it, the distribution and the grid points.

**Other side**: how a design coated on one side is scored in the environment: on its coated side alone (**Ignored**) or as the whole part with the substrate's other side (**Counted**). Environment 1's is the design's **Ignore other side**. A design coated on both sides is scored as the whole part in every environment.

**Temperature**: the temperature the environment is at, in °C. Environment 1's is the temperature the layer thicknesses and the materials' n and k are given at, 20 °C until you change it. At another temperature the layers and the substrate change from them as set out under [Temperature](#temperature) below. On a design with environments the Design Editor's Settings show the current environment's.

**Constants missing**: under the temperature, the materials an environment computes with at its temperature that lack a constant the model reads, with the constants each one lacks on hover. The constants are the material's own, entered in the [Material Editor](/design/material-editor/). A film whose material lacks its linear expansion or its Poisson's ratio, or whose substrate lacks its linear expansion, is taken as unstrained, as set out under [Temperature](#temperature); any other missing constant counts as 0.

**Thickness factor**: one row for each material the layers use. In the environment every layer of that material is that many times as thick, as at a chamber position where the films grow thinner. A factor of 1 leaves the layers as they are.

**Material in place of**: one row for each material the layers use. In the environment every layer of that material is made of the material you pick, as for a film whose index changes between vacuum and air.

Environment 1 has no factor and no material in place: its layers are the layer list as it stands.

## Temperature

A film held to its substrate cannot expand in its own plane as it would on its own: it follows the substrate, and in following it grows thinner or thicker by its Poisson's ratio. Its material then fills a different share of the film, and the index moves with that share as well as with the material's own dn/dT. TFStudio computes an environment at another temperature by the model of H. Takahashi, *Appl. Opt.* **34**, 667 (1995), Eqs. 14, 15 and 18, taken at a change ΔT in place of the paper's 1 °C.

ΔT is the environment's temperature less environment 1's. Each layer, after the environment's thickness factor and material in place, becomes:

```
A = 2(α − β)(1 − 2ν)/(1 − ν) · ΔT
B = 2ν(α − β)/(1 − ν) · ΔT
P = (1 + 3βΔT) / (1 + 3βΔT + A)
d = d₁ (1 − B + βΔT)
n = (n₁ + (dn/dT) ΔT) P + 1 − P
```

α is the linear expansion of the environment's substrate, β, ν and dn/dT the linear expansion, Poisson's ratio and dn/dT of the layer's material, all per kelvin. d₁ and n₁ are the layer's thickness and index at environment 1's temperature, and the film is taken as fully dense there, as the paper takes its ion-assisted films. n is worked out at every wavelength; k stays as it is, since the paper models the real index alone.

The strain needs α, β and ν. A film whose material lacks β or ν, or whose substrate lacks α, is taken as unstrained: A = B = 0, so P = 1, its thickness is d₁ (1 + βΔT) and its index n₁ + (dn/dT) ΔT, β and dn/dT counting as 0 where they are missing too. A substrate lacking α keeps its thickness, and one lacking dn/dT its index. The **Constants missing** row names these materials.

The paper treats a whole filter as one film, with an averaged index, a weighted mean of its materials' dn/dT and one expansion for the filter and its materials. TFStudio applies the equations to each layer with its own material's β, ν and dn/dT, and takes dn/dT as one value at every wavelength; both are TFStudio's, not the paper's.

The paper has no model for the substrate itself. TFStudio moves its index by its own dn/dT, n = n₁ + (dn/dT) ΔT, and its thickness by its own expansion, d = d₁ (1 + αΔT), k again kept. The media stay as they are.

A needle a synthesis run puts in is changed the same way: in each environment it is a layer of its material at that environment's temperature. The Min thickness a synthesis window proposes reads each MNT row with the layers as thick as they are at the temperature of the row's environment.

Where the design states the temperature its film stress is evaluated at, as the [Stress](/analysis/stress/) window sets it, a stress row scored in an environment at another temperature reads the stress at that temperature moved by the same change.

## How to read it

The rows under **Merit** show, for each environment, how many merit rows are scored in it, its own MF over those rows, and its share of the total. The line under the grid is the MF over every environment that is on, the number the Merit Function Editor shows and a run minimizes:

```
MF² = (1/N) Σ_k MF_k²
```

N is the number of environments that are on and have a row scored in them, and MF_k is environment k's merit over its own rows, worked out as for a design with one environment. An environment's share is MF_k² / Σ_j MF_j², so the environment with the largest share is the one holding the merit up. The numbers follow a run as the merit tables do.

A merit row is scored in every environment unless its **Env** cell in the [Merit Function Editor](/design/merit-function-editor/) names one. [Refinement](/synthesis/refinement/), [Needle](/synthesis/needle/) Automatic and Manual, [Gradual Evolution](/synthesis/gradual-evolution/), the [Structural Optimizer](/synthesis/structural-optimizer/) and Deep Synthesis score every environment that is on. A needle goes into each environment as the material that environment swaps it for, f times as thick, f its thickness factor there, and the Min thickness a synthesis window proposes reads each MNT row in its environment: MNT 20 nm where TiO2 grows 0.8 times as thick asks 25 nm of every layer. A [Specification](/design/specification/) check is judged in every environment that is on unless its **Env** field names one, and passes when it passes in each environment it is judged in; the Monte Carlo yield, the report and the tolerance windows' verdicts count every environment that is on. [Optical Evaluation](/analysis/optical-evaluation/), [Color Evaluation](/analysis/color-evaluation/), [Integral Values](/analysis/integral-values/), [Group Delay / GDD](/analysis/gd-gdd/), [Ellipsometry](/analysis/ellipsometry/), the [Admittance Diagram](/analysis/admittance/), [Electric Field](/analysis/efield/) and the [Refractive Index Profile](/analysis/refractive-index-profile/) draw the environment their **Environment** droplist under the plot names, the current one by default, or every environment that is on. [Monte Carlo](/analysis/error-analysis/) and [Systematic Deviations](/analysis/systematic-deviations/) show one environment at a time, the one their droplist names, and [Layer Sensitivity](/analysis/layer-sensitivity/) probes the merit of that environment or of every environment that is on. The other analysis windows draw environment 1.
