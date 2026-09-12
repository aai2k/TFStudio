/**
 * What the field plot reads on its vertical axis, and which component of the
 * field it reads.
 *
 * The engine returns each curve as a fraction of the incident |E|², which is a
 * pure number and says nothing about how strong the beam was. Two of the three
 * quantities here are absolute instead, and the conversion between them needs
 * the incident medium's index, so it is a real choice of quantity rather than a
 * relabelling of one.
 *
 * For an irradiance I in a medium of index n, I = ½ε₀cn|E|², so
 *
 *     |E| = sqrt( 2I / (ε₀cn) )
 *
 * and a beam carrying 1 W/m² has amplitude 27.4492 V/m in vacuum, that over
 * √n in anything else. Essential Macleod reports the field this way, in volts
 * per metre for 1 W/m² incident, which is the form a damage threshold is
 * quoted against: scaling it to a real beam is one multiplication, where a
 * fraction of the incident field cannot answer the question at all without
 * knowing what the incident field was.
 *
 * Reference: Macleod, Thin-Film Optical Filters, Admittance Loci, Electric
 * Field and Losses in the Admittance Diagram, where the absolute field is
 * fixed from the incident irradiance through the transmittance.
 */

import { formatChartReadout } from '../../../ui/chartOptions.js';

const VACUUM_PERMITTIVITY = 8.8541878128e-12;  // F/m
const SPEED_OF_LIGHT = 2.99792458e8;           // m/s

// Amplitude in V/m of a 1 W/m² beam in vacuum: sqrt(2 / (ε₀c)) = 27.4492 V/m.
const VACUUM_AMPLITUDE_VPM = Math.sqrt(2 / (VACUUM_PERMITTIVITY * SPEED_OF_LIGHT));

/**
 * Incident amplitude in V/m for 1 W/m², from the real part of the incident
 * index. Every absolute reading below is scaled by it, so it is computed once
 * per profile and handed in.
 */
export function incidentAmplitudeVpm(incidentIndex) {
    const n = Number(incidentIndex);
    return n > 0 ? VACUUM_AMPLITUDE_VPM / Math.sqrt(n) : VACUUM_AMPLITUDE_VPM;
}

// `squared` decides whether the symbol on the axis is E or |E|². `decimals`
// is decimal places, for the table cells; `readoutDigits` is significant
// figures, which is what the hover readout counts.
const SCALES = {
    amplitude: {
        id: 'amplitude', unit: 'V/m', suffix: ' V/m', squared: false,
        decimals: 4, readoutDigits: 5,
        fromFraction: (fraction, incident) => Math.sqrt(Math.max(0, fraction)) * incident,
    },
    fractionSquared: {
        id: 'fractionSquared', unit: '%', suffix: '%', squared: true,
        decimals: 4, readoutDigits: 5,
        fromFraction: fraction => fraction * 100,
    },
    absoluteSquared: {
        id: 'absoluteSquared', unit: '(V/m)²', suffix: ' (V/m)²', squared: true,
        decimals: 3, readoutDigits: 6,
        fromFraction: (fraction, incident) => fraction * incident * incident,
    },
};

export const Y_SCALE_IDS = ['amplitude', 'fractionSquared', 'absoluteSquared'];

export function yScaleOf(id) { return SCALES[id] || SCALES.amplitude; }

// Which array on a computed profile each component reads, and the subscript it
// carries on the axis and in the legend.
const COMPONENTS = {
    total:      { key: 'e2', subscript: '' },
    tangential: { key: 'e2Tangential', subscript: 'ₜ' },
    normal:     { key: 'e2Normal', subscript: 'ₙ' },
};

export const COMPONENT_IDS = ['total', 'tangential', 'normal'];

export function componentOf(id) { return COMPONENTS[id] || COMPONENTS.total; }

/** The field symbol the axis and the legend carry, such as `|Eₜ|²`. */
function fieldSymbol(scaleId, component) {
    const sub = componentOf(component).subscript;
    return yScaleOf(scaleId).squared ? `|E${sub}|²` : `E${sub}`;
}

/** Vertical-axis title: the field symbol and its unit. */
export function yAxisTitle(scaleId, component) {
    return `${fieldSymbol(scaleId, component)} (${yScaleOf(scaleId).unit})`;
}

/**
 * One curve's name, as `|E|² (p-pol)`. The polarization suffix is display text
 * and comes from the locale; the symbol in front of it is not.
 */
export function curveLabel(scaleId, component, polSuffix) {
    return `${fieldSymbol(scaleId, component)} (${polSuffix})`;
}

/** Fraction of the incident |E|² to the number the axis places it at. */
export function plotValue(scaleId, incident) {
    const scale = yScaleOf(scaleId);
    return fraction => scale.fromFraction(fraction, incident);
}

/**
 * Where the incident beam's own level sits on the axis.
 *
 * The plot rules a line there, since a field above it is being concentrated by
 * the coating rather than merely passed through, and holds the axis open to at
 * least that far so a weak field is not drawn as though it filled the plot.
 */
export function incidentLevel(scaleId, incident) {
    return yScaleOf(scaleId).fromFraction(1, incident);
}

/** Hover and crosshair readout fields. */
export function yScaleTooltip(scaleId) {
    const scale = yScaleOf(scaleId);
    return {
        valueSuffix: scale.suffix,
        formatValue: value => formatChartReadout(value, scale.readoutDigits),
    };
}

/** One results-table cell. The CSV export carries the raw numbers instead. */
export function formatCell(scaleId, value) {
    return value == null || !Number.isFinite(value) ? '' : value.toFixed(yScaleOf(scaleId).decimals);
}
