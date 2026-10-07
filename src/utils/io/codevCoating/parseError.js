/**
 * A CODE V coating file that cannot be read as a stack. `kind` names the
 * problem and `detail` carries its values:
 *   noStack          no MDA stack with a COA layer
 *   missingCommand   {command}  a command CODE V requires is absent (SUB, or WL/WLG)
 *   unknownGroup     {label}    COA names a group no GRO defined
 *   unknownMaterial  {label}    a layer or medium names a label the MIC does not hold
 *   micMismatch      {label, line}  a MIC entry has more or fewer values than its MWL
 *   badNumber        {line, text}   a value that should be a number is not
 *   notMul           the text does not have the layout of a CODE V .mul file
 */
export class CodevParseError extends Error {
    constructor(kind, detail = {}) {
        super(`CODE V import: ${kind}`);
        this.name = 'CodevParseError';
        this.kind = kind;
        this.detail = detail;
    }
}
