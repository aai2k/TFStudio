/**
 * What the Plot Engine calls a quantity, and the unit it draws it in, in the
 * UI language.
 *
 * Symbols (λ, T, R, A, φ, Ψ, Δ) read the same in every language. The group
 * delay family is named with the GD/GDD window's own abbreviations, which are
 * translated, so Russian reads ГЗ and ДГЗ here as it does there.
 */

import {
    SWEEP, layerNumber, parseAxisVar, phaseMember, quantityFamily,
} from '../../../../utils/physics/plotQuantities.js';

// The t.units key of each group delay member's unit.
const DELAY_UNITS = { gd: 'fs', gdd: 'fs2', tod: 'fs3' };

/** The swept variable as a symbol: λ, AOI, or a layer's thickness, as in "L3 d". */
export function sweepSymbol(token, design, t) {
    const { kind, layer } = parseAxisVar(token);
    if (kind === 'lambda') return 'λ';
    if (kind === 'aoi') return t.plotEngine.aoiShort;
    return `L${layerNumber(design, layer)} d`;
}

/** The swept variable's unit: nm for λ and a thickness, ° for AOI. */
export function sweepUnit(token, t) {
    return parseAxisVar(token).kind === 'aoi' ? '°' : t.units.nm;
}

/** A quantity's symbol. A phase quantity names the light it is taken of, as in "GDD (R)". */
export function quantitySymbol(quantity, t) {
    const phase = phaseMember(quantity);
    if (phase) {
        const name = phase.member === 'phase' ? 'φ' : t.gdgdd.quantityShort[phase.member];
        return `${name} (${phase.response})`;
    }
    if (quantity === 'psi') return 'Ψ';
    if (quantity === 'delta') return 'Δ';
    return quantity;
}

/** The unit a quantity is drawn in: T, R and A as percentages, the angles in degrees. */
export function quantityUnit(quantity, t) {
    const family = quantityFamily(quantity);
    if (family === 'optical') return '%';
    if (family === 'ellipsometric') return '°';
    const phase = phaseMember(quantity);
    if (!phase) return '';
    return phase.member === 'phase' ? '°' : t.units[DELAY_UNITS[phase.member]];
}

/**
 * How an axis menu lists one of buildAxisTargetOptions: wavelength and angle by
 * the window's names for them, a layer by its tag and thickness, "L3 (SiO2) d (nm)".
 */
export function axisOptionLabel(option, t) {
    if (option.value === 'wavelength') return t.plotEngine.varWavelength;
    if (option.value === 'aoi') return t.plotEngine.varAOI;
    return `${option.label} d (${t.units.nm})`;
}

/** How a quantity menu lists a quantity, on a curve that sweeps `sweep`. */
export function quantityOptionLabel(quantity, sweep, design, t) {
    if (quantity === SWEEP) return sweepSymbol(sweep, design, t);
    if (quantity === 'MF') return t.plotEngine.zMF;
    return quantitySymbol(quantity, t);
}

/** An axis title: the symbols on the axis, then their unit in brackets when they have one. */
export function axisTitle(symbols, unit) {
    const names = symbols.join(', ');
    return unit ? `${names} (${unit})` : names;
}

/**
 * The title of an axis that carries the swept variable: the names the other
 * windows give a wavelength and an angle axis, and a layer's symbol with its
 * unit.
 */
export function sweepTitle(token, design, t) {
    const { kind } = parseAxisVar(token);
    if (kind === 'lambda') return t.spectralAxis.lambdaShort;
    if (kind === 'aoi') return t.plotEngine.varAOI;
    return axisTitle([sweepSymbol(token, design, t)], sweepUnit(token, t));
}
