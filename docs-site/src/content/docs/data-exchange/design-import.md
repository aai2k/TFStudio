---
title: Design Import
description: Read TFCalc (.tfd), Essential Macleod (.dds) and OptiLayer (.dsg) design files into a project as TFStudio designs, with materials matched to your catalogs.
---

**Import**, in the Project group of the Setup tab, reads coating designs saved by TFCalc (`.tfd`), Essential Macleod (`.dds`) and OptiLayer (`.dsg`) and adds them to a project folder as TFStudio designs. Any number of files from any of the programs can be picked at once; each file becomes one design.

<!-- shot: import-designs | two Essential Macleod designs and a TFCalc mirror picked at once, the three-cavity narrowband filter highlighted with its stack, materials and spectrum -->
![Design Import](/screenshots/import-designs.png)

## Computed quantities

The list on the left gives every design read, with its program, layer count and how many material names still need a material; files that could not be read are listed below with the reason.

The highlighted design shows its incident medium, substrate, exit medium and reference wavelength; its stack with each layer's thickness in nm beside what the file says of it (its optical thickness, a lock); every assumption or omission above the stack, including a layer whose thickness could not be computed; the materials table; and, once every material is assigned, T, R and A at normal incidence over the file's own plot range.

## Controls and settings

**Add files…** adds another pick to the batch.

**Materials**: each name the design uses is looked up in your catalogs by exact name, preferring a material imported from the same program, then a user catalog over the built-in library; `Air` is always the built-in Air. A name is shared across the batch, so one assignment covers every design using it. Import the program's material files first (Material Editor, **Add → From TFCalc, Macleod or OptiLayer files…**) so the names are found. A name left unassigned imports as a missing material, which the Design Editor flags and **Replace Materials** fixes.

- **OptiLayer** names materials by abbreviation only, so the reader looks in the design's folder: the project file's abbreviation map, else the material file whose index at the control wavelength is the one stored with the layer. The folder's substrate files give the media, and the substrate where the project does not name it.
- **Essential Macleod** names materials as its database does, and that database is one folder on the computer: the materials folder in the program's own settings, or the installer's default. **Essential Macleod materials…** in the header points the batch at another folder. Its materials are read between table points as the program reads them, so an imported design gives the numbers the program gave.
- A material found in the design's folder or the program's database is marked as such and travels inside the design, as a `.tfs` carries its materials. Picking a catalog material in its row uses that instead; the button beside the status gives the file's definition back.

**Footer**: TFCalc files do not record their wavelength unit, but every layer stores both its quarter waves and its physical thickness, which agree only in the right unit, so the unit switch reads it from the file; set nm or µm to override, and the design notes when the file disagrees. Pick the project folder, then **Import**; the Design Editor opens on the last design added.

A rugate or graded-index design is refused with the reason: OptiLayer's rugate layers, Essential Macleod's packing-density layers and TFCalc's variable materials build a graded index, and TFStudio has no graded layer to hold one.

## File conventions

| Quantity | TFCalc | Essential Macleod | OptiLayer | In TFStudio |
|---|---|---|---|---|
| Layer numbering | from the substrate | from the incident medium | from the substrate | stored the same whichever program wrote it |
| Layer thickness | physical nm; QWOT shown for reference | full-wave optical at $\lambda_0$, or physical | quarter waves at the control wavelength, with the layer's stored index, at the match angle | physical nm ([Theory](#theory)) |
| Absorbing layer | physical nm | optical, with the real part of $n$ | quarter waves with the real part of $n$; a layer evanescent at the match angle is converted at normal incidence and noted | physical nm |
| Reference wavelength | Environment, read from the layers | in the file's unit | the control wavelength | nm |
| Back side | back layers | none | none | back stack; the surface mode follows |
| Exit medium | Environment; the substrate material means a semi-infinite substrate, another means both faces are evaluated | the substrate is the emergent medium | the project file; semi-infinite substrate, the program's default | as in the file, with the evaluation mode to match |
| Substrate thickness | Environment, mm | not used | not in the file | TFStudio's default where the file has none |
| Constant index | none | a number written as a material name, when no catalog holds that name | the stored index, when no folder material matches | a constant-index material in the design |
| Locked layer | Optimize = No | Lock | status F | locked |

The stack formula and its symbols, the file's incident and match angles, and whatever the reader left out or assumed (optimization targets, layer groups, linked layers, environments beyond the first, monitoring settings, a medium the project does not name) go into the design's Notes, in the program's running language.

## Theory

An optical thickness becomes physical with the real part of the layer's index $n$ at the file's wavelength:

$$
\begin{aligned}
& \text{Essential Macleod, full waves } T \text{ at } \lambda_0\text{:} & \quad d &= T \cdot \lambda_0 / n(\lambda_0) \\
& \text{OptiLayer, quarter waves } Q \text{ at } \lambda_c\text{:} & \quad d &= Q \cdot \lambda_c / (4 n \cos\theta) \\
& & \quad \sin\theta &= n_m \sin\theta_m / n
\end{aligned}
$$

with $\theta_m$ the match angle in the match medium of index $n_m$. Where $n_m \sin\theta_m \ge n$ the wave is evanescent and has no real $\cos\theta$, so that layer is converted at normal incidence and noted.
