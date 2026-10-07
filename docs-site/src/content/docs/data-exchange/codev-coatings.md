---
title: CODE V Coatings
description: Read and write CODE V MULTILAYER (MUL) coatings, importing a .seq or .mul file into a design or exporting the active design as a .seq file.
ribbonIcon: codev-coatings
---

The **CODE V Coatings** window moves a coating between TFStudio and CODE V. It reads a CODE V MULTILAYER (`MUL`) coating, either the `.seq` command file that enters the stack or the `.mul` file CODE V saves from it, and writes one side of the active design as a `.seq` file that CODE V runs to make the `.mul`. Import and export are on separate tabs, with one status line above them.

## Settings

**Open .seq or .mul** (Import tab): reads a coating file. From a `.seq` file the stack entered in the `MDA` sub-option is read: `PHT`, `TIT`, `WL`, `WLG`, `REF`, `ANG`, `INC`, `COA`, `GRO` and `END` groups, `SUB` and the `MIC` catalog. The analysis, plot and optimization options and the file commands are passed over; any other command is skipped and named under the warnings. CODE V reads at most 21 values from one `WL` command and ignores the rest, and so does the import, with a warning. A `.mul` file is read as CODE V saved it. The tab then shows the title, the incident medium, the substrate, the wavelengths, the angles and the reference wavelength, and the layers from the incident medium to the substrate with their thickness in nm and a lock on each layer CODE V holds fixed (code 100).

**Import → front coating** (Import tab): replaces the front coating of the active design with the stack, and sets the design's incident medium and substrate to the ones in the file. A thickness entered in waves (`PHT N`) is converted to nm with the layer's n at `REF`, or at the central analysis wavelength when the file has no `REF`, which is what CODE V takes then. Every material of the file, a `MIC` entry or an index written on a `COA`, `INC` or `SUB` line, goes into a user catalog named `CODE V` and the file name. Importing the same file again uses that catalog, and a material it already holds is kept as it is, edits included. Undo takes the whole import back in one step.

**Side** (Export tab): **Front** writes the design's incident medium, the front coating and the substrate. **Back** writes the exit medium as the incident medium, then the back coating from the exit side to the substrate, then the substrate, because CODE V wants air as the incident medium and the glass as the substrate on either face of an element.

**Title (TIT)**: the coating title, up to 80 characters. It starts as the design name.

**File name (SAV)**: the name of the `.mul` file the last command of the `.seq` writes. **Save .seq** offers the `.seq` under the same name.

**REF (nm)**: the reference wavelength written to `REF`. It starts at the design's reference wavelength.

**Analysis wavelengths, WL**: from, to and step in nm. The number of wavelengths is shown beside them. CODE V takes up to 100, and a larger count is refused before anything is written.

**Angles of incidence, ANG**: up to five angles in degrees, in the incident medium. The plus button adds one, the cross removes one.

**Generate preview** builds the file and shows it in full; **Save .seq** writes it. A design with a material that cannot be found on this computer cannot be exported until the material is replaced.

## How to read it

What CODE V accepts, from the MUL chapter of its help, and what the export does about each limit:

| Item | CODE V | On export |
| --- | --- | --- |
| Layers | up to 1000 | refused above 1000 |
| Analysis wavelengths, `WL` | up to 100 | refused above 100 |
| Angles, `ANG` | up to 5 | the field holds five |
| Points per `MIC` material, `MWL` | up to 21 | a material is sampled at the analysis wavelengths; above 21 points it is cut to 21, keeping the points where n and k bend most, and a warning names it |
| Material label | 6 characters | made from the material name, with a number added when two labels would be the same |
| Incident medium and substrate | n only | the k of an absorbing medium is dropped, with a warning |
| Thickness | physical nm (`PHT Y`) or waves at `REF` (`PHT N`) | physical nm, `PHT Y` |
| Fixed layer | code 100 | a locked layer is written with 100, any other with 0 |

A material whose n and k do not change over the analysis wavelengths is written as a number on its `COA` line rather than as a `MIC` entry. k is written as a positive number. CODE V enters layers from the incident medium to the substrate, while the Design Editor numbers them from the substrate, so the Design Editor's layer 1 is the last `COA` line of the file.

The file ends with `SAV`, so running it in CODE V writes the `.mul` that `MLT` attaches to a lens surface. Once the coating is on a lens surface, CODE V takes the substrate index from the lens, so `SUB` matters only inside `MUL`.

## References

- CODE V Multilayer Design Reference Manual, chapter "Multilayer Coating Design and Analysis (MUL)": *MDA Sub-Option* for the commands and their limits, *Technical Notes* for the order of the media on each kind of surface.
