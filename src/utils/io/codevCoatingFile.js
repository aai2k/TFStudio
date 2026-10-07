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
 *    the layout read from CODE V's sample coatings (format 5) and from files
 *    CODE V 11.2 saved (format 6). It stores every thickness in waves of REF,
 *    so it is read back with the n(REF) stored beside it.
 *  • WLG builds its wavelengths as CODE V does, a float32 running sum in µm
 *    (codevCoating/mdaCommands.js), so they are not round numbers in nm.
 *  • n and k of a MIC table between and past its MWL points follow the rules
 *    in codevCoating/micIndex.js, read off CODE V 11.2 listings. A PHT N
 *    layer of a MIC material takes n(REF) from them, and an imported MIC
 *    material is tabulated from them, densely enough that TFStudio's straight
 *    lines between its rows stay within half a unit in the sixth decimal of
 *    CODE V's n.
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
 * {command, line, count, limit} for the values past the 21st of one WL, MWL,
 * 'label' n or EXT command (command 'WL', 'MWL', 'EXT' or the label), which
 * CODE V ignores and so does the reader; decimalComma {line}, once, at the
 * first line of the stack with a comma between two digits, which the reader
 * takes for a decimal point and CODE V does not read at all; refOutsideTable
 * {label} when a PHT N layer's MIC table does not reach REF, where CODE V too
 * warns that the index "is being extrapolated"; coupledLayers {count} from
 * codevStackToDesign. Errors are
 * CodevParseError, kinds listed in codevCoating/parseError.js.
 */

export { buildCodevSeq, CodevExportError, CODEV_LIMITS } from './codevCoating/serialize.js';
export { CodevParseError } from './codevCoating/parseError.js';
export { parseCodevSeq } from './codevCoating/parseSeq.js';
export { parseCodevMul } from './codevCoating/parseMul.js';
export { codevStackToDesign } from './codevCoating/toDesign.js';
