---
title: Zemax Coatings
description: Read and write Zemax OpticStudio COATING.DAT, importing materials and coating stacks, saving a coating to the Coating Library, or exporting the active design.
ribbonIcon: zemax-coatings
---

The **Zemax Coatings** window reads and writes Zemax OpticStudio `COATING.DAT` files. Import a coating stack (and its materials) from a `COATING.DAT` into a TFStudio design, save one to the [Coating Library](/design/coating-library/), or export the active design as a `COAT` stack plus its `MATE` material definitions for use in OpticStudio.

`COATING.DAT` is Zemax's coating database: a text file of `MATE` (material) and `COAT` (coating-stack) records, alongside the ideal and tabular coating models (`IDEAL`, `IDEAL2`, `TABLE`, `TAPR`, `ENCRYPTED`). The window parses the whole file and presents it in three tabs: **Coatings**, **Materials**, and **Export**. The tabs sit in one row with the reference wavelength, and what the last action did shows at the right-hand end of that row. Load a file with **Load COATING.DAT** in the panel on the left of the Coatings or the Materials tab; the parsed contents and your selections stay put while you switch between tools.

## Settings

**Reference λ₀ (nm)**: the wavelength used to convert between Zemax's relative thickness (in waves) and physical thickness in nanometres on both import and export.

**Coatings tab**: the panel lists every coating record in the file with its type and layer count. Select a layer stack to see its layers on the right. Only `COAT` layer stacks import; the ideal, table and encrypted records are listed with a lock.

- **Import → front coating** loads the stack as the front coating of the active design. Its `MATE` materials are registered into a `Zemax <file>` catalog so the design resolves its materials immediately. With no design selected there is nothing to import into, so the button is off, while **Save to Coating Library…** stays on and puts the coating between air and BK7.
- **Save to Coating Library…** saves the stack into My coatings, through the same dialog as **Save current coating…** in the Coating Library: give it a name, a type and a use note, and set the band, angle and polarization it is meant for. A `COAT` record names no incident medium or substrate, so the saved coating takes those of the active design. Its layers are the ones **Import → front coating** would put on the design, with relative thicknesses converted at the reference wavelength, which is stored with the coating. Its materials are embedded in it, so it works on a computer that never loaded the file. Saving adds nothing to your material catalogs.

**Materials tab**: lists every `MATE` record, one row each. Tick the ones you want and use **Import selected** or **Import all** to add them to a catalog without touching the design.

**Export tab**: generates `COAT` + `MATE` text from the current front design, with a preview before you save:

- **Layer thickness**: write **Absolute (µm)** physical thickness or **Relative (waves)** of λ₀.
- **Include materials**: export only the materials **Used by design**, or **All catalog materials**.
- **Coating name**: the `COAT` record name.
- **Material sampling grid**: the wavelength range and step at which each material's n,k is tabulated into its `MATE` record.

With no design selected there is nothing to export, and the tab shows nothing but a request to open or create one.

## A name defined twice

A file can define one material name in more than one `MATE` record. The window matches names without regard to case, so `SiO2` and `SIO2` count as one name. The Materials tab marks each such row with which record of the name it is, for example **2 of 2**, and a notice in the window's top row lists the names.

Each record imports on its own. The first keeps its name and a later one gets (2), (3) after it, so importing both never replaces one with the other in the catalog. A coating layer that names such a material is built with the last record of that name, on import, on Save to Coating Library and in the thicknesses the Coatings tab shows. If the records differ, check which one the file meant before relying on that coating.

## How to read it

TFStudio and Zemax differ in a few conventions, which the window handles for you automatically:

| Quantity        | Zemax                     | TFStudio                      |
| --------------- | ------------------------- | ----------------------------- |
| Wavelength      | micrometres (µm)          | nanometres (nm)               |
| Extinction      | stores **−k**             | `k > 0` (sign flipped on I/O) |
| Layer thickness | relative `T` (waves)      | physical `d = T·λ₀ / n₀`      |
| Layer order     | outermost → substrate     | same internal storage order   |

Layer order needs no reversal. Zemax's outermost-to-substrate order is exactly how TFStudio stores the front coating (the Design Editor only displays it reversed). Round-tripping a design out to `COATING.DAT` and back in preserves both the layer thicknesses and the k-sign convention. `IDEAL`, `IDEAL2` and `TABLE` coatings describe a surface by its reflectance and transmittance rather than by layers, and `ENCRYPTED` ones cannot be decoded, so none of them becomes a stack.

## References

- Zemax OpticStudio Help → *The Coating Tab → Coating File Definitions* (`MATE`, `COAT`, `IDEAL`, `TABLE`), the source of the `COATING.DAT` format.
