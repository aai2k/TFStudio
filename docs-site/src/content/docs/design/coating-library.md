---
title: Coating Library
description: Keep coatings as reusable stacks, browse the built-in starting designs, and put one onto either side of a design.
ribbonIcon: coating-library
---

The **Coating Library** window holds coatings as objects of their own, separate
from designs. A coating here is a layer stack together with the substrate and
incident medium it was designed on, the wavelength band, angle and polarization
it is specified for, and the specification it meets. Any coating in the library
can be put onto the front or the back of the active design.

The window has two shelves. **Built-in** is the set of starting designs that
ships with TFStudio. **My coatings** is what you have saved yourself.

## Built-in coatings

Every built-in coating uses materials from the built-in library, or carries its
own material definitions, so it computes the same on every installation. The
source of each design is recorded in the entry, and the shipped thicknesses are
the ones that meet the entry's specification with TFStudio's own material data.
A design taken from a book in idealized indices has been mapped to real
materials and re-optimized before shipping.

The built-in shelf is meant to be small and trustworthy rather than long. Use
an entry as a starting point: apply it, then refine or synthesize from there.

## Reading an entry

Select a coating in the list to see:

- **Use this when** and **Limitations**: what the coating is for and where it
  stops being a good answer.
- **Spectrum**: the coating alone on its substrate, seen from its incident
  medium, computed at the entry's own angle of incidence and polarization,
  which the plot states above the curves. At normal incidence it shows T, R
  and A; at an angle it shows the s and p components separately (solid s,
  dashed p), since that is what a beamsplitter or polarizer is specified by.
  The range is somewhat wider than the design bands, which are shaded.
- **Stack**: the layers from the substrate up, numbered the same way as in the
  Design Editor, with thicknesses in nm.
- **Properties in the design band**: the numbers that matter for that family,
  computed at the entry's angle. An antireflection coating shows its average
  and maximum R; a mirror its minimum R and its absorptance; an edge filter its
  pass and stop transmittance and the wavelength where T crosses 50 %; a
  band-pass its peak, centre wavelength and FWHM; a notch the same for its dip;
  a polarizer Ts, Tp and their ratio. At an angle, R and T are given for s, p
  and their average. A coating specified over several bands gets one column
  per band; layer count and total thickness close the list. These are the same
  numbers the merit function operands and the qualifiers would report.
- **Specification**: each claim the entry makes, with the angle and
  polarization it is stated at, its computed value and a pass or fail mark.
  The claims are evaluated with the same qualifiers the
  [Specification](/design/specification/) window uses.
- **Source**: where the design came from.

## Finding a coating

Every entry has a type and a set of tags. The type is the family: antireflection,
mirror, edge filter, band-pass, notch filter, beamsplitter, cold and hot mirror,
polarizer, low-E, chirped mirror, neutral density. The tags say the rest: the
spectral region (visible, NIR, MWIR and so on), how many bands it covers, what it
is for (laser, telecom, CWDM and DWDM grids, imaging, solar), what it does
(short-pass, long-pass, high-reflector, non-polarizing), how it is built
(quarter-wave stack, V-coat, metal-dielectric, the material pair), the geometry
and the substrate. Hover a tag to read what it means.

The list keeps one folder per family, each with its own color and a count of
what it holds. Folders start folded; click a header to unfold or fold it. Every
row carries a strip of its stack in the
materials' own colors, the same colors the Design Editor uses, substrate side
on the left.

The list can be narrowed by type, by substrate, by any number of tags (an entry
must carry all of them), by a wavelength that must lie inside one of its design
bands, by a maximum layer count, and by a text search over the name, the use
text, the tags, the substrate and the layer materials. The **Tags** button
unfolds the tags of the entries the other filters leave, one line per kind of
tag, each chip colored by its kind and showing how many entries choosing it
would keep. The tags you have chosen stay in the bar when the panel is folded
again.

## Applying a coating

Pick **Front** or **Back**, then **Replace the stack** or **Add on top of the
stack**, and press **Apply**. Replace swaps the chosen side's stack for the
coating. Add on top deposits the coating over what is already there, so the new
layers are the outermost ones. The design's substrate and media are not changed;
compare them with the substrate the entry was designed on before you rely on
the numbers.

Applying is one undoable edit: **Undo** brings the previous stack back.

If the coating brings a material definition under an id the design already
uses with different data, the design's own definition is kept and the window
says so. The coating may then compute differently than it does in the library.

## Saving a coating

**Save current coating…** in this window, or **Save coating to library…** in
the Design Editor's Tools menu, saves the front or back stack of the active
design into My coatings. Give it a name, a type and a short use note, and set
the band, angle and polarization it is meant for. Non-built-in materials are
embedded in the saved entry, so it stays usable when the catalog it came from
is renamed or removed.

Saved coatings are plain JSON files with the `.tfsc` extension in the Coatings
folder (Settings, Data Folders). Saving under an existing name replaces that
coating. **Delete** removes the selected saved coating.

## Sharing a coating

**Share a coating…** sends one of your coatings to the project for the
built-in library. With one of My coatings selected, the dialog opens a GitHub
issue prefilled with the layer table and the design conditions, or an email
with the same text, and **Save file for sending…** writes the coating with its
embedded material data as one file to attach to either. With nothing selected
it only points at the two ways to send a design.

Anything with a layer table and a stated purpose is welcome, in whatever form
you have it: a `.tfs` or `.tfsc` file, a table typed by hand, or a design
exported from another program, with or without a description. A contributed
coating ships in the next release with a credit in its source line.
