---
title: Zemax Coatings
description: Read and write Zemax OpticStudio COATING.DAT — import materials and coating stacks, export the active design.
ribbonIcon: zemax-coatings
---

The **Zemax Coatings** window reads and writes Zemax OpticStudio
`COATING.DAT` files. Import a coating stack (and its materials) from a
`COATING.DAT` into a TFStudio design, or export the active design as a `COAT`
stack plus its `MATE` material definitions for use in OpticStudio.

`COATING.DAT` is Zemax's coating database — a text file of `MATE` (material)
and `COAT` (coating-stack) records, alongside the ideal and tabular coating
models (`IDEAL`, `IDEAL2`, `TABLE`, `TAPR`, `ENCRYPTED`). The window parses the
whole file and presents it in three tabs: **Coatings**, **Materials**, and
**Export**. Load a file with the **Load** button at the top; the parsed
contents and your selections stay put while you switch between tools.

## Settings

**Reference wavelength** — λ₀ used to convert between Zemax's relative
thickness (in waves) and physical thickness in nanometres on both import and
export.

**Coatings tab** — lists every `COAT` stack in the file with its type and layer
count. Select a layer stack and press **Import to front** to load it as the
front design; the stack's `MATE` materials are auto-registered into a
`Zemax <file>` catalog so the design resolves its materials immediately.
Encrypted stacks are locked and cannot be imported.

**Materials tab** — lists every `MATE` table. Tick the ones you want and use
**Import selected** or **Import all** to add them to a catalog without touching
the design.

**Export tab** — generates `COAT` + `MATE` text from the current front design,
with a live preview before you save:

- **Thickness mode** — write **absolute** thickness (µm) or **relative** waves.
- **Material scope** — export only the materials **used** by the design, or
  **all** catalog materials.
- **Coating name** — the `COAT` record name.
- **Sample grid** — the wavelength range and step at which each material's
  n,k is tabulated into its `MATE` record.

## How to read it

TFStudio and Zemax differ in a few conventions, which the window handles for
you automatically:

| Quantity        | Zemax                     | TFStudio                      |
| --------------- | ------------------------- | ----------------------------- |
| Wavelength      | micrometres (µm)          | nanometres (nm)               |
| Extinction      | stores **−k**             | `k > 0` (sign flipped on I/O) |
| Layer thickness | relative `T` (waves)      | physical `d = T·λ₀ / n₀`      |
| Layer order     | outermost → substrate     | same internal storage order   |

Layer order needs no reversal — Zemax's outermost-to-substrate order is exactly
how TFStudio stores the front coating (the Design Editor only displays it
reversed). Round-tripping a design out to `COATING.DAT` and back in preserves
both the layer thicknesses and the k-sign convention. Only `IDEAL`, `IDEAL2`,
and `TABLE` style material models map cleanly to TFStudio dispersion;
`ENCRYPTED` Zemax materials cannot be decoded.

## References

- Zemax OpticStudio Help → *The Coating Tab → Coating File Definitions*
  (`MATE`, `COAT`, `IDEAL`, `TABLE`), the source of the `COATING.DAT` format.
