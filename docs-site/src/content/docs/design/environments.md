---
title: Environments
description: "Score one design in several conditions at once: another substrate, another medium, a chamber position where the layers grow thinner."
ribbonIcon: environments
---

The same coating rarely works in one place. An AR goes on BK7 lenses and on sapphire windows, a filter is used in air and cemented in glue, and parts at the edge of the dome come out a few percent thinner than those at the centre. Environments lists the conditions one design is scored in, one column each, and the merit function scores the design in all of them at once. It opens from **Environments** on the Setup tab of the ribbon.

Environment 1 is the design itself: its media, substrate and layer list. Every other environment sets only what differs and follows environment 1 in the rest, so a change to environment 1 reaches every environment that has not set that field.

<!-- new:environments | an AR with environment 1 on BK7 in air and environment 2 on sapphire with TiO2 at 0.97 thickness, the second column's own values bright and the followed ones dim, the Merit rows showing each MF and share and the total under the grid -->

## Computed quantities

Under **Merit**, each column shows **Rows scored here**, **MF of this environment** over those rows, and its **Share of MF²**. The line under the grid is the MF over every environment that is on: the number the [Merit Function Editor](/design/merit-function-editor/) shows and a run minimizes. The environment with the largest share is the one holding the merit up. The numbers follow a run as the merit tables do.

## Controls and settings

**Add** puts a new environment at the end, following environment 1 in everything, and makes it current; **Duplicate** copies the current one with every field it sets. **Delete** removes the current environment with the merit rows scored in it alone, one Ctrl+Z bringing both back. Environment 1 cannot be deleted, and once the last other one is gone the design is saved as a design without environments.

**Current**, the radio button at the head of a column: the environment the Design Editor's Settings show and edit and the merit tables show values in. It changes nothing in the design and is not saved; the droplist in the [Design Editor](/design/design-editor/)'s Settings and **Previous** and **Next** on the ribbon change the same one.

**On**: whether the environment is scored in the merit function and in runs; one that is off keeps its fields and rows. **Name**: shown after the number wherever environments are listed.

In environment 1's column the fields are the design's own. In another column a dim value follows environment 1: click it to set a value of the environment's own; the cross beside a value gives it back.

| Field | In environment 1 | What it sets |
|---|---|---|
| **Incident medium**, **Substrate**, **Substrate thickness**, **Exit medium** | the design's media and substrate | the media and substrate of the environment |
| **Cone of incidence** | the Design Editor's **Average over illumination cone** | the switch and half-angle, or **collimated**; parts not set come from environment 1 |
| **Other side** | **Ignore other side** | a one-sided design scored on its coated side alone (**Ignored**) or as the whole part (**Counted**) |
| **Temperature** | the temperature thicknesses and $n$, $k$ are given at, 20 °C by default | the temperature the layers and substrate are computed at ([Theory](#theory)) |
| **Thickness factor**, one per layer material | none | every layer of that material that many times as thick, as at a chamber position |
| **Material in place of**, one per layer material | none | every layer of that material made of another, as for a film whose index shifts between vacuum and air |

**Constants missing**, under the temperature: the materials computed at another temperature that lack a constant the model reads, the missing constants on hover. The constants come from the [Material Editor](/design/material-editor/).

## Scoring across environments

- A merit row is scored in every environment that is on unless its **Env** cell in the Merit Function Editor names one. A [Specification](/design/specification/) check is judged the same way and passes when it passes in each environment.
- Refinement, Needle, Gradual Evolution, the Structural Optimizer and Deep Synthesis score every environment that is on. A needle goes into each environment as the material it swaps it for, $f$ times as thick, $f$ its thickness factor there, at that environment's temperature.
- The Min thickness a synthesis window proposes reads each MNT row in its environment: MNT 20 nm where TiO2 grows 0.8 times as thick asks 25 nm of every layer.
- The Monte Carlo yield, the report and the tolerance windows' verdicts count every environment that is on. Analysis windows compute the environment their **Environment** droplist names, the current one by default; each window's page says what **All** does there.
- Where the design states the temperature its film stress is given at, as the [Stress](/analysis/stress/) window sets it, a stress row in an environment at another temperature reads the stress moved by the same change.

## Theory

The total merit over the $N$ environments that are on and have a row scored in them, $\text{MF}_k$ being environment $k$'s merit over its own rows:

$$
\begin{aligned}
\text{MF}^2 &= \frac{1}{N} \sum_k \text{MF}_k^2 \\
\text{share}_k &= \frac{\text{MF}_k^2}{\sum_j \text{MF}_j^2}
\end{aligned}
$$

At another temperature each layer, after the environment's thickness factor and material in place, follows the strain model of H. Takahashi, *Appl. Opt.* **34**, 667 (1995), Eqs. 14, 15 and 18, taken at $\Delta T$ in place of the paper's 1 °C. A film held to its substrate follows the substrate's expansion in its plane and thins by its Poisson's ratio; its packing density $P$ moves, and the index with it:

$$
\begin{aligned}
A &= \frac{2(\alpha - \beta)(1 - 2\nu)}{1 - \nu}\,\Delta T \\
B &= \frac{2\nu(\alpha - \beta)}{1 - \nu}\,\Delta T \\
P &= \frac{1 + 3\beta\,\Delta T}{1 + 3\beta\,\Delta T + A} \\
d &= d_1\,(1 - B + \beta\,\Delta T) \\
n &= \left(n_1 + \frac{\mathrm{d}n}{\mathrm{d}T}\,\Delta T\right) P + 1 - P
\end{aligned}
$$

$\Delta T$ is the environment's temperature less environment 1's, $\alpha$ the substrate's linear expansion, $\beta$, $\nu$ and $\mathrm{d}n/\mathrm{d}T$ the layer material's linear expansion, Poisson's ratio and $\mathrm{d}n/\mathrm{d}T$, all per kelvin; $d_1$ and $n_1$ are the layer at environment 1's temperature, taken as fully dense there. $n$ is worked out at every wavelength and $k$ is kept, since the paper models the real index alone.

- A film whose material lacks $\beta$ or $\nu$, or whose substrate lacks $\alpha$, is taken as unstrained: $A = B = 0$, so $d = d_1 (1 + \beta\,\Delta T)$ and $n = n_1 + (\mathrm{d}n/\mathrm{d}T)\,\Delta T$, with a missing $\beta$ or $\mathrm{d}n/\mathrm{d}T$ counting as 0.
- The paper treats a whole filter as one film with an averaged index and one $\mathrm{d}n/\mathrm{d}T$. TFStudio applies the equations to each layer with its own material's constants and takes $\mathrm{d}n/\mathrm{d}T$ as one value at every wavelength; both are TFStudio's choices, not the paper's.
- The paper has no model for the substrate. TFStudio moves its index to $n_1 + (\mathrm{d}n/\mathrm{d}T)\,\Delta T$ and its thickness to $d_1 (1 + \alpha\,\Delta T)$, $k$ kept; a missing constant leaves that part as it is. The media do not change.

## References

- H. Takahashi, "Temperature stability of thin-film narrow-bandpass filters produced by ion-assisted deposition," *Appl. Opt.* **34**, 667-675 (1995).
