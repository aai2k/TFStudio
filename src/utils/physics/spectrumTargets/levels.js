/**
 * How a plot reads an operand's level on its vertical axis.
 *
 * An R/T/A operand holds a fraction and is drawn in percent, and a level drawn
 * past the top of that axis is a physical impossibility, so it is clamped. A dB
 * or density operand holds its own reading and is drawn at the percentage it
 * stands for, so the R/T/A plot places it whatever unit the axis is labelled
 * in. A GD, GDD or TOD operand holds the plotted unit itself, and nothing
 * bounds it.
 *
 *   toAxis(target, type)    operand target to the axis unit
 *   fromAxis(level, type)   axis unit to the operand target
 *
 * `type` is the operand type, or a measured block's channel; a level that
 * ignores it reads every operand alike.
 */

import { clampFrac } from './style.js';
import { LOG_READING_FLOOR, fractionFromLog, logUnit, logValue } from '../optimizer/logReadings.js';

export const PERCENT_LEVEL = {
    toAxis: (target, type) => {
        const unit = logUnit(type);
        return (unit ? fractionFromLog(unit, target) : target) * 100;
    },
    fromAxis: (level, type) => {
        const unit = logUnit(type);
        const fraction = clampFrac(level / 100);
        return unit ? logValue(unit, Math.max(fraction, LOG_READING_FLOOR)) : fraction;
    },
};

export const UNIT_LEVEL = {
    toAxis: target => target,
    fromAxis: level => level,
};
