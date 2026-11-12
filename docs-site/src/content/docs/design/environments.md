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

**Thickness factor**: one row for each material the layers use. In the environment every layer of that material is that many times as thick, as at a chamber position where the films grow thinner. A factor of 1 leaves the layers as they are.

**Material in place of**: one row for each material the layers use. In the environment every layer of that material is made of the material you pick, as for a film whose index changes between vacuum and air.

Environment 1 has no factor and no material in place: its layers are the layer list as it stands.

## How to read it

The rows under **Merit** show, for each environment, how many merit rows are scored in it, its own MF over those rows, and its share of the total. The line under the grid is the MF over every environment that is on, the number the Merit Function Editor shows and a run minimizes:

```
MF² = (1/N) Σ_k MF_k²
```

N is the number of environments that are on and have a row scored in them, and MF_k is environment k's merit over its own rows, worked out as for a design with one environment. An environment's share is MF_k² / Σ_j MF_j², so the environment with the largest share is the one holding the merit up. The numbers follow a run as the merit tables do.

A merit row is scored in every environment unless its **Env** cell in the [Merit Function Editor](/design/merit-function-editor/) names one. [Refinement](/synthesis/refinement/), [Needle](/synthesis/needle/) Automatic and Manual, [Gradual Evolution](/synthesis/gradual-evolution/), the [Structural Optimizer](/synthesis/structural-optimizer/) and Deep Synthesis score every environment that is on. A needle goes into each environment as the material that environment swaps it for, f times as thick, f its thickness factor there, and the Min thickness a synthesis window proposes reads each MNT row in its environment: MNT 20 nm where TiO2 grows 0.8 times as thick asks 25 nm of every layer. [Optical Evaluation](/analysis/optical-evaluation/), [Color Evaluation](/analysis/color-evaluation/), [Integral Values](/analysis/integral-values/), [Group Delay / GDD](/analysis/gd-gdd/), [Ellipsometry](/analysis/ellipsometry/), the [Admittance Diagram](/analysis/admittance/), [Electric Field](/analysis/efield/) and the [Refractive Index Profile](/analysis/refractive-index-profile/) draw the environment their **Environment** droplist under the plot names, the current one by default, or every environment that is on; the other analysis windows draw environment 1.
