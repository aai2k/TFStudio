/**
 * Zemax OpticStudio COATING.DAT reader / writer.
 *
 * Pure ESM, no app dependencies — every conversion takes the wavelength grid /
 * refractive-index resolver it needs as a parameter, so this module is unit-
 * testable in isolation (tests/zemax_coating_roundtrip.mjs).
 *
 * ── Format (authoritative: Zemax OpticStudio 2024 R1 Help, "Coating File Data
 *    Syntax", "The MATE Data Section", "The COAT Data Section") ────────────────
 *
 *   ! comment line
 *   MATE <name>
 *   <wavelength_µm> <real_index> <imaginary>      ← ascending λ, linear interp
 *   ...
 *   COAT <name>
 *   <material> <thickness> [is_absolute] [loop_index] [tapername]
 *   ...
 *   COAT I.<transmission>                          ← ideal: T given, R = 1−T
 *   IDEAL <name> <T_intensity> <R_intensity>
 *   IDEAL2 <name> s_rr s_ri s_tr s_ti p_rr p_ri p_tr p_ti no_pi_flag
 *   TABLE <name> / ANGL <deg> / WAVE <µm> Rs Rp Ts Tp Ars Arp Ats Atp
 *   TAPR <name> / DX/DY/AN/RT/CT/PT ...
 *   ENCRYPTED <filename>
 *
 * ── Conventions (and how they map to TFStudio) ──────────────────────────────
 *
 *  • Wavelength: Zemax µm  ↔  TFStudio nm   (×1000 / ÷1000).
 *
 *  • Extinction sign: Zemax stores the imaginary part as a NEGATIVE number for
 *    absorbing media (e.g. AG: "0.5876  0.15016  -3.4727"); TFStudio uses
 *    ñ = n + ik with k > 0 (thinFilmMath.js). So:
 *        import:  k_TF      = −imag_Zemax     (≥ 0 for absorbers)
 *        export:  imag_Zemax = −k_TF
 *
 *  • Layer thickness (Help, "The COAT Data Section"): if is_absolute = 0 the
 *    thickness T is RELATIVE — an optical thickness in waves of the lens primary
 *    wavelength λ₀ — and the physical thickness in that medium is
 *
 *         d = T · λ₀ / n₀          (n₀ = real index of the layer at λ₀)
 *
 *    (Help worked example: n₀ = 1.4, T = 0.25, λ₀ = 0.550 µm → d = 0.0982 µm.)
 *    If is_absolute = 1 the thickness is already a physical value in micrometres.
 *    λ₀ is a property of the *lens*, not of the coating file, so importing a
 *    relative-thickness coating requires the user to supply λ₀ (default 0.55 µm);
 *    exporting in absolute micrometres needs no λ₀ and is the lossless default.
 *
 *  loop_index / tapername / IDEAL / IDEAL2 / TABLE / TAPR / ENCRYPTED are parsed
 *  and surfaced for browsing but are not (yet) converted to TFStudio designs —
 *  only plain COAT layer stacks import to a layer stack. Replicated groups
 *  (loop_index ≠ 0) are flagged with a warning.
 */

export { parseZemaxCoating } from './zemaxCoating/parse.js';
export { sanitizeZemaxName } from './zemaxCoating/names.js';
export { mateToTfMaterial, tfMaterialToMate } from './zemaxCoating/materialConvert.js';
export { coatToTfLayers, tfLayersToCoat } from './zemaxCoating/layerConvert.js';
export { generateZemaxCoating } from './zemaxCoating/serialize.js';
export { buildGrid } from './zemaxCoating/grid.js';
