---
title: Design Import
description: Read TFCalc (.tfd), Essential Macleod (.dds) and OptiLayer (.dsg) design files into a project as TFStudio designs, with their materials matched to your catalogs.
---

The **Import** button in the Project group of the Setup tab reads coating
designs saved by TFCalc (`.tfd`), Essential Macleod (`.dds`) and OptiLayer
(`.dsg`) and adds them to a project folder as TFStudio designs. Pick any
number of files from any of the programs in one go; each file becomes one
design.

## The dialog

The left side lists every design that could be read, with its program, its
layer count and how many of its material names still need a TFStudio
material. Files that could not be read are listed underneath with the reason.
**Add files…** appends another pick to the same batch.

The right side shows the highlighted design: incident medium, substrate,
exit medium and reference wavelength, then the stack with the thickness each
layer will have in nanometres, and beside it what the file says about the
layer (its optical thickness, a lock). Anything the reader had to assume or
leave out is written above the stack, and so is a layer whose thickness could
not be computed. Below the stack is the materials table, and at the bottom
the design's transmittance, reflectance and absorptance at normal incidence
over the file's own plot range, once every material is assigned.

**Materials.** A design names its materials the way the program's own
database does. Each name is looked up in your catalogs by exact name, and the
match is shown in the picker; a material imported from the same program is
preferred over any other, a user catalog over the built-in library, and
`Air` is always the built-in Air. Change any suggestion with the picker. A
name is shared across the batch, so assigning it once covers every design
that uses it. Import the program's material files first (Material Editor,
**Import material files…**) so the names are found. A name left unassigned is
imported as a missing material: the Design Editor flags it, and
**Replace Materials** fixes it later.

An OptiLayer design names its materials only by abbreviation, so the reader
looks in the design's folder: the project file's abbreviation map when it has
one, otherwise the material file whose index at the control wavelength is
the one stored with the layer. The folder's substrate files supply the media
and, when the project does not name it, the substrate. A material found this
way is marked "from the design's folder" and travels inside the design, the
way a `.tfs` file carries its materials, so the design computes with the
definition it was made with. Pick a catalog material in its row to use that
instead; the button beside the status gives the file's definition back.

An Essential Macleod design names its materials the way the program's own
database does, and that database is one folder on the computer, not the
design's folder. The reader looks for it where the program records it, the
materials folder set in Essential Macleod's own settings, or the installer's
default. Every name the database holds is taken from it, marked "from the
program's material database", read between its table points the way Essential
Macleod reads it, and carried inside the design, so an imported design
reproduces the numbers the program computed. If the database is not found, or
lives somewhere else, **Essential Macleod materials…** in the header points
the batch at a folder. A name the database does not hold is matched against
your catalogs as above.

**Footer.** TFCalc files do not record their wavelength unit, but every
layer carries both its quarter waves and its physical thickness, and the two
agree only in the right unit, so the switch reads the unit from the file.
Set it to nm or µm to override; the design then notes when the file
disagrees. Choose the project folder, then **Import**. The Design Editor
opens on the last design added.

## What is refused

A rugate or graded-index design is listed under the files that could not be
read, with the reason. OptiLayer's rugate layers, Essential Macleod's
packing-density layers and TFCalc's variable materials are those programs'
ways of building a graded index, and TFStudio has no graded layer to hold
one.

## How to read it

| Quantity | TFCalc | Essential Macleod | OptiLayer | In TFStudio |
| --- | --- | --- | --- | --- |
| Layer numbering | from the substrate | from the incident medium | from the substrate | stored the same way whichever program wrote it |
| Layer thickness | physical, nm; the QWOT is shown for reference | full-wave optical at λ₀, or physical | quarter waves at the control wavelength, with the index stored for the layer, at the match angle | physical nm; an optical thickness is converted with the layer's index at λ₀, at the match angle where the file has one |
| Absorbing layer | physical, nm | optical with the real part of n | quarter waves with the real part of n; a layer whose index is too low for the wave to propagate at the match angle is converted at normal incidence and noted | physical nm |
| Reference wavelength | Environment, in the file's unit, read from the layers | in the file's unit | the control wavelength | nm |
| Back side | back layers | none | none | back stack; the surface mode follows |
| Exit medium | Environment; the same material as the substrate means a semi-infinite substrate, any other means both surfaces of the substrate are evaluated | the substrate is the emergent medium | the project file; the substrate is semi-infinite, the program's default, since its Back Side option is not in the file | as in the file, with the evaluation mode set to match; the substrate material where the program has none, which means the same thing |
| Substrate thickness | Environment, mm | not used | not in the file | TFStudio's default where the file has none |
| Constant index | none | a number written as a material name, when no catalog holds a material of that name | the stored index, when no folder material matches | a constant-index material embedded in the design |
| Locked layer | Optimize = No | Lock | status F | locked |

The stack formula and its symbols, the incident angle of the file, the
match angle, and anything the reader left out or assumed (optimization
targets, layer groups, linked layers, environments beyond the first,
monitoring settings, a medium the project does not name) are written into
the design's Notes, in the language the program is running in.
