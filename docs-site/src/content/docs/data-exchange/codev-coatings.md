---
title: CODE V Coatings
description: Read and write CODE V MULTILAYER (MUL) coatings, importing the layers of a .seq or .mul file into a design or the Coating Library, or exporting the active design as a .seq file.
ribbonIcon: codev-coatings
---

CODE V Coatings moves a coating between TFStudio and CODE V. It reads a CODE V MULTILAYER (`MUL`) coating, the `.seq` command file that enters the stack or the `.mul` file CODE V saves from it, and writes one side of the active design as a `.seq` that CODE V runs to make the `.mul`. Import and Export are tabs in one row; at its right end a warning badge holds what the last read or export noted.

<!-- shot: codev-coatings | a CODE V command file for a 15-layer TiO2 / SiO2 mirror at 45° read, its media, wavelengths, angles and layers shown, then imported as the mirror design's front coating -->
![CODE V Coatings](/screenshots/codev-coatings.png)

## Computed quantities

**Import**: the file's incident medium and substrate, wavelengths, angles and reference wavelength, its title, and its layers from the incident medium to the substrate with thickness in nm and a lock on each layer CODE V holds fixed (code 100).

**Export**: **Generate preview** shows the whole `.seq` file before it is saved.

## Controls and settings

**Open .seq or .mul** reads a coating file.

**Import → front coating** and **Import → back coating** replace that coating of the active design; the design keeps its own media and substrate, and the file's `INC` and `SUB` are shown, not applied. The materials go into a user catalog named `CODE V` and the file name. The back coating takes the file's first layer on the exit side, the order the export writes. With **Symmetric (back = front)** only the front import is offered, and the side **Ignore other side** leaves out cannot be imported into. Undo restores the coating; the catalog stays.

**Save to Coating Library…** saves the stack into My coatings through the [Coating Library](/design/coating-library/)'s dialog, between the file's `INC` and `SUB` (n 1 with no k as Air). Its band starts at the file's wavelengths, or the [Optical Evaluation](/analysis/optical-evaluation/) band for a file with one wavelength, and its angle at the first `ANG`. The materials travel inside the saved coating, so nothing is added to your catalogs.

| Export field | Writes |
|---|---|
| **Side** | **Front**: incident medium, front coating, substrate. **Back**: the exit medium as incident medium, the back coating from the exit side, the substrate, since CODE V wants air in front and glass behind on either face. |
| **Title (TIT)** | up to 80 characters, the design name to start with |
| **File name (SAV)** | the `.mul` the file's last command writes; **Save .seq** uses the same name |
| **REF (nm)** | the reference wavelength, the design's to start with |
| **Analysis wavelengths, WL** | from, to and step in nm, at most 100 wavelengths |
| **Angles of incidence, ANG** | up to five, from 0 to below 90° |

A design with a material this computer cannot find cannot be exported until the material is replaced.

## File format and limits

- From a `.seq` the import reads the `MDA` stack: `PHT`, `TIT`, `WL`, `WLG`, `REF`, `ANG`, `INC`, `COA`, `GRO` and `END` groups, `SUB` and the `MIC` catalog. Analysis, plot, optimization and file commands are passed over; any other command is skipped and named in the badge. A `.mul` is read as CODE V saved it, both its sample coatings and the files CODE V 11.2 saves.
- CODE V reads at most 21 values from one `WL`, `MWL` or `EXT` command or `MIC` line; the import keeps the first 21 too, with a warning. A number written with a decimal comma (`403,03`) is read but warned about, since CODE V does not read it.
- `WLG` builds its wavelengths in single precision, as CODE V does, so `WLG 400 800 10` shows as 400 to 799.9997 nm, and a file with no `REF` has 599.9998 nm.
- An imported `MIC` material is tabulated over its `MWL` points, the wavelengths and `REF`, with n and k following CODE V 11.2's interpolation of its table between and past the points. A warning names a material whose table a waves-thickness layer reads past `REF`.
- A layer coupled to others (codes 1 to 99) is imported free, since TFStudio has no coupled layers, and the report counts them. Importing the same file again reuses its catalog and keeps any material already there, edits included.

| Item | CODE V | On export |
|---|---|---|
| Layers | up to 1000 | refused above 1000 |
| Analysis wavelengths, `WL` | up to 100 | refused above 100; at most 21 per `WL` command |
| Angles, `ANG` | up to 5 | the field holds five |
| Points per `MIC` material, `MWL` | up to 21 | sampled at the wavelengths; above 21, points are added where CODE V's interpolation misses most, until every wavelength matches to the 6 decimals written or 21 are kept, with a warning |
| Material label | 6 characters | from the material name, numbered when two would clash |
| Incident medium and substrate | n only | k of an absorbing medium dropped, with a warning |
| Thickness | nm (`PHT Y`) or waves at `REF` (`PHT N`) | nm, `PHT Y` |
| Fixed layer | code 100 | a locked layer 100, any other 0 |

A material whose n and k are constant over the wavelengths is written as a number on its `COA` line rather than a `MIC` entry, with k positive. CODE V lists layers from the incident medium inward, so the Design Editor's layer 1 is the last `COA` line. The file ends with `SAV`, so running it writes the `.mul` that `MLT` attaches to a lens surface; on a lens CODE V takes the substrate index from the glass, so `SUB` matters only inside `MUL`. The export is confirmed in CODE V 11.2 and not checked in other versions.

## Theory

A `PHT N` thickness T is an optical thickness in waves of `REF`:

```
d = T · REF / n(REF)
```

with n the real index of the layer at `REF`, or at the central analysis wavelength when the file has no `REF`, as CODE V takes it. A `.mul` stores every thickness this way and is read back with the n(REF) stored beside it.

## References

- CODE V Multilayer Design Reference Manual, chapter "Multilayer Coating Design and Analysis (MUL)": *MDA Sub-Option* for the commands and their limits, *Technical Notes* for the order of the media on each kind of surface.
