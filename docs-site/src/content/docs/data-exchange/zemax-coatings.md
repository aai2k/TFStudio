---
title: Zemax Coatings
description: Read and write Zemax OpticStudio COATING.DAT, importing materials and coating stacks, saving a coating to the Coating Library, or exporting the active design.
ribbonIcon: zemax-coatings
---

Zemax Coatings reads and writes OpticStudio `COATING.DAT` files: a text database of `MATE` (material) and `COAT` (layer stack) records, beside the `IDEAL`, `IDEAL2`, `TABLE`, `TAPR` and `ENCRYPTED` coating models. It imports a stack and its materials into a design or the [Coating Library](/design/coating-library/), and exports the active design as a `COAT` stack with its `MATE` records. **Coatings**, **Materials** and **Export** are tabs in one row with the reference wavelength; the result of the last action shows at its right end.

<!-- shot: zemax-coatings | OpticStudio's own COATING.DAT read, its 12-layer 400-900 nm AR picked from the coatings list and imported onto the bare BK7 design -->

## Computed quantities

**Coatings** lists every coating record with its type and layer count, and the selected stack's layers with their materials and physical thicknesses. **Materials** lists every `MATE` record. **Export** previews the `COAT` and `MATE` text before it is saved.

## Controls and settings

**Load COATING.DAT**, in the panel of the Coatings or Materials tab, reads a file; its contents and your picks stay while you switch windows. **Reference λ₀ (nm)** converts relative thicknesses in waves to nm, on import and export.

**Coatings**: only `COAT` stacks import; the others are listed with a lock, since `IDEAL`, `IDEAL2` and `TABLE` describe a surface by its R and T rather than by layers, and `ENCRYPTED` cannot be decoded.

- **Import → front coating** puts the stack on the active design's front, and its `MATE` materials into a `Zemax <file>` catalog. It is off on a design coated on the back alone with [**Ignore other side**](/design/evaluation-modes/) ticked.
- **Save to Coating Library…** saves the stack into My coatings through the Coating Library's dialog. A `COAT` record names no media, so the coating takes the active design's, or air and BK7 with no design open. Its thicknesses are converted at λ₀, which is stored with it, and its materials travel inside it, so nothing is added to your catalogs.

**Materials**: tick records and **Import selected**, or **Import all**, to add them to a catalog without touching the design.

**Export**, from the front of the active design:

- **Layer thickness**: **Absolute (µm)** or **Relative (waves)** of λ₀. Absolute needs no λ₀ and loses nothing.
- **Include materials**: **Used by design** or **All catalog materials**.
- **Coating name**: the `COAT` record's name.
- **Material sampling grid**: the range and step at which each material's n, k is tabulated into its `MATE` record.

## Format conventions

| Quantity | Zemax | TFStudio |
|---|---|---|
| Wavelength | µm | nm |
| Extinction | stores −k | k > 0, sign flipped both ways |
| Layer thickness | relative T in waves, or absolute µm | physical d in nm |
| Layer order | outermost to substrate | the same as the front coating is stored |

- No reversal is needed: Zemax's order is how TFStudio stores a front coating; the Design Editor only displays it from the substrate. A design exported and read back keeps its thicknesses and k signs.
- An imported material reads its `MATE` table by straight lines between rows and holds the end rows outside it, as Zemax does. A catalog an earlier version made from the file reads the tables as a smooth curve: importing again on the Materials tab lists those materials as changed and asks before replacing them, and a coating import keeps them.
- A name defined in more than one `MATE` record, matched without regard to case, is marked on the Materials tab as **2 of 2** and so on, and named in a notice. Each record imports on its own, a later one with (2), (3) after its name; a coating layer naming it is built with the last record of that name. If the records differ, check which one the file meant.

## Theory

A relative thickness T is an optical thickness in waves of the lens's primary wavelength λ₀:

```
d = T · λ₀ / n(λ₀)
```

with n the real index of the layer at λ₀. λ₀ belongs to the lens, not the file, so a relative coating needs it supplied. The help's worked example: n = 1.4, T = 0.25, λ₀ = 0.550 µm gives d = 0.0982 µm.

## References

- Zemax OpticStudio Help → *The Coating Tab → Coating File Definitions* (`MATE`, `COAT`, `IDEAL`, `TABLE`), the source of the `COATING.DAT` format.
