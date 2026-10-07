/**
 * CODE V multilayer coating (MUL option) reader and writer.
 *
 * Pure ESM, no app dependencies beyond the tabulated-material interpolation, so
 * it is testable on its own (tests/codev_coating_*.mjs).
 *
 * ── Format (authoritative: CODE V Multilayer Design Reference Manual, chapter
 *    "Multilayer Coating Design and Analysis (MUL)", MDA Sub-Option) ─────────
 *
 *   MUL                              enter the option
 *   MDA                              enter a stack
 *     PHT Y | N                      thickness in nm (Y) or in waves of REF (N, the default)
 *     TIT 'title'                    up to 80 characters
 *     WL λ...  /  WLG min max step   analysis wavelengths, nm, up to 100 in all
 *     REF λ                          reference wavelength, nm; default the central WL
 *     ANG θ...                       angles of incidence, degrees, up to 5; default 0
 *     INC n | 'label'                incident medium, no k; default 1.00
 *     COA d code n [k]               one layer, incident side first, up to 1000;
 *     COA d code 'label'               code 100 frozen, 0 free, 1..99 coupled
 *     COA 'g'                        the layers of group g again
 *     GRO 'g' ... END                a group; its layers are also entered where defined
 *     SUB n | 'label'                substrate, no k; required
 *     MIC                            Multilayer Index Catalog:
 *       MWL λ...                       wavelengths, nm, up to 21
 *       'label' n...                   a material, label up to 6 characters
 *       EXT 'label' k...               its extinction coefficients, default 0
 *     END
 *   SAV name                         write name.mul
 *   MEX                              leave the option
 *
 * Command syntax: blanks separate tokens, ";" separates commands on a line,
 * "&" ending a line continues the command, "!" starts a comment, commands of
 * more than three letters are read by their first three, case does not matter
 * outside strings.
 *
 * ── Conventions ─────────────────────────────────────────────────────────────
 *
 *  • Wavelength and physical thickness: nm in both programs.
 *  • PHT N thickness T is an optical thickness in waves of REF; the physical
 *    thickness is d = T · REF / n(REF), n the real index of the layer at REF.
 *  • Extinction: CODE V takes k as a positive number; TFStudio's n + ik with
 *    k ≥ 0 uses it as it is.
 *  • The .mul is not described in the help; codevCoating/mulRecord.js gives
 *    the layout read from CODE V's sample coatings. It stores every thickness
 *    in waves of REF, so it is read back with the n(REF) stored beside it.
 *  • Between MWL points CODE V computes n by rules given in
 *    codevCoating/micIndex.js; a PHT N layer of a MIC material uses them for
 *    n(REF). Imported MIC materials are read with TFStudio's interpolation.
 *
 * ── What the reader returns ─────────────────────────────────────────────────
 *
 *   CodevStack = {
 *     title, refNm, wavelengthsNm, anglesDeg,
 *     incident: IndexRef, substrate: IndexRef,
 *     layers: [{ thicknessNm, code, index: IndexRef }],   incident side first
 *     mic: { label: [[λ_nm, n, k], ...] },                 MIC tables as entered
 *     warnings: [{ kind, ...params }],
 *   }
 *   IndexRef = { n, k } | { label }
 *
 * Warnings: unknownCommand {command, line} for a command the reader does not
 * know inside MDA, or MCH (stack changes it does not apply); extraValues
 * {command, line, count, limit} for the values past the 21st of one WL
 * command, which CODE V ignores and so does the reader; refOutsideTable
 * {label} when a PHT N layer's MIC table does not reach REF and its end value
 * is used; coupledLayers {count} from codevStackToDesign. Errors are
 * CodevParseError, kinds listed in codevCoating/parseError.js.
 */

export { buildCodevSeq, CodevExportError, CODEV_LIMITS } from './codevCoating/serialize.js';
export { CodevParseError } from './codevCoating/parseError.js';
export { parseCodevSeq } from './codevCoating/parseSeq.js';
export { parseCodevMul } from './codevCoating/parseMul.js';
export { codevStackToDesign } from './codevCoating/toDesign.js';
