---
title: Multi-Environment Optimization
description: "Optimize one coating against several media environments at once: per-environment merit functions, weights, spectrum comparison and export."
---

**Multi-environment optimization** lets a single coating design chase targets in
several media environments at the same time — for example the same stack used
in air on one side of the product and embedded in an optical cement on the
other, or a coating that must perform both in vacuum and in an immersion
liquid. Instead of optimizing for each environment separately and hoping the
results agree, you define the environments once and TFStudio drives the *same*
layer stack to satisfy all of them in a single run.

The feature is built around three ideas:

- **Environments** — each environment is a set of media (incident medium, exit
  medium, substrate) the coating is evaluated in.
- **Per-environment merit** — every environment can have its own operand set
  (targets), like a Zemax configuration, or share the design-level set.
- **Weights** — a weight per environment that decides how much it counts in
  the combined merit function.

---

## Enabling multi-environment mode

Open the [Merit Function Editor](/design/merit-function-editor/). At the top of
the window is a **Multi-environment** checkbox with an ON / OFF badge.

- **Turning it on** creates a first environment (E1) seeded from the design's
  current media — the incident medium, exit medium and substrate already set in
  the [Design Editor](/design/design-editor/).
- **Turning it off** clears the environment list and returns the design to
  ordinary single-environment behavior. The shared operand set is untouched.

Once enabled, an **Environments** panel appears below the operand table. Each
row is one environment:

| Field | Meaning |
| ----- | ------- |
| **Incident** | the medium light arrives from (e.g. `Air`, `cement`). |
| **Exit** | the medium light leaves into. |
| **Substrate** | the substrate material for this environment. |
| **Weight** | how much this environment counts in the combined merit function (default 1.0 — see [below](#how-the-optimizers-handle-environments)). |
| **MF** | the environment's current merit value, recomputed live as you edit. |

Use **+ Add** to append another environment and the × button to delete one.
Environments are labelled E1, E2, … everywhere else in the program.

> Media fields you leave empty fall back to the design-level media set, so you
> only fill in what actually differs between environments.

---

## Per-environment merit functions

By default every environment is scored with the **shared, design-level operand
set** — the operands you see in the editor. That is usually what you want: the
same targets, evaluated in each environment's media.

Sometimes an environment needs its own targets — a different band, a different
tolerance, an extra constraint. This works like Zemax multi-configurations:

- An environment without its own operands shows a **Using design-level MF**
  tag. Press **Customize** to give it an independent operand set, starting as a
  copy of the shared set. From then on it is a separate list you edit freely.
- **Edit** opens that environment's operand table. A breadcrumb at the top
  shows where you are: `Design > E1: air → cement`. Press **Back** to return to
  the design-level operand set.

An environment's MF value (in its row) is always computed with its own operands
when it has them, and with the shared set otherwise.

---

## How the optimizers handle environments

Every optimization tool — SQP, DLS, Conjugate Gradient, Newton, Newton-CG,
Differential Evolution, Simulated Annealing, *Try all, keep best*, and the
synthesis tools ([Needle](/synthesis/needle/), [Gradual
Evolution](/synthesis/gradual-evolution/), [Structural
Optimizer](/synthesis/structural-optimizer/)) — minimizes **the same combined
merit function** built from all environments. There is no separate
"multi-environment" method: multi-environment is a property of the merit
function itself, so every method inherits it automatically.

The combination is a **weighted average pooled across environments**: each
environment's operands are evaluated in that environment's media, and its
residual sums are scaled by the environment's weight before being combined into
one overall merit value. A single environment reduces exactly to the ordinary
merit function.

**Weights set priorities.** An environment with weight 2 counts twice as much
as one with weight 1, so optimization effort flows to the environments that
matter most. Start all weights at 1.0, run, look at the per-environment
breakdown in [Refinement](/synthesis/refinement/) (see
[below](#per-environment-export-and-monitoring)), and raise the weight of any
environment that is falling behind its targets.

> When no environment defines its own operands, the combined merit is
> numerically identical to the single-environment merit function. Turning the
> feature on and changing nothing else alters no results — the value only shows
> once you add a second environment.

---

## Comparing environments in Optical Evaluation

[Optical Evaluation](/analysis/optical-evaluation/) gains an **Environment**
dropdown in its toolbar whenever the design has environments. It lists:

- **Design (all)** — the design-level media (the same spectrum you saw before
  the feature existed).
- **E1, E2, …** — one entry per environment, labelled with its media, e.g.
  `E1: air → cement`.

Selecting an environment switches the plot to that environment's spectrum. The
selection is remembered per design, so a design reopens on the environment you
were last viewing.

---

## Locking windows for side-by-side comparison

Next to the Environment dropdown is a **Lock view** button, built for comparing
two states of the same design:

1. Select the environment (or design state) you want to keep on screen.
2. Press **Lock view**. The window now *freezes* its current view — the
   dropdown no longer changes a locked window.
3. Open a **second** Optical Evaluation window from the ribbon.
4. In the second window, select the other environment — or run an optimization
   and let the second window show the updated design while the first window
   keeps the old one.

Because the locked window stops following your selections, you get a stable
before/after pair: optimized vs. original, or environment A vs. environment B.
Press **Unlock view** to let the window follow the dropdown again.

---

## Environment-aware analysis tools

The tools below resolve each environment's media (incident / exit / substrate)
when they calculate, so their results reflect the multi-environment setup
automatically:

- [Variator](/design/variator/)
- [Color Evaluation](/analysis/color-evaluation/)
- [Ellipsometry](/analysis/ellipsometry/)
- [Electric Field](/analysis/efield/)
- [Admittance Diagram](/analysis/admittance/)
- [Integral Values](/analysis/integral-values/)
- [Refractive Index Profile](/analysis/refractive-index-profile/)
- [Roughness / Scattering](/analysis/roughness-scattering/)
- [Inhomogeneities](/analysis/inhomogeneities/)

All of them evaluate against the same resolved media as the merit function, so
what the analysis windows show is consistent with what the optimizer is
minimizing.

---

## Per-environment export and monitoring

**Spectrum export.** The copy / save-CSV actions in Optical Evaluation export
exactly the spectrum currently on screen — so when an environment is selected
(or a window is locked to one), you export that environment's spectrum.

**Reports and process files.** The reporting and export model layers ([Report
Generator](/data-exchange/report-generator/), process exporter) resolve the
media of the environment they are asked for, so per-environment data can be
generated from the same design.

**Refinement breakdown.** The [Refinement](/synthesis/refinement/) window shows
an **Env MF** strip in multi-environment mode: one merit value per environment
for the current design state, with the saved pre-run value alongside, e.g.
`E1 MF: 0.42 (initial 0.91)`. At a glance this tells you which environment is
holding the design back — the one whose MF stays high.

---

## A worked example

A coating that must work both in air and embedded in an optical cement:

1. Enable **Multi-environment** in the Merit Function Editor.
2. **+ Add** environment E2 and set its incident / exit media to the cement.
3. **Customize** E2 if it needs its own targets, or leave it on the shared set.
4. Run [Refinement](/synthesis/refinement/) — the combined merit now covers
   both environments.
5. In Optical Evaluation, **lock** one window on E1, open a second window on
   E2, and confirm both spectra meet their targets.
6. Watch the **Env MF** strip: if E2 stays high, raise its weight and refine
   again.

The same pattern applies to any set of environments: define, weight, optimize,
compare, export. For more on the merit function itself, see the [Merit Function
Editor](/design/merit-function-editor/) and [Optimization
Methods](/synthesis/optimization-methods/) pages.
