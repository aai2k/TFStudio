/**
 * Turning parsed fields into columns: which of them repeat the wavelength axis,
 * which sample each belongs to, and what each one measures.
 *
 * A file may carry one wavelength column per sample, as Cary does, so "column
 * two onwards is data" is not enough; grouping the columns is what tells a
 * measurement from a repeated axis.
 */

import { X_UNITS } from './constants.js';
import { detectXUnit, guessXUnitFromRange, detectQuantity, detectIsPercent, isAbsorbanceHeader } from './headerHeuristics.js';
import { groupSampleName } from './headerLayout.js';

function isMonotonic(values) {
    if (values.length < 2 || values.some(value => !Number.isFinite(value))) return false;
    let nondecreasing = true, nonincreasing = true, changed = false;
    for (let i = 1; i < values.length; i++) {
        if (values[i] < values[i - 1]) nondecreasing = false;
        if (values[i] > values[i - 1]) nonincreasing = false;
        if (values[i] !== values[i - 1]) changed = true;
    }
    return changed && (nondecreasing || nonincreasing);
}

function isRepeatedX(values, primaryX) {
    if (values.length !== primaryX.length || !isMonotonic(values)) return false;
    return values.every((value, index) => {
        const reference = primaryX[index];
        if (!Number.isFinite(value) || !Number.isFinite(reference)) return false;
        return Math.abs(value - reference) <= Math.max(1e-9, 1e-7 * Math.max(1, Math.abs(reference)));
    });
}

/**
 * Which column is the wavelength axis.
 *
 * The first column while it runs one way, which is what an axis does. An
 * imaging ellipsometer opens with the region index instead, repeated once per
 * region, and puts the wavelength third; there a name decides.
 *
 * Reading the first column before the names matters for a file with no name
 * row, where a metadata line above the numbers is read as one. `X axis mode:
 * Wavelengths` would otherwise hand the axis to whichever column that line
 * lined up with, and the counts of an Ocean Optics scan became its wavelengths.
 */
const X_AXIS_LABEL = /wavelength|lambda|λ|\benergy\b|wavenumber/i;

function primaryXIndex(columnNames, allValues = []) {
    if (isMonotonic(allValues[0] || [])) return 0;
    const named = (columnNames || []).findIndex(name => X_AXIS_LABEL.test(name || ''));
    return named > 0 ? named : 0;
}

/**
 * One descriptor per Y column, each pointing at the X column it belongs to.
 *
 * A file may repeat its wavelength column once per sample, as Cary does. Those
 * repeats are not curves: each one opens a new group, and the columns after it
 * measure against it rather than against the first column. A column before the
 * primary axis measures against the primary axis.
 */
function columnDescriptors({
    nCols, allValues, headerText, columnNames, columnUnits, sampleNames, primaryX = 0,
}) {
    const x = allValues[primaryX];
    const xIndices = [primaryX];
    for (let index = 0; index < nCols; index++) {
        if (index !== primaryX && isRepeatedX(allValues[index], x)) xIndices.push(index);
    }
    xIndices.sort((left, right) => left - right);
    const descriptors = [];
    for (let index = 0; index < nCols; index++) {
        if (xIndices.includes(index)) continue;
        const xIndex = xIndices.filter(candidate => candidate < index).at(-1) ?? primaryX;
        const groupEnd = xIndices[xIndices.indexOf(xIndex) + 1] ?? nCols;
        descriptors.push({
            index,
            baseName: columnNames[index] || `Column ${index + 1}`,
            unit: columnUnits[index] || '',
            sampleName: groupSampleName(sampleNames, xIndex, groupEnd),
            xIndex,
            x: allValues[xIndex],
            xUnit: columnXUnit(headerText, columnNames[xIndex], allValues[xIndex]),
            values: allValues[index],
        });
    }
    return descriptors;
}

/** The X unit a column's own axis carries, by header text then by range. */
function columnXUnit(headerText, name, values) {
    const declared = detectXUnit(`${headerText} ${name || ''}`);
    return declared === X_UNITS.UNKNOWN ? guessXUnitFromRange(values) : declared;
}

function buildColumn({ index, name, baseName, unit, sampleName, xIndex, x, xUnit, values, hasColumnNames, headerText }) {
    const hdr = `${headerText}\n${baseName}`;
    const isAbsorbance = isAbsorbanceHeader(baseName) || (!hasColumnNames && isAbsorbanceHeader(headerText));
    // A column that states its own unit is read on that unit alone. Otherwise a
    // "[%]" belonging to one column decides the scale of every other column in
    // the file, which is how raw detector counts end up divided by 100.
    const percentText = unit ? `${baseName} ${unit}` : hdr;
    const quantity = detectQuantity(baseName) || detectQuantity(unit)
        || detectQuantity(headerText, { angular: false });
    const angular = quantity === 'PSI' || quantity === 'DEL';
    return {
        index,
        name,
        unit,
        sampleName,
        xIndex,
        x,
        xUnit,
        values,
        quantity,
        isPercent: angular || isAbsorbance ? false : detectIsPercent(percentText, values),
        isAbsorbance,
    };
}

export { buildColumn, columnDescriptors, columnXUnit, primaryXIndex };
