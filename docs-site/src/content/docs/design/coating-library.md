---
title: Coating Library
description: Keep coatings as reusable stacks, browse the built-in starting designs, and put one onto either side of a design.
ribbonIcon: coating-library
---

The Coating Library keeps coatings apart from designs. A coating is a layer stack with the substrate and incident medium it was designed on, the band, angle and polarization it is meant for, and the specification it meets; any of them can go onto the front or back of the open design. **Built-in** holds the starting designs that ship with TFStudio, **My coatings** the ones you saved.

<!-- shot: coating-library | the 150-layer flat-top DWDM filter picked from the built-in band-pass shelf, the detail pane scrolled to its spectrum with the properties and specification under it -->
![Coating Library](/screenshots/coating-library.png)

## Computed quantities

Selecting a coating shows:

- **Spectrum**: the coating alone on its substrate, seen from its incident medium, at the entry's own angle and polarization, which the plot states. At normal incidence T, R and A; at an angle s solid and p dashed, as a beamsplitter or polarizer is specified. The design bands are shaded.
- **Stack**: layers from the substrate up, numbered as in the Design Editor, thicknesses in nm.
- **Properties in the design band**, at the entry's angle, chosen for its family: average and maximum R for an antireflection coating; minimum R and A for a mirror; pass and stop T and the edge $\lambda$ at $T = 50\,\%$ for an edge filter; peak, centre $\lambda$ and FWHM for a band-pass; notch centre and width at $T = 50\,\%$ for a notch; $T_s$, $T_p$ and extinction $T_p / T_s$ for a polarizer. At an angle R and T are given for s, p and their average, with one column per band; layer count and total thickness close the list.
- **Specification**: each claim the entry makes, at its angle and polarization, with its value and a pass or fail mark, judged as the [Specification](/design/specification/) window judges it, each at its own step.
- **Use this when**, **Limitations** and **Source**.

Every built-in coating uses built-in materials or carries its own, so it computes the same on every installation; a design taken from a book in idealized indices has been moved to real materials and re-optimized to meet its specification. Use an entry as a starting point and refine from there.

## Controls and settings

The list keeps one folder per family, each with a count; a strip on every row shows the stack in the materials' colors, substrate on the left. Narrow it by type, substrate, a **λ in band** that must lie inside a design band, **Max layers**, and text over the name, use, tags, substrate and materials. **Tags** unfolds the tags of the entries left, one line per kind, each chip with the count it would keep; chosen tags must all be on an entry and stay in the bar when the panel folds. Hover a tag for what it means.

**Apply to the active design**: **Front** or **Back**, then **Replace the stack** or **Add on top of the stack**, where the coating's layers become the outermost ones. One undo step. The design's substrate and media do not change, so compare them with the entry's before relying on its numbers.

**Save current coating…** here, or **Save coating to library…** in the Design Editor's Tools menu, saves the front or back stack into My coatings with a name, type, use note, band, angle and polarization. The [Zemax Coatings](/data-exchange/zemax-coatings/) and [CODE V Coatings](/data-exchange/codev-coatings/) windows save a coating read from a file through the same dialog. Saved coatings are `.tfsc` JSON files in the Coatings folder (Preferences, Data folder); a name already there is replaced. **Delete** removes the selected saved coating.

**Share a coating…** sends one of your coatings for the built-in library: a GitHub discussion or an email prefilled with the layer table and conditions, and **Save file for sending…** writes the coating with its material data as one file to attach. A contributed coating ships in the next release with a credit in its source line.

## Materials in a coating

- A saved coating embeds every material that is not built in, so it stays usable when its catalog is renamed or removed. While the catalog it came from is on this computer, the coating computes with that catalog's current data, in the library and in the design.
- A coating from another computer can carry its own copy under an ID that a catalog here holds with other $n$, $k$. The library computes with that copy, and so does a design that does not use the ID yet.
- When a coating brings a definition under an ID the design already computes with other data, the design keeps its own and the window says so; the coating may then compute differently than it does in the library.
